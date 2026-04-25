import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LiveIncident } from '../correlation/engine.js';
import type { ParsedEvent } from '../parser/types.js';

export type DangerLevel = 'red' | 'orange' | 'green' | null;

/** OSM district names from districts.geojson → frontend district ids */
const OSM_NAME_TO_ID: Record<string, string> = {
  'Салтівський район': 'saltivskyi',
  'Київський район': 'kyivskyi',
  'Шевченківський район': 'shevchenkivskyi',
  'Холодногірський район': 'kholodnohirskyi',
  'Новобаварський район': 'novobavarskyi',
  "Основ'янський район": 'osnovianskyi',
  'Слобідський район': 'slobidskyi',
  'Немишлянський район': 'nemyshlianskyi',
  'Індустріальний район': 'industrialnyi',
  'Салтівський': 'saltivskyi',
  'Київський': 'kyivskyi',
  'Шевченківський': 'shevchenkivskyi',
  'Холодногірський': 'kholodnohirskyi',
  'Новобаварський': 'novobavarskyi',
  "Основ'янський": 'osnovianskyi',
  'Слобідський': 'slobidskyi',
  'Немишлянський': 'nemyshlianskyi',
  'Індустріальний': 'industrialnyi',
};

const LOOKAHEAD_RED_MIN = 2;
const LOOKAHEAD_ORANGE_MIN = 3;
const EDGE_NEAR_KM = 5;
const GREEN_COOLDOWN_MS = 5 * 60 * 1000;
const ETA_ORANGE_MAX_S = 180;
const NON_DRONE_RISK_TTL_MS = 10 * 60 * 1000;

export interface DistrictPolygon {
  id: string;
  /** Outer ring [lng, lat][] — GeoJSON order, first point may repeat last */
  ringLngLat: [number, number][];
  centroid: { lat: number; lng: number };
}

let loadedPolygons: DistrictPolygon[] = [];
let districtIds: string[] = [];

/** Previous raw threat level per district (red/orange only), for green cooldown transitions */
let previousRawLevel = new Map<string, 'red' | 'orange'>();
/** When a district last went from threatened → safe (raw null) */
const threatEndedAt = new Map<string, number>();
const nonDroneDistrictOverrides = new Map<string, { level: RawThreat; expiresAt: number }>();

/**
 * Clears in-memory threat transition state so next compute has no cooldown memory.
 * Useful for development resets where all targets are intentionally wiped.
 */
export function resetDistrictRiskState(): void {
  previousRawLevel = new Map<string, 'red' | 'orange'>();
  threatEndedAt.clear();
  nonDroneDistrictOverrides.clear();
}

function districtsGeoPath(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.join(__dirname, '../../public/data/districts.geojson');
}

/** Load GeoJSON once; safe to call multiple times (idempotent). */
export function loadDistrictPolygons(): void {
  if (loadedPolygons.length > 0) return;

  const raw = readFileSync(districtsGeoPath(), 'utf8');
  const fc = JSON.parse(raw) as {
    features?: Array<{
      geometry?: { type: string; coordinates: [number, number][][] };
      properties?: { name?: string };
    }>;
  };
  const out: DistrictPolygon[] = [];

  for (const f of fc.features ?? []) {
    if (!f.geometry || f.geometry.type !== 'Polygon') continue;
    const name = (f.properties as { name?: string } | null)?.name;
    if (!name) continue;
    const id = OSM_NAME_TO_ID[name];
    if (!id) continue;

    const coords = f.geometry.coordinates[0] as [number, number][];
    if (!coords?.length) continue;

    let sumLng = 0;
    let sumLat = 0;
    const n = coords.length;
    for (const c of coords) {
      sumLng += c[0];
      sumLat += c[1];
    }
    out.push({
      id,
      ringLngLat: coords,
      centroid: { lat: sumLat / n, lng: sumLng / n },
    });
  }

  loadedPolygons = out;
  districtIds = [...new Set(out.map((d) => d.id))];
}

function ensureLoaded(): void {
  if (loadedPolygons.length === 0) {
    loadDistrictPolygons();
  }
}

/**
 * Ray-casting point-in-polygon. `ring` is [lng, lat].
 */
export function pointInPolygon(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-20) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function toLocalM(latP: number, lngP: number, lat: number, lng: number): { x: number; y: number } {
  const cos = Math.cos((latP * Math.PI) / 180);
  const x = (lng - lngP) * cos * 111.32;
  const y = (lat - latP) * 111.32;
  return { x, y };
}

/** Shortest distance (km) from point to polygon boundary (outer ring only). */
export function distancePointToRingKm(lat: number, lng: number, ring: [number, number][]): number {
  let minKm = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lng1 = ring[i][0];
    const lat1 = ring[i][1];
    const lng2 = ring[j][0];
    const lat2 = ring[j][1];

    const a = toLocalM(lat, lng, lat1, lng1);
    const b = toLocalM(lat, lng, lat2, lng2);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const denom = abx * abx + aby * aby;
    const t = denom < 1e-12 ? 0 : Math.max(0, Math.min(1, (-(a.x * abx + a.y * aby)) / denom));
    const cx = a.x + t * abx;
    const cy = a.y + t * aby;
    const d = Math.hypot(cx, cy);
    if (d < minKm) minKm = d;
  }
  return minKm;
}

/** Destination ~`distanceKm` along initial bearing from (lat, lng). */
function destinationKm(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceKm: number
): { lat: number; lng: number } {
  const R = 6371;
  const δ = distanceKm / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2));
  return {
    lat: (φ2 * 180) / Math.PI,
    lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

function segmentCrossesRing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  ring: [number, number][]
): boolean {
  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  if (pointInPolygon(midLng, midLat, ring)) return true;
  const steps = 8;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const lat = lat1 + t * (lat2 - lat1);
    const lng = lng1 + t * (lng2 - lng1);
    if (pointInPolygon(lng, lat, ring)) return true;
  }
  return false;
}

type RawThreat = 'red' | 'orange';

function incidentContribution(
  inc: LiveIncident,
  district: DistrictPolygon
): RawThreat | null {
  if (inc.status === 'expired') return null;

  const last = inc.trajectory[inc.trajectory.length - 1];
  if (!last) return null;

  const { lat, lng } = last;
  const ring = district.ringLngLat;

  const headInside = pointInPolygon(lng, lat, ring);

  let inside2min = false;
  if (inc.bearingDeg != null && inc.speedKmh > 0) {
    const dKm = inc.speedKmh * (LOOKAHEAD_RED_MIN / 60);
    const p = destinationKm(lat, lng, inc.bearingDeg, dKm);
    inside2min = pointInPolygon(p.lng, p.lat, ring);
  }

  if (headInside || inside2min) return 'red';

  const distEdge = distancePointToRingKm(lat, lng, ring);
  const nearEdgeOutside = !headInside && distEdge <= EDGE_NEAR_KM;

  let orangeTrajectory = false;
  if (inc.bearingDeg != null && inc.speedKmh > 0) {
    const d3 = inc.speedKmh * (LOOKAHEAD_ORANGE_MIN / 60);
    const p3 = destinationKm(lat, lng, inc.bearingDeg, d3);
    const inside3 = pointInPolygon(p3.lng, p3.lat, ring);
    if (inside3) {
      const d2 = inc.speedKmh * (LOOKAHEAD_RED_MIN / 60);
      const p2 = destinationKm(lat, lng, inc.bearingDeg, d2);
      const inside2 = pointInPolygon(p2.lng, p2.lat, ring);
      if (!inside2) orangeTrajectory = true;
    }

    if (
      inc.etaSeconds != null &&
      inc.etaSeconds > 0 &&
      inc.etaSeconds <= ETA_ORANGE_MAX_S &&
      inc.currentHeading
    ) {
      const h = inc.currentHeading;
      if (pointInPolygon(h.lng, h.lat, ring)) {
        orangeTrajectory = true;
      } else if (segmentCrossesRing(lat, lng, h.lat, h.lng, ring)) {
        orangeTrajectory = true;
      }
    }
  }

  if (nearEdgeOutside || orangeTrajectory) return 'orange';

  return null;
}

function maxThreat(a: RawThreat | null, b: RawThreat | null): RawThreat | null {
  if (a === 'red' || b === 'red') return 'red';
  if (a === 'orange' || b === 'orange') return 'orange';
  return null;
}

/**
 * Computes per-district danger from live incidents.
 * Red: head or ≤2 min lookahead inside polygon.
 * Orange: within 5 km of edge (outside), or trajectory/heading enters district within ~3 min / ETA rules.
 * Green: district had red/orange last tick and threat cleared, within 5 min cooldown.
 * Null: no dynamic overlay (frontend uses static risk).
 */
export function computeDistrictRisk(
  activeIncidents: LiveIncident[],
  now: number = Date.now()
): Map<string, DangerLevel> {
  ensureLoaded();

  const raw = new Map<string, RawThreat | null>();
  for (const id of districtIds) {
    raw.set(id, null);
  }

  for (const d of loadedPolygons) {
    let level: RawThreat | null = null;
    for (const inc of activeIncidents) {
      level = maxThreat(level, incidentContribution(inc, d));
    }
    raw.set(d.id, level);
  }

  for (const [districtId, override] of nonDroneDistrictOverrides.entries()) {
    if (override.expiresAt <= now) {
      nonDroneDistrictOverrides.delete(districtId);
      continue;
    }
    raw.set(districtId, maxThreat(raw.get(districtId) ?? null, override.level));
  }

  const result = new Map<string, DangerLevel>();

  for (const id of districtIds) {
    const r = raw.get(id) ?? null;

    if (r === 'red' || r === 'orange') {
      result.set(id, r);
      threatEndedAt.delete(id);
      continue;
    }

    const prev = previousRawLevel.get(id);
    if (prev === 'red' || prev === 'orange') {
      threatEndedAt.set(id, now);
    }

    const ended = threatEndedAt.get(id);
    if (ended !== undefined && now - ended < GREEN_COOLDOWN_MS) {
      result.set(id, 'green');
    } else {
      result.set(id, null);
      if (ended !== undefined && now - ended >= GREEN_COOLDOWN_MS) {
        threatEndedAt.delete(id);
      }
    }
  }

  previousRawLevel = new Map<string, 'red' | 'orange'>();
  for (const id of districtIds) {
    const r = raw.get(id);
    if (r === 'red' || r === 'orange') {
      previousRawLevel.set(id, r);
    }
  }

  return result;
}

/** For tests / diagnostics */
export function getLoadedDistrictIds(): string[] {
  ensureLoaded();
  return [...districtIds];
}

function districtIdFromLocationPoint(lat: number, lng: number): string | null {
  for (const district of loadedPolygons) {
    if (pointInPolygon(lng, lat, district.ringLngLat)) {
      return district.id;
    }
  }
  return null;
}

function districtIdFromLocationMeta(name: string | null, parent: string | null): string | null {
  if (name && OSM_NAME_TO_ID[name]) return OSM_NAME_TO_ID[name];
  if (parent && OSM_NAME_TO_ID[parent]) return OSM_NAME_TO_ID[parent];
  return null;
}

/**
 * Converts non-drone weapon alerts into district-level overlays.
 * - impact => red
 * - tracking/correction/preliminary => orange
 * Falls back to all districts when no specific district can be inferred.
 */
export function applyNonDroneDistrictAlert(event: ParsedEvent, nowMs: number = Date.now()): string[] {
  ensureLoaded();
  const level: RawThreat = event.eventType === 'impact' ? 'red' : 'orange';
  const expiresAt = nowMs + NON_DRONE_RISK_TTL_MS;
  const targets = new Set<string>();
  const locations = [event.location, event.via, event.heading].filter((v) => !!v);

  for (const loc of locations) {
    const byMeta = districtIdFromLocationMeta(loc.canonicalName, loc.parent);
    if (byMeta) {
      targets.add(byMeta);
      continue;
    }
    const byPoint = districtIdFromLocationPoint(loc.lat, loc.lng);
    if (byPoint) {
      targets.add(byPoint);
    }
  }

  if (targets.size === 0) {
    for (const id of districtIds) {
      targets.add(id);
    }
  }

  for (const districtId of targets) {
    const prev = nonDroneDistrictOverrides.get(districtId);
    if (!prev || prev.level === 'orange') {
      nonDroneDistrictOverrides.set(districtId, { level, expiresAt });
      continue;
    }
    nonDroneDistrictOverrides.set(districtId, {
      level: prev.level === 'red' ? 'red' : level,
      expiresAt: Math.max(prev.expiresAt, expiresAt),
    });
  }

  return [...targets];
}

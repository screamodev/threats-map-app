import { v4 as uuid } from 'uuid';
import {
  getActiveIncidents,
  insertIncident,
  updateIncident,
  setEventIncidentId,
  getStaleActiveIncidents,
  type IncidentRow,
} from '../db/client.js';
import type { ResolvedLocation } from '../gazetteer/index.js';
import { resolve as resolvePlace } from '../gazetteer/index.js';
import type { ParsedEvent, WeaponType } from '../parser/types.js';
import { WEAPON_LABELS, WEAPON_COLORS, WEAPON_SPEED_KMH } from '../parser/types.js';

export type LocationScope = 'kharkiv-city' | 'oblast' | 'external';

/** Kharkiv city district short names (parent of neighborhoods / metro / etc.). */
const KHARKIV_DISTRICT_PARENTS = new Set([
  'Шевченківський',
  'Київський',
  'Салтівський',
  'Холодногірський',
  'Новобаварський',
  "Основ'янський",
  'Слобідський',
  'Немишлянський',
  'Індустріальний',
]);

const CONTINUATION_CONFIDENCE_MIN = 0.6;

export interface LiveIncident {
  id: string;
  weaponType: WeaponType;
  weaponTypeLabel: string;
  weaponCount: number;
  status: 'active' | 'impact' | 'expired';
  trajectory: Array<{ lat: number; lng: number; timestamp: number; name: string }>;
  currentHeading: { lat: number; lng: number; name: string } | null;
  /** Bearing from last trajectory point toward currentHeading (degrees, 0–360). */
  bearingDeg: number | null;
  /** Approximate cruise speed from weapon table (km/h). */
  speedKmh: number;
  /** Time to reach heading target at cruise speed, or null if unknown. */
  etaSeconds: number | null;
  locationScope: LocationScope;
  /** Gazetteer place type for the head point (e.g. neighborhood, village). */
  locationType: string;
  confidence: number;
  sourceChannels: string[];
  firstSeenAt: number;
  lastUpdatedAt: number;
  color: string;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Destination point ~`distanceKm` along initial bearing from (lat, lng). */
function destinationKm(lat: number, lng: number, bearingDeg: number, distanceKm: number): { lat: number; lng: number } {
  const R = 6371;
  const δ = distanceKm / R;
  const θ = bearingDeg * Math.PI / 180;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lng * Math.PI / 180;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * sinδ * cosφ1,
      cosδ - sinφ1 * sinφ2
    );
  return { lat: (φ2 * 180) / Math.PI, lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180 };
}

function deriveLocationScope(loc: ResolvedLocation | null): { scope: LocationScope; locationType: string } {
  if (!loc) {
    return { scope: 'external', locationType: 'unknown' };
  }
  const locationType = loc.type;
  if (loc.parent === 'Харків') {
    return { scope: 'kharkiv-city', locationType };
  }
  if (loc.type === 'district' && loc.parent === 'Харків') {
    return { scope: 'kharkiv-city', locationType };
  }
  if (loc.parent && KHARKIV_DISTRICT_PARENTS.has(loc.parent)) {
    return { scope: 'kharkiv-city', locationType };
  }
  if (loc.parent === 'Харківська область' || (loc.parent?.includes('громада') ?? false)) {
    return { scope: 'oblast', locationType };
  }
  if ((loc.type === 'village' || loc.type === 'city') && loc.parent && loc.parent !== 'Харків') {
    if (!KHARKIV_DISTRICT_PARENTS.has(loc.parent)) {
      return { scope: 'oblast', locationType };
    }
  }
  if (loc.parent == null && loc.type === 'city') {
    return { scope: 'external', locationType };
  }
  return { scope: 'external', locationType };
}

type TrajectoryPoint = { lat: number; lng: number; timestamp: number; name: string };

function enrichLiveFields(
  trajectory: TrajectoryPoint[],
  weaponType: WeaponType,
  explicitHeading: ResolvedLocation | null,
  scopeSource: ResolvedLocation | null
): Pick<
  LiveIncident,
  | 'currentHeading'
  | 'bearingDeg'
  | 'speedKmh'
  | 'etaSeconds'
  | 'locationScope'
  | 'locationType'
> {
  const speedKmh = WEAPON_SPEED_KMH[weaponType] ?? WEAPON_SPEED_KMH.unknown;
  const last = trajectory[trajectory.length - 1];
  const prev = trajectory.length >= 2 ? trajectory[trajectory.length - 2] : null;

  let resolvedForScope = scopeSource;
  if (!resolvedForScope && last?.name) {
    resolvedForScope = resolvePlace(last.name);
  }
  const { scope: locationScope, locationType } = deriveLocationScope(resolvedForScope);

  let currentHeading: { lat: number; lng: number; name: string } | null = null;
  if (explicitHeading) {
    currentHeading = {
      lat: explicitHeading.lat,
      lng: explicitHeading.lng,
      name: explicitHeading.canonicalName,
    };
  } else if (prev && last) {
    const segBearing = bearing(prev.lat, prev.lng, last.lat, last.lng);
    const dest = destinationKm(last.lat, last.lng, segBearing, 12);
    currentHeading = { lat: dest.lat, lng: dest.lng, name: '' };
  }

  let bearingDeg: number | null = null;
  let etaSeconds: number | null = null;
  if (last && currentHeading) {
    bearingDeg = bearing(last.lat, last.lng, currentHeading.lat, currentHeading.lng);
    if (speedKmh > 0) {
      const distKm = haversineKm(last.lat, last.lng, currentHeading.lat, currentHeading.lng);
      etaSeconds = Math.round((distKm / speedKmh) * 3600);
    }
  }

  return {
    currentHeading,
    bearingDeg,
    speedKmh,
    etaSeconds,
    locationScope,
    locationType,
  };
}

const DRONE_TYPES: WeaponType[] = ['bpla', 'shahed'];

function areBothDrones(a: WeaponType, b: WeaponType): boolean {
  return DRONE_TYPES.includes(a) && DRONE_TYPES.includes(b);
}

function rowToLive(row: IncidentRow): LiveIncident {
  const trajectory = JSON.parse(row.trajectory) as TrajectoryPoint[];
  const last = trajectory[trajectory.length - 1];
  const scopeSource = last?.name ? resolvePlace(last.name) : null;
  const weaponType = row.weapon_type as WeaponType;
  const enrich = enrichLiveFields(trajectory, weaponType, null, scopeSource);
  return {
    id: row.id,
    weaponType,
    weaponTypeLabel: WEAPON_LABELS[weaponType] || row.weapon_type,
    weaponCount: row.weapon_count,
    status: row.status as 'active' | 'impact' | 'expired',
    trajectory,
    ...enrich,
    confidence: row.confidence,
    sourceChannels: JSON.parse(row.source_channels),
    firstSeenAt: row.first_seen_at,
    lastUpdatedAt: row.last_updated_at,
    color: WEAPON_COLORS[weaponType] || '#888',
  };
}

export type CorrelationResult =
  | { action: 'new'; incident: LiveIncident }
  | { action: 'update'; incident: LiveIncident }
  | null;

/**
 * Correlate a parsed event with existing incidents or create a new one.
 */
export function correlateEvent(event: ParsedEvent): CorrelationResult {
  if (!event.location && !event.heading && event.eventType === 'tracking') {
    return null; // not enough info to correlate
  }

  const activeRows = getActiveIncidents();

  let forcedRow: IncidentRow | null = null;
  if (
    event.continuesIncidentId &&
    (event.continuationConfidence ?? 0) >= CONTINUATION_CONFIDENCE_MIN
  ) {
    forcedRow = activeRows.find((r) => r.id === event.continuesIncidentId) ?? null;
  }

  let bestScore = 0;
  let bestRow: IncidentRow | null = null;

  if (forcedRow) {
    bestScore = 1;
    bestRow = forcedRow;
  }

  if (!forcedRow) {
  for (const row of activeRows) {
    let score = 0;
    const trajectory = JSON.parse(row.trajectory) as Array<{ lat: number; lng: number; timestamp: number; name: string }>;

    // Time window
    const timeDelta = event.sourceTimestamp - row.last_updated_at;
    if (timeDelta > 20 * 60) continue; // too old
    if (timeDelta < 5 * 60) score += 0.3;
    else score += 0.1;

    // Weapon type match
    if (event.weaponType === row.weapon_type) {
      score += 0.35;
    } else if (areBothDrones(event.weaponType, row.weapon_type as WeaponType)) {
      score += 0.15;
    }

    // Spatial continuity
    const lastPos = trajectory[trajectory.length - 1];
    const eventLat = event.location?.lat || event.heading?.lat;
    const eventLng = event.location?.lng || event.heading?.lng;
    if (lastPos && eventLat && eventLng) {
      const dist = haversineKm(eventLat, eventLng, lastPos.lat, lastPos.lng);
      if (dist < 5) score += 0.3;
      else if (dist < 15) score += 0.15;
      else if (dist > 30) score -= 0.2;
    }

    // Heading alignment
    if (event.heading && trajectory.length >= 2) {
      const prev = trajectory[trajectory.length - 2];
      const last = trajectory[trajectory.length - 1];
      const prevBearing = bearing(prev.lat, prev.lng, last.lat, last.lng);
      const newBearing = bearing(last.lat, last.lng, event.heading.lat, event.heading.lng);
      const angleDiff = Math.abs(prevBearing - newBearing);
      if (angleDiff < 30 || angleDiff > 330) score += 0.1;
    }

    // Count consistency
    if (event.weaponCount === row.weapon_count) score += 0.05;

    // Correction bonus
    if (event.isCorrection) score += 0.1;

    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }
  }

  if (bestScore >= 0.5 && bestRow) {
    // Append to existing incident
    const trajectory = JSON.parse(bestRow.trajectory) as Array<{ lat: number; lng: number; timestamp: number; name: string }>;
    const sourceChannels = JSON.parse(bestRow.source_channels) as string[];

    // Add new point to trajectory
    const newLat = event.location?.lat || event.heading?.lat;
    const newLng = event.location?.lng || event.heading?.lng;
    const newName = event.location?.canonicalName || event.heading?.canonicalName || '';
    if (newLat && newLng) {
      trajectory.push({ lat: newLat, lng: newLng, timestamp: event.sourceTimestamp, name: newName });
    }

    // Update channels
    if (!sourceChannels.includes(event.sourceChannel)) {
      sourceChannels.push(event.sourceChannel);
    }

    // Update status
    let status = bestRow.status;
    if (event.eventType === 'impact') status = 'impact';

    // Update confidence (average with new)
    const newConfidence = (bestRow.confidence + event.confidence) / 2;

    updateIncident(bestRow.id, {
      status,
      lastUpdatedAt: event.sourceTimestamp,
      weaponCount: Math.max(bestRow.weapon_count, event.weaponCount),
      sourceChannels,
      confidence: newConfidence,
      trajectory,
    });

    setEventIncidentId(event.id, bestRow.id);

    const weaponType = bestRow.weapon_type as WeaponType;
    const scopeSource = event.location ?? event.heading ?? null;
    const enrich = enrichLiveFields(trajectory, weaponType, event.heading ?? null, scopeSource);

    return {
      action: 'update',
      incident: {
        id: bestRow.id,
        weaponType,
        weaponTypeLabel: WEAPON_LABELS[weaponType] || bestRow.weapon_type,
        weaponCount: Math.max(bestRow.weapon_count, event.weaponCount),
        status: status as 'active' | 'impact' | 'expired',
        trajectory,
        ...enrich,
        confidence: newConfidence,
        sourceChannels,
        firstSeenAt: bestRow.first_seen_at,
        lastUpdatedAt: event.sourceTimestamp,
        color: WEAPON_COLORS[weaponType] || '#888',
      },
    };
  }

  // Create new incident
  const incidentId = uuid();
  const trajectory: Array<{ lat: number; lng: number; timestamp: number; name: string }> = [];
  const lat = event.location?.lat || event.heading?.lat;
  const lng = event.location?.lng || event.heading?.lng;
  const name = event.location?.canonicalName || event.heading?.canonicalName || '';
  if (lat && lng) {
    trajectory.push({ lat, lng, timestamp: event.sourceTimestamp, name });
  }

  const status = event.eventType === 'impact' ? 'impact' : 'active';

  insertIncident({
    id: incidentId,
    weaponType: event.weaponType,
    weaponCount: event.weaponCount,
    status,
    firstSeenAt: event.sourceTimestamp,
    lastUpdatedAt: event.sourceTimestamp,
    sourceChannels: [event.sourceChannel],
    confidence: event.confidence,
    trajectory,
  });

  setEventIncidentId(event.id, incidentId);

  const scopeSource = event.location ?? event.heading ?? null;
  const enrich = enrichLiveFields(trajectory, event.weaponType, event.heading ?? null, scopeSource);

  const incident: LiveIncident = {
    id: incidentId,
    weaponType: event.weaponType,
    weaponTypeLabel: WEAPON_LABELS[event.weaponType] || event.weaponType,
    weaponCount: event.weaponCount,
    status: status as 'active' | 'impact',
    trajectory,
    ...enrich,
    confidence: event.confidence,
    sourceChannels: [event.sourceChannel],
    firstSeenAt: event.sourceTimestamp,
    lastUpdatedAt: event.sourceTimestamp,
    color: WEAPON_COLORS[event.weaponType] || '#888',
  };

  return { action: 'new', incident };
}

/**
 * Expire stale active incidents (no update for 30 min).
 * Returns expired incident IDs.
 */
export function expireStaleIncidents(): string[] {
  const stale = getStaleActiveIncidents(30 * 60);
  const expired: string[] = [];
  for (const row of stale) {
    updateIncident(row.id, { status: 'expired' });
    expired.push(row.id);
  }
  return expired;
}

/**
 * Get all active incidents as LiveIncident objects.
 */
export function getActiveLiveIncidents(): LiveIncident[] {
  return getActiveIncidents().map(rowToLive);
}

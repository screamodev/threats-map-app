import L from 'leaflet';
import type { LiveIncident } from './types';
import {
  onSnapshot,
  onNewIncident,
  onUpdateIncident,
  onExpireIncident,
} from './connection';

interface IncidentVisuals {
  polyline: L.Polyline;
  headMarker: L.Marker | L.CircleMarker;
  headingArrow: L.Marker | null;
  label: L.Marker;
  incident: LiveIncident;
}

const incidentMap = new Map<string, IncidentVisuals>();
let mapRef: L.Map;

export function initLiveLayer(map: L.Map) {
  mapRef = map;

  onSnapshot((incidents) => {
    // Clear all existing
    for (const [id] of incidentMap) {
      removeVisuals(id);
    }
    for (const inc of incidents) {
      addIncident(inc);
    }
  });

  onNewIncident((inc) => {
    addIncident(inc);
  });

  onUpdateIncident((inc) => {
    updateIncident(inc);
  });

  onExpireIncident((id) => {
    fadeAndRemove(id);
  });
}

function addIncident(inc: LiveIncident) {
  if (incidentMap.has(inc.id)) {
    updateIncident(inc);
    return;
  }

  const coords = inc.trajectory.map(
    (p) => [p.lat, p.lng] as [number, number]
  );

  // Trajectory polyline
  const polyline = L.polyline(coords, {
    color: inc.color,
    weight: 3,
    opacity: 0.7,
    dashArray: '6 4',
  }).addTo(mapRef);

  // Head marker
  const headPos = coords[coords.length - 1] || [49.99, 36.23];
  const headMarker = createHeadMarker(inc, headPos);

  const headingArrow = shouldShowHeadingArrow(inc, coords.length)
    ? createHeadingArrowMarker(inc, headPos)
    : null;

  const label = L.marker(headPos, {
    icon: buildLabelIcon(inc),
    interactive: false,
  }).addTo(mapRef);

  incidentMap.set(inc.id, { polyline, headMarker, headingArrow, label, incident: inc });
}

function updateIncident(inc: LiveIncident) {
  const vis = incidentMap.get(inc.id);
  if (!vis) {
    addIncident(inc);
    return;
  }

  const coords = inc.trajectory.map(
    (p) => [p.lat, p.lng] as [number, number]
  );
  vis.polyline.setLatLngs(coords);

  const headPos = coords[coords.length - 1] || [49.99, 36.23];

  // Replace head marker if status changed to impact
  if (inc.status === 'impact' && vis.incident.status !== 'impact') {
    vis.headMarker.remove();
    vis.headMarker = createImpactMarker(inc.color, headPos);
  } else {
    vis.headMarker.setLatLng(headPos);
  }

  if (vis.headingArrow) {
    vis.headingArrow.remove();
    vis.headingArrow = null;
  }
  if (shouldShowHeadingArrow(inc, coords.length)) {
    vis.headingArrow = createHeadingArrowMarker(inc, headPos);
  }

  vis.label.setLatLng(headPos);
  vis.label.setIcon(buildLabelIcon(inc));
  vis.incident = inc;
}

function shouldShowHeadingArrow(inc: LiveIncident, trajectoryLen: number): boolean {
  return (
    trajectoryLen > 0 &&
    inc.status !== 'impact' &&
    inc.bearingDeg !== null &&
    inc.etaSeconds !== null
  );
}

function arrowLengthPx(speedKmh: number): number {
  const speed = Math.max(0, speedKmh);
  const min = 28;
  const max = 72;
  const t = Math.min(1, speed / 2200);
  return Math.round(min + t * (max - min));
}

function formatEta(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function buildLabelText(inc: LiveIncident): string {
  let text = `${inc.weaponTypeLabel} x${inc.weaponCount} · ~${inc.speedKmh} km/h`;
  if (inc.bearingDeg !== null && inc.etaSeconds !== null) {
    text += ` · ETA ${formatEta(inc.etaSeconds)}`;
  }
  return text;
}

function buildLabelIcon(inc: LiveIncident): L.DivIcon {
  return L.divIcon({
    className: 'live-label',
    html: `<span style="border-color:${inc.color}">${buildLabelText(inc)}</span>`,
    iconSize: [320, 22],
    iconAnchor: [160, -12],
  });
}

function createHeadingArrowMarker(
  inc: LiveIncident,
  headPos: [number, number]
): L.Marker {
  const len = arrowLengthPx(inc.speedKmh);
  const w = 14;
  const h = len + 10;
  const cx = w / 2;
  const tipY = 4;
  const stemBottom = h - 2;
  const stemTop = 14;
  const bearing = inc.bearingDeg ?? 0;
  const html = `<div class="live-heading-arrow" style="width:${w}px;height:${h}px;transform:rotate(${bearing}deg);transform-origin:${cx}px ${stemBottom}px;">
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block" aria-hidden="true">
      <line x1="${cx}" y1="${stemBottom}" x2="${cx}" y2="${stemTop}" stroke="${inc.color}" stroke-width="2.25" stroke-linecap="round" opacity="0.9"/>
      <polygon points="${cx},${tipY} ${cx - 5.5},${stemTop} ${cx + 5.5},${stemTop}" fill="${inc.color}"/>
    </svg>
  </div>`;
  return L.marker(headPos, {
    icon: L.divIcon({
      className: 'live-heading-arrow-icon',
      html,
      iconSize: [w, h],
      iconAnchor: [cx, stemBottom],
    }),
    interactive: false,
    zIndexOffset: 450,
  }).addTo(mapRef);
}

function createHeadMarker(inc: LiveIncident, pos: [number, number]): L.CircleMarker {
  const marker = L.circleMarker(pos, {
    radius: 6,
    fillColor: inc.color,
    color: '#fff',
    fillOpacity: 1,
    weight: 2,
    className: 'live-head-marker',
  }).addTo(mapRef);

  // Pulse effect
  const pulseIcon = L.divIcon({
    className: 'pulse-marker',
    html: `<div class="pulse-ring" style="background:${inc.color}"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  L.marker(pos, { icon: pulseIcon, interactive: false }).addTo(mapRef);

  return marker;
}

function createImpactMarker(color: string, pos: [number, number]): L.Marker {
  const icon = L.divIcon({
    className: 'explosion-marker',
    html: `<div class="explosion-ring" style="border-color:${color}"></div><span class="explosion-icon">&#128165;</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
  return L.marker(pos, { icon, interactive: false }).addTo(mapRef);
}

function fadeAndRemove(id: string) {
  const vis = incidentMap.get(id);
  if (!vis) return;

  // Fade opacity over ~3 seconds using CSS transition on the container
  const el = (vis.polyline as any)._path as SVGElement | undefined;
  if (el) {
    el.style.transition = 'opacity 3s';
    el.style.opacity = '0';
  }

  setTimeout(() => removeVisuals(id), 3000);
}

function removeVisuals(id: string) {
  const vis = incidentMap.get(id);
  if (!vis) return;
  vis.polyline.remove();
  vis.headMarker.remove();
  vis.headingArrow?.remove();
  vis.label.remove();
  incidentMap.delete(id);
}

export function getActiveIncidents(): LiveIncident[] {
  return Array.from(incidentMap.values()).map((v) => v.incident);
}

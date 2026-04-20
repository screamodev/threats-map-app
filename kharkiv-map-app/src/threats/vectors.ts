import L from 'leaflet';
import { attackVectors } from '../data/attack-vectors';
import type { AttackVector } from '../types';

interface AnimState {
  startTime: number;
  marker: L.CircleMarker;
  line: L.Polyline;
  vector: AttackVector;
  trail: L.Polyline;
}

function interpolate(from: [number, number], to: [number, number], t: number): [number, number] {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
  ];
}

function midpoint(from: [number, number], to: [number, number]): [number, number] {
  return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
}

export function addAttackVectors(map: L.Map): void {
  const anims: AnimState[] = [];

  for (let i = 0; i < attackVectors.length; i++) {
    const v = attackVectors[i];
    const delay = i * 2000; // stagger starts

    // Static trajectory line (faint)
    const staticLine = L.polyline([v.origin, v.target], {
      color: v.color,
      weight: 1.5,
      opacity: 0.15,
      dashArray: v.dashArray || '4 4',
    }).addTo(map);

    // Arrowhead at midpoint
    addArrowhead(map, v);

    // Attack label at midpoint
    const mid = midpoint(v.origin, v.target);
    const labelIcon = L.divIcon({
      className: 'attack-label',
      html: `<span class="weapon-name">${v.weaponNameUk}</span><span class="flight-time">${v.flightTimeLabel}</span>`,
      iconSize: [120, 24],
      iconAnchor: [60, -8],
    });
    L.marker(mid, { icon: labelIcon, interactive: false }).addTo(map);

    // Animated trail
    const trail = L.polyline([], {
      color: v.color,
      weight: 3,
      opacity: 0.6,
      dashArray: v.dashArray,
    }).addTo(map);

    // Moving projectile marker
    const marker = L.circleMarker(v.origin, {
      radius: 5,
      fillColor: v.color,
      color: v.color,
      fillOpacity: 1,
      weight: 0,
      className: 'projectile-marker',
    }).addTo(map);

    // Pulse at origin
    addPulse(map, v.origin, v.color);

    anims.push({
      startTime: performance.now() + delay,
      marker,
      line: staticLine,
      vector: v,
      trail,
    });
  }

  function animate(now: number) {
    for (const a of anims) {
      const elapsed = now - a.startTime;
      const duration = a.vector.flightDurationMs;
      const cycle = duration + 2000; // flight + pause

      const t = Math.max(0, (elapsed % cycle) / duration);

      if (t > 1) {
        // In pause phase — hide
        a.marker.setStyle({ opacity: 0, fillOpacity: 0 });
        a.trail.setLatLngs([]);
      } else {
        const pos = interpolate(a.vector.origin, a.vector.target, t);
        a.marker.setLatLng(pos);
        a.marker.setStyle({ opacity: 1, fillOpacity: 1 });

        // Trail: last 20% of path
        const trailStart = Math.max(0, t - 0.2);
        const steps = 10;
        const trailCoords: [number, number][] = [];
        for (let s = 0; s <= steps; s++) {
          const tt = trailStart + (t - trailStart) * (s / steps);
          trailCoords.push(interpolate(a.vector.origin, a.vector.target, tt));
        }
        a.trail.setLatLngs(trailCoords);
      }
    }
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

function addArrowhead(map: L.Map, v: AttackVector): void {
  // Simple triangle arrowhead using a divIcon at ~60% of the path
  const t = 0.6;
  const pos = interpolate(v.origin, v.target, t);

  // Calculate angle
  const dy = v.target[0] - v.origin[0];
  const dx = v.target[1] - v.origin[1];
  const angle = Math.atan2(dx, dy) * (180 / Math.PI);

  const icon = L.divIcon({
    className: '',
    html: `<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${180 + angle}deg)">
      <polygon points="8,0 0,16 16,16" fill="${v.color}" opacity="0.5"/>
    </svg>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  L.marker(pos, { icon, interactive: false }).addTo(map);
}

function addPulse(map: L.Map, coords: [number, number], color: string): void {
  const icon = L.divIcon({
    className: 'pulse-marker',
    html: `
      <div class="pulse-ring" style="background:${color}"></div>
      <div class="pulse-ring" style="background:${color};animation-delay:1s"></div>
      <div style="width:8px;height:8px;border-radius:50%;background:${color};position:absolute;top:50%;left:50%;margin-top:-4px;margin-left:-4px"></div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  L.marker(coords, { icon, interactive: false }).addTo(map);
}

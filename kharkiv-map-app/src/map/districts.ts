import L from 'leaflet';
import { districtRisks, osmNameToId } from '../data/district-risk';
import { RISK_COLORS, RISK_LABELS_UK, type DistrictRisk } from '../types';
import { onDistrictRisk } from '../live/connection';
import type { DangerLevel } from '../live/types';

const DANGER_COLORS: Record<Exclude<DangerLevel, null>, string> = {
  red: '#ff1744',
  orange: '#ff9100',
  green: '#2e7d32',
};

const DANGER_FILL_OPACITY: Record<Exclude<DangerLevel, null>, number> = {
  red: 0.55,
  orange: 0.5,
  green: 0.4,
};

const DANGER_WEIGHT: Record<Exclude<DangerLevel, null>, number> = {
  red: 3.5,
  orange: 3,
  green: 2.5,
};

interface DistrictLayerEntry {
  layer: L.Path;
  osmName: string;
  districtId: string | null;
  district: DistrictRisk | undefined;
}

const layersByDistrictId = new Map<string, DistrictLayerEntry>();
let currentLevels: Record<string, DangerLevel> = {};

function findDistrict(name: string): DistrictRisk | undefined {
  const id = osmNameToId[name];
  if (id) return districtRisks.find((d) => d.id === id);
  for (const d of districtRisks) {
    if (name.includes(d.nameUk)) return d;
  }
  return undefined;
}

function staticStyle(district: DistrictRisk | undefined): L.PathOptions {
  const color = district ? RISK_COLORS[district.riskLevel] : '#555';
  return {
    fillColor: color,
    fillOpacity: 0.35,
    color: color,
    weight: 2.5,
    opacity: 0.8,
  };
}

function dangerStyle(level: Exclude<DangerLevel, null>): L.PathOptions {
  const color = DANGER_COLORS[level];
  return {
    fillColor: color,
    fillOpacity: DANGER_FILL_OPACITY[level],
    color: color,
    weight: DANGER_WEIGHT[level],
    opacity: 0.95,
  };
}

function applyStyle(entry: DistrictLayerEntry): void {
  const live = entry.districtId ? currentLevels[entry.districtId] ?? null : null;
  if (live) {
    entry.layer.setStyle(dangerStyle(live));
  } else {
    entry.layer.setStyle(staticStyle(entry.district));
  }

  const el = (entry.layer as unknown as { _path?: SVGElement })._path;
  if (el) {
    el.classList.toggle('district-pulse-red', live === 'red');
  }
}

function applyAll(): void {
  for (const entry of layersByDistrictId.values()) {
    applyStyle(entry);
  }
}

function createTooltipContent(district: DistrictRisk): string {
  const riskColor = RISK_COLORS[district.riskLevel];
  const riskLabel = RISK_LABELS_UK[district.riskLevel];
  return `
    <div class="district-tooltip">
      <div class="tooltip-name">${district.nameUk} район</div>
      <div class="tooltip-risk">
        <span class="tooltip-risk-dot" style="background:${riskColor}"></span>
        Рівень загрози: <strong>${riskLabel}</strong>
      </div>
      <div class="tooltip-desc">${district.description}</div>
      ${district.hasMetro ? '<div class="tooltip-desc" style="color:#64b5f6;margin-top:2px">🚇 Є станції метро (укриття)</div>' : ''}
    </div>
  `;
}

export async function addDistrictsLayer(map: L.Map): Promise<void> {
  let geojson: GeoJSON.FeatureCollection;
  try {
    const resp = await fetch('/data/districts.geojson');
    geojson = await resp.json();
  } catch {
    console.warn('Could not load districts GeoJSON');
    return;
  }

  L.geoJSON(geojson, {
    style(feature) {
      const name = feature?.properties?.name || feature?.properties?.['name:uk'] || '';
      const district = findDistrict(name);
      return staticStyle(district);
    },
    onEachFeature(feature, layer) {
      const name = feature?.properties?.name || feature?.properties?.['name:uk'] || '';
      const district = findDistrict(name);
      const districtId = osmNameToId[name] ?? district?.id ?? null;

      const entry: DistrictLayerEntry = {
        layer: layer as L.Path,
        osmName: name,
        districtId,
        district,
      };
      if (districtId) {
        layersByDistrictId.set(districtId, entry);
      }

      applyStyle(entry);

      if (district) {
        layer.bindTooltip(createTooltipContent(district), {
          sticky: true,
          className: 'district-tooltip',
          direction: 'top',
          offset: [0, -10],
        });
      }
      layer.on({
        mouseover(e) {
          const l = e.target as L.Path;
          l.setStyle({ fillOpacity: 0.5, weight: 3 });
          l.bringToFront();
        },
        mouseout() {
          applyStyle(entry);
        },
      });
    },
  }).addTo(map);

  onDistrictRisk((payload) => {
    currentLevels = payload.levels ?? {};
    applyAll();
  });
}

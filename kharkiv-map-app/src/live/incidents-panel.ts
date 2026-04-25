import { onSnapshot, onNewIncident, onUpdateIncident, onExpireIncident } from './connection';
import type { LiveIncident } from './types';
import { getTargetInfo, getWeaponVisualMeta } from './weapon-visuals';

const incidents = new Map<string, LiveIncident>();
let panelEl: HTMLElement | null = null;

export function initIncidentsPanel() {
  panelEl = document.getElementById('incidents-panel');
  if (!panelEl) return;

  onSnapshot((list) => {
    incidents.clear();
    for (const inc of list) incidents.set(inc.id, inc);
    render();
  });

  onNewIncident((inc) => {
    incidents.set(inc.id, inc);
    render();
  });

  onUpdateIncident((inc) => {
    incidents.set(inc.id, inc);
    render();
  });

  onExpireIncident((id) => {
    incidents.delete(id);
    render();
  });

  render();
}

function render() {
  if (!panelEl) return;

  const sorted = Array.from(incidents.values()).sort(
    (a, b) => b.lastUpdatedAt - a.lastUpdatedAt
  );

  if (sorted.length === 0) {
    panelEl.innerHTML = `<div class="incidents-empty">Активних загроз немає</div>`;
    return;
  }

  panelEl.innerHTML = sorted.map((inc) => {
    const statusClass = inc.status === 'impact' ? 'impact' : inc.status === 'expired' ? 'expired' : 'active';
    const statusLabel = inc.status === 'impact' ? 'Влучання' : inc.status === 'expired' ? 'Завершено' : 'Активна';
    const lastPoint = inc.trajectory[inc.trajectory.length - 1];
    const locationName = lastPoint?.name || inc.currentHeading?.name || '—';
    const ago = formatAgo(inc.lastUpdatedAt);
    const info = inc.targetInfo ?? getTargetInfo(inc);
    const visual = getWeaponVisualMeta(inc.weaponType);
    const ambiguity = info.ambiguityFlags?.length
      ? info.ambiguityFlags.join(', ')
      : 'немає';
    const interpretedSlang = info.interpretedSlang ?? '—';
    const threatNotes = info.threatNotes ?? '—';
    const detectionSource = info.detectionSource ?? '—';

    return `
      <div class="incident-card ${statusClass}">
        <div class="incident-header">
          <span class="incident-weapon" style="color:${inc.color}">
            <span class="incident-weapon-icon incident-weapon-icon--${visual.shape}">
              ${
                visual.iconPath
                  ? `<img class="incident-weapon-icon__img" src="${visual.iconPath}" alt="${inc.weaponTypeLabel}" />`
                  : `<span class="incident-weapon-icon__label">${visual.icon}</span>`
              }
            </span>
            ${inc.weaponTypeLabel} x${inc.weaponCount}
          </span>
          <span class="incident-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="incident-location">${locationName}</div>
        <div class="incident-meta">
          <span>${ago}</span>
          <span>Впевненість: ${Math.round(inc.confidence * 100)}%</span>
        </div>
        <details class="target-info-panel">
          <summary>Target Info</summary>
          <div class="target-info-grid">
            <span>Canonical type</span><span>${info.canonicalType}</span>
            <span>Interpreted slang</span><span>${interpretedSlang}</span>
            <span>Confidence</span><span>${Math.round(info.confidence * 100)}%</span>
            <span>Detection source</span><span>${detectionSource}</span>
            <span>Ambiguity flags</span><span>${ambiguity}</span>
            <span>Threat notes</span><span>${threatNotes}</span>
          </div>
        </details>
      </div>
    `;
  }).join('');
}

function formatAgo(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return `${diff} сек тому`;
  if (diff < 3600) return `${Math.floor(diff / 60)} хв тому`;
  return `${Math.floor(diff / 3600)} год тому`;
}

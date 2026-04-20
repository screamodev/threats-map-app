import { RISK_COLORS, RISK_LABELS_UK, type RiskLevel } from '../types';

export function renderLegend(): void {
  const el = document.getElementById('legend');
  if (!el) return;

  const riskLevels: RiskLevel[] = ['high', 'medium', 'med-low', 'low'];

  el.innerHTML = `
    <div class="legend-connection">
      <div id="connection-dot" class="connection-dot disconnected" title="Від'єднано"></div>
      <span>Live</span>
    </div>
    <div class="legend-separator"></div>
    <h4>Рівень загрози</h4>
    ${riskLevels
      .map(
        (level) => `
      <div class="legend-item">
        <div class="legend-color" style="background:${RISK_COLORS[level]}"></div>
        ${RISK_LABELS_UK[level]}
      </div>
    `
      )
      .join('')}
  `;
}

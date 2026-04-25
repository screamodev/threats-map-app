import { onDistrictRisk } from '../live/connection';
import type { DangerLevel } from '../live/types';

/** Ukrainian "N район(и/ів)" for cardinal N ≥ 0 */
function ukRayonPhrase(n: number): string {
  if (n === 0) return '0 районів';
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} районів`;
  if (mod10 === 1) return `${n} район`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} райони`;
  return `${n} районів`;
}

function riskSubtitleFromLevels(levels: Record<string, DangerLevel>): string {
  let red = 0;
  let orange = 0;
  for (const v of Object.values(levels)) {
    if (v === 'red') red++;
    else if (v === 'orange') orange++;
  }

  if (red === 0 && orange === 0) {
    return 'Цілей немає: місто в зеленій зоні (live)';
  }

  const left =
    red === 0 ? 'Немає районів під загрозою' : `${ukRayonPhrase(red)} під загрозою`;
  const right =
    orange === 0
      ? 'немає в очікуванні'
      : `${ukRayonPhrase(orange)} в очікуванні`;

  return `${left} / ${right}`;
}

function updateRiskSubtitle(el: HTMLElement, levels: Record<string, DangerLevel>) {
  el.textContent = riskSubtitleFromLevels(levels);
}

export function renderSidebar(): void {
  const content = document.getElementById('sidebar-content');
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const panel = document.getElementById('incidents-panel');
  if (!content || !toggle || !sidebar) return;

  content.innerHTML = `
    <h1>Карта загроз Харкова</h1>
    <p class="subtitle" id="sidebar-risk-subtitle">Очікування даних live…</p>
    <div class="dev-controls" id="dev-controls"></div>
  `;
  if (panel) panel.style.display = '';

  const riskSubtitle = document.getElementById('sidebar-risk-subtitle');
  if (riskSubtitle) {
    onDistrictRisk((payload) => {
      updateRiskSubtitle(riskSubtitle, payload.levels ?? {});
    });
  }

  const isDevUi =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '0.0.0.0';

  const devControls = document.getElementById('dev-controls');
  if (devControls && isDevUi) {
    devControls.innerHTML = '<button class="dev-btn" id="dev-clear-targets-btn">[dev] clear targets</button>';
    const clearBtn = document.getElementById('dev-clear-targets-btn');
    clearBtn?.addEventListener('click', async () => {
      const btn = clearBtn as HTMLButtonElement;
      if (btn.disabled) return;
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = '[dev] clearing...';
      try {
        const resp = await fetch('/api/dev/clear-targets', { method: 'POST' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        btn.textContent = '[dev] cleared';
        setTimeout(() => {
          btn.textContent = prev ?? '[dev] clear targets';
          btn.disabled = false;
        }, 900);
      } catch {
        btn.textContent = '[dev] failed';
        setTimeout(() => {
          btn.textContent = prev ?? '[dev] clear targets';
          btn.disabled = false;
        }, 1500);
      }
    });
  }

  // Toggle sidebar
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });
}

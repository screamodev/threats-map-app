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
    return 'Немає активної загрози по районах (live)';
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

    <div class="sidebar-tabs">
      <button class="sidebar-tab active" data-tab="info">Інфо</button>
      <button class="sidebar-tab" data-tab="live">Live</button>
    </div>

    <div class="tab-content" id="tab-info">
      <div class="info-card warning">
        <h3>С-300 з Бєлгорода</h3>
        <p>Зенітні ракети С-300 запускаються з Бєлгородської області (відстань ~70 км). Час підльоту — лише <strong>49 секунд</strong>. Основний напрямок ударів — по північних районах міста. Через мінімальний час реагування повітряна тривога часто лунає вже після влучання.</p>
      </div>

      <div class="info-card warning">
        <h3>КАБ — керовані авіабомби</h3>
        <p>Росія скидає КАБ-500/КАБ-1500 з літаків Су-34 зі сходу та північного сходу. Час підльоту — <strong>3–4 хвилини</strong>. Вага бомби до 1500 кг — масштабні руйнування. Активне використання з 2024 року.</p>
      </div>

      <div class="info-card info">
        <h3>Шахед-136 (дрони)</h3>
        <p>Іранські дрони-камікадзе запускаються зі сходу. Час підльоту — <strong>30–60 хвилин</strong>. Повільні, але важко перехоплюються у великій кількості. Часто летять зграями по 5–10 одиниць.</p>
      </div>

      <div class="info-card warning">
        <h3>Іскандер</h3>
        <p>Балістичні ракети «Іскандер-М» запускаються з глибини Росії. Час підльоту — близько <strong>60 секунд</strong>. Гіперзвукова швидкість робить перехоплення вкрай складним.</p>
      </div>

      <div class="info-card safe">
        <h3>Відносно безпечніші райони</h3>
        <p>Південні райони міста (<strong>Новобаварський</strong> та <strong>Основ'янський</strong>) є найвіддаленішими від кордону з РФ та лінії фронту. Статистично зазнають менше ударів.</p>
      </div>

      <div class="info-card info">
        <h3>Станції метро як укриття</h3>
        <p>Харківське метро — найнадійніше укриття від обстрілів. Більшість районів мають станції метро. Глибина залягання — до 30 метрів. Районі без метро: <strong>Індустріальний</strong> та <strong>Новобаварський</strong>.</p>
      </div>

      <div class="info-card info">
        <h3>Чому південь безпечніший</h3>
        <p>Основні напрямки ударів — з півночі (Бєлгород, С-300) та північного сходу (КАБи). Південні райони знаходяться на максимальній відстані від цих напрямків. Додатковий фактор — рельєф та міська забудова створюють природній «щит».</p>
      </div>
    </div>
  `;

  // Tab switching
  const tabs = content.querySelectorAll('.sidebar-tab');
  const infoTab = document.getElementById('tab-info');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = (tab as HTMLElement).dataset.tab;
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      if (target === 'info') {
        if (infoTab) infoTab.style.display = '';
        if (panel) panel.style.display = 'none';
      } else {
        if (infoTab) infoTab.style.display = 'none';
        if (panel) panel.style.display = '';
      }
    });
  });

  // Initially hide live panel
  if (panel) panel.style.display = 'none';

  const riskSubtitle = document.getElementById('sidebar-risk-subtitle');
  if (riskSubtitle) {
    onDistrictRisk((payload) => {
      updateRiskSubtitle(riskSubtitle, payload.levels ?? {});
    });
  }

  // Toggle sidebar
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });
}

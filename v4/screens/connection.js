/* ── Connection Screen — Guided Onboarding Flow ── */
import { api, navigate, state, refreshConnectionNow, on } from '../app.js';

let container = null;
let busCleanup = null;

// ═══════════════════════════════════════════════════════════════
//  RENDER — Single source of truth: state.connectionStatus
// ═══════════════════════════════════════════════════════════════
function renderFromState() {
  if (!container) return;

  const status = state.connectionStatus;

  // ── Map status → user-facing content ──
  const stages = getStages(status);

  container.innerHTML = `
    <div style="overflow-y:auto;padding:24px;flex:1;display:flex;align-items:center;justify-content:center">
      <div class="conn-card">
        <div class="conn-header">
          <div class="conn-icon">
            <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </div>
          <div class="conn-title">Подключение к Higgsfield</div>
          <div class="conn-subtitle">Генерация изображений через Chrome</div>
        </div>
        <div class="conn-body">
          <div class="conn-status ${stages.statusClass}">
            <div class="cs-dot"></div>
            <span class="cs-text">${stages.statusText}</span>
          </div>
          <div class="conn-hint">${stages.hint}</div>
          ${stages.stepsHTML}
          <div class="conn-actions">${stages.actionsHTML}</div>
        </div>
      </div>
    </div>
  `;

  // ── Bind buttons ──
  bindActions(status);
}

// ═══════════════════════════════════════════════════════════════
//  STAGES — Linear guided flow
// ═══════════════════════════════════════════════════════════════
function getStages(status) {
  // Steps are always the same 3, but with different done/active states
  const stepLabels = ['Запустить Chrome', 'Войти в Higgsfield', 'Открыть генерацию', 'Готово'];

  switch (status) {
    case 'no_chrome':
      return {
        statusClass: 'offline',
        statusText: 'Chrome не установлен',
        hint: 'Для работы Mews нужен Google Chrome. Установите его и перезапустите Mews.',
        stepsHTML: buildSteps(stepLabels, 0),
        actionsHTML: `
          <a id="btn-install-chrome" class="btn btn-primary" href="https://www.google.com/chrome/" target="_blank" style="width:100%;text-align:center;text-decoration:none">
            Скачать Chrome
          </a>
        `,
      };

    case 'chrome_stopped':
      return {
        statusClass: 'offline',
        statusText: 'Chrome не запущен',
        hint: 'Нажмите кнопку ниже — Chrome откроется с нужными настройками.',
        stepsHTML: buildSteps(stepLabels, 0),
        actionsHTML: `
          <button id="btn-launch" class="btn btn-primary" style="width:100%">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
            Запустить Chrome
          </button>
        `,
      };

    case 'chrome_running':
      return {
        statusClass: 'warning',
        statusText: 'Подключение к Chrome…',
        hint: 'Chrome запущен. Устанавливаю соединение…',
        stepsHTML: buildSteps(stepLabels, 0, true),
        actionsHTML: `
          <button id="btn-connect" class="btn btn-primary" style="width:100%">
            <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Подключиться
          </button>
        `,
      };

    case 'not_logged_in':
      return {
        statusClass: 'warning',
        statusText: 'Войдите в Higgsfield',
        hint: 'Chrome подключён. Нажмите «Проверить» — Mews попробует восстановить сохранённую сессию. Если не получится, откройте Chrome и войдите вручную.',
        stepsHTML: buildSteps(stepLabels, 1),
        actionsHTML: `
          <button id="btn-open-higgsfield" class="btn btn-secondary" style="flex:1">
            Открыть Higgsfield ↗
          </button>
          <button id="btn-recheck" class="btn btn-primary" style="flex:1">
            <svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Проверить
          </button>
        `,
      };

    case 'page_not_ready':
      return {
        statusClass: 'warning',
        statusText: 'Откройте страницу генерации',
        hint: 'Вы авторизованы. Нажмите кнопку — Mews откроет нужную страницу в Chrome автоматически.',
        stepsHTML: buildSteps(stepLabels, 2),
        actionsHTML: `
          <button id="btn-open-model" class="btn btn-primary" style="width:100%">
            <svg viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            Открыть страницу генерации
          </button>
        `,
      };

    case 'ready':
      return {
        statusClass: 'online',
        statusText: 'Готово к генерации',
        hint: 'Higgsfield подключён, авторизован, страница генерации открыта. Можно создавать изображения.',
        stepsHTML: buildSteps(stepLabels, 4),
        actionsHTML: `
          <button id="btn-go-projects" class="btn btn-primary" style="width:100%">
            Перейти к проектам →
          </button>
        `,
      };

    default: // 'unknown' or transient
      return {
        statusClass: 'offline',
        statusText: 'Проверяю…',
        hint: 'Определяю состояние подключения…',
        stepsHTML: buildSteps(stepLabels, -1),
        actionsHTML: `
          <button id="btn-recheck" class="btn btn-primary" style="width:100%">
            Проверить подключение
          </button>
        `,
      };
  }
}

/**
 * Build the step indicator.
 * @param {string[]} labels
 * @param {number} activeIndex — which step is active (0-2). 3 = all done. -1 = none.
 * @param {boolean} [activeIsPending] — show spinner instead of number
 */
function buildSteps(labels, activeIndex, activeIsPending = false) {
  let html = '<div class="conn-steps">';
  for (let i = 0; i < labels.length; i++) {
    if (i < activeIndex) {
      html += `<div class="conn-step done"><span class="conn-step-num">✓</span><span>${labels[i]}</span></div>`;
    } else if (i === activeIndex) {
      const num = activeIsPending ? '⟳' : (i + 1);
      html += `<div class="conn-step active"><span class="conn-step-num">${num}</span><span>${labels[i]}</span></div>`;
    } else {
      html += `<div class="conn-step"><span class="conn-step-num">${i + 1}</span><span>${labels[i]}</span></div>`;
    }
  }
  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════════════
//  ACTIONS — Button handlers
// ═══════════════════════════════════════════════════════════════
function bindActions(status) {
  // Launch
  container.querySelector('#btn-launch')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-launch');
    if (btn) { btn.disabled = true; btn.textContent = 'Запускаю Chrome…'; }
    const r = await api.chrome.launch();
    if (r.success) {
      await api.chrome.connect();
    }
    await refreshConnectionNow();
  });

  // Connect
  container.querySelector('#btn-connect')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-connect');
    if (btn) { btn.disabled = true; btn.textContent = 'Подключаюсь…'; }
    await api.chrome.connect();
    await refreshConnectionNow();
  });

  // Open Higgsfield — real navigation to model page
  container.querySelector('#btn-open-higgsfield')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-open-higgsfield');
    if (btn) { btn.disabled = true; btn.textContent = 'Открываю…'; }
    try {
      const result = await api.chrome.openModelPage();
      if (!result.success && result.needsAuth) {
        // Still needs auth — just refresh status
      }
    } catch {}
    await refreshConnectionNow();
    if (btn) { btn.disabled = false; btn.textContent = 'Открыть Higgsfield ↗'; }
  });

  // Open model/generation page — real navigation
  container.querySelector('#btn-open-model')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-open-model');
    if (btn) { btn.disabled = true; btn.textContent = 'Открываю…'; }
    try {
      await api.chrome.openModelPage();
    } catch {}
    await refreshConnectionNow();
    if (btn) { btn.disabled = false; btn.textContent = 'Открыть страницу генерации'; }
  });

  // Recheck
  container.querySelector('#btn-recheck')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-recheck');
    if (btn) { btn.disabled = true; btn.textContent = 'Проверяю…'; }
    await api.chrome.connect();
    await refreshConnectionNow();
    if (btn) { btn.disabled = false; }
  });

  // Go to projects
  container.querySelector('#btn-go-projects')?.addEventListener('click', () => navigate('projects'));
}

// ═══════════════════════════════════════════════════════════════
//  MOUNT / UNMOUNT
// ═══════════════════════════════════════════════════════════════
export default {
  id: 'connection',
  async mount(c) {
    container = c;
    busCleanup = on('connection-changed', () => renderFromState());
    await refreshConnectionNow();
    renderFromState();
  },
  unmount() {
    if (busCleanup) busCleanup();
    busCleanup = null;
    container = null;
  },
};

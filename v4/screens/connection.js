/* ── Connection Screen ── */
import { api, navigate, state, refreshConnectionNow, on } from '../app.js';

let container = null;
let busCleanup = null;

// ── Render from shared state ──
// This screen ONLY reads from state.connectionStatus + state.connectionDetail.
// It never makes its own independent chrome:status calls.
function renderFromState() {
  if (!container) return;

  const detail = state.connectionDetail || {};
  const status = state.connectionStatus;

  const connected = detail.cdpConnected || false;
  const chromeRunning = detail.chromeRunning || false;
  const hasSession = detail.hasSession || false;
  const sessionAge = detail.sessionAge || null;

  // ── Visual state derived from canonical status ──
  let statusClass, statusText, statusHint;
  if (status === 'connected') {
    statusClass = 'online';
    statusText = 'Подключено к Higgsfield';
    if (hasSession && sessionAge) {
      statusHint = `Активная сессия · ${sessionAge}`;
    } else if (hasSession) {
      statusHint = 'Сессия сохранена';
    } else {
      statusHint = 'Сессия не сохранена — рекомендуем сохранить';
    }
  } else if (status === 'chrome_running') {
    statusClass = 'warning';
    statusText = 'Chrome запущен, но нет связи';
    statusHint = 'Chrome открыт, но CDP-соединение не установлено. Нажмите «Подключиться».';
  } else {
    statusClass = 'offline';
    statusText = 'Нет подключения';
    if (hasSession && sessionAge) {
      statusHint = `Сохранённая сессия · ${sessionAge}`;
    } else if (hasSession) {
      statusHint = 'Есть сохранённая сессия. Запустите Chrome для автоподключения.';
    } else {
      statusHint = 'Запустите Chrome и войдите в аккаунт Higgsfield.';
    }
  }

  // ── Buttons by state ──
  let actionsHTML = '';
  let stepsHTML = '';

  if (!chromeRunning) {
    actionsHTML = `
      <button id="btn-launch" class="btn btn-primary" style="width:100%">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
        Запустить Chrome
      </button>
    `;
    stepsHTML = `
      <div class="conn-steps">
        <div class="conn-step active"><span class="conn-step-num">1</span><span>Запустите Chrome</span></div>
        <div class="conn-step"><span class="conn-step-num">2</span><span>Подключитесь к браузеру</span></div>
        <div class="conn-step"><span class="conn-step-num">3</span><span>Перейдите к проектам</span></div>
      </div>
    `;
  } else if (!connected) {
    actionsHTML = `
      <button id="btn-connect" class="btn btn-primary" style="width:100%">
        <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        Подключиться
      </button>
    `;
    stepsHTML = `
      <div class="conn-steps">
        <div class="conn-step done"><span class="conn-step-num">✓</span><span>Chrome запущен</span></div>
        <div class="conn-step active"><span class="conn-step-num">2</span><span>Подключитесь к браузеру</span></div>
        <div class="conn-step"><span class="conn-step-num">3</span><span>Перейдите к проектам</span></div>
      </div>
    `;
  } else {
    actionsHTML = `
      <button id="btn-save-session" class="btn btn-secondary" style="flex:1">
        <svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        ${hasSession ? 'Обновить сессию' : 'Сохранить сессию'}
      </button>
      <button id="btn-go-projects" class="btn btn-primary" style="flex:1">
        К проектам →
      </button>
    `;
    stepsHTML = `
      <div class="conn-steps">
        <div class="conn-step done"><span class="conn-step-num">✓</span><span>Chrome запущен</span></div>
        <div class="conn-step done"><span class="conn-step-num">✓</span><span>Подключено</span></div>
        <div class="conn-step active"><span class="conn-step-num">3</span><span>Перейдите к проектам</span></div>
      </div>
    `;
  }

  container.innerHTML = `
    <div style="overflow-y:auto;padding:24px;flex:1;display:flex;align-items:center;justify-content:center">
      <div class="conn-card">
        <div class="conn-header">
          <div class="conn-icon">
            <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </div>
          <div class="conn-title">Подключение к Higgsfield</div>
          <div class="conn-subtitle">Автоматизация через Chrome DevTools</div>
        </div>
        <div class="conn-body">
          <div class="conn-status ${statusClass}">
            <div class="cs-dot"></div>
            <span class="cs-text">${statusText}</span>
          </div>
          <div class="conn-hint">${statusHint}</div>
          ${stepsHTML}
          <div class="conn-actions">${actionsHTML}</div>
        </div>
      </div>
    </div>
  `;

  // ── Events ──
  container.querySelector('#btn-launch')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-launch');
    if (btn) { btn.disabled = true; btn.textContent = 'Запускаю Chrome…'; }
    const r = await api.chrome.launch();
    if (r.success) {
      await api.chrome.connect();
    }
    await refreshConnectionNow();
  });

  container.querySelector('#btn-connect')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-connect');
    if (btn) { btn.disabled = true; btn.textContent = 'Подключаюсь…'; }
    const r = await api.chrome.connect();
    if (!r.success) {
      if (btn) { btn.disabled = false; btn.textContent = 'Подключиться'; }
    }
    await refreshConnectionNow();
  });

  container.querySelector('#btn-save-session')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-save-session');
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняю…'; }
    await api.chrome.saveSession();
    await refreshConnectionNow();
  });

  container.querySelector('#btn-go-projects')?.addEventListener('click', () => navigate('projects'));
}

export default {
  id: 'connection',
  async mount(c) {
    container = c;

    // Subscribe to shared connection-state changes — store cleanup handle
    busCleanup = on('connection-changed', () => renderFromState());

    // Force immediate poll → shared state → triggers renderFromState via event
    await refreshConnectionNow();
    // Render immediately in case the event didn't fire (no-change case)
    renderFromState();
  },
  unmount() {
    // Clean up event listener — prevents listener leak on repeated mount/unmount
    if (busCleanup) busCleanup();
    busCleanup = null;
    container = null;
  },
};

/* ── Connection Screen ── */
import { api, navigate, updateStatusbar, state } from '../app.js';

let container = null;
let pollTimer = null;

function render(status = {}) {
  const connected = status.cdpConnected || false;
  const chromeRunning = status.chromeRunning || false;
  const hasSession = status.hasSession || false;
  const sessionAge = status.sessionAge || null;

  // ── Determine visual state ──
  let statusClass, statusText, statusHint;
  if (connected) {
    statusClass = 'online';
    statusText = 'Подключено';
    statusHint = hasSession
      ? `Сессия сохранена · ${sessionAge}`
      : 'Сессия не сохранена';
  } else if (chromeRunning) {
    statusClass = 'offline';
    statusText = 'Chrome запущен';
    statusHint = 'Нужно подключиться к браузеру';
  } else {
    statusClass = 'offline';
    statusText = 'Не подключено';
    statusHint = hasSession
      ? `Есть сохранённая сессия · ${sessionAge}`
      : 'Запустите Chrome и войдите в Higgsfield';
  }

  // ── Determine which buttons to show ──
  let actionsHTML = '';

  if (!chromeRunning) {
    // State: nothing running
    actionsHTML = `
      <button id="btn-launch" class="btn btn-primary">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
        Запустить Chrome
      </button>
    `;
  } else if (!connected) {
    // State: Chrome running, not connected
    actionsHTML = `
      <button id="btn-connect" class="btn btn-primary">
        <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        Подключиться
      </button>
    `;
  } else {
    // State: connected
    actionsHTML = `
      <button id="btn-save-session" class="btn btn-secondary">
          <svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          ${hasSession ? 'Обновить сессию' : 'Сохранить сессию'}
        </button>
      <button id="btn-go-projects" class="btn btn-primary">
        К проектам →
      </button>
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
          <div class="conn-subtitle">Автоматизация через Chrome</div>
        </div>
        <div class="conn-body">
          <div class="conn-status ${statusClass}">
            <div class="cs-dot"></div>
            <span class="cs-text">${statusText}</span>
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:-4px;margin-bottom:8px;text-align:center">${statusHint}</div>
          <div class="conn-actions">${actionsHTML}</div>
        </div>
      </div>
    </div>
  `;

  // ── Events ──
  container.querySelector('#btn-launch')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-launch');
    if (btn) { btn.disabled = true; btn.textContent = 'Запускаю…'; }
    const r = await api.chrome.launch();
    if (r.success) {
      // Auto-connect after launch
      await api.chrome.connect();
    }
    refresh();
  });

  container.querySelector('#btn-connect')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-connect');
    if (btn) { btn.disabled = true; btn.textContent = 'Подключаюсь…'; }
    const r = await api.chrome.connect();
    if (!r.success) {
      // Restore button on failure
      if (btn) { btn.disabled = false; btn.textContent = 'Подключиться'; }
    } else {
      refresh();
    }
  });

  container.querySelector('#btn-save-session')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-save-session');
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняю…'; }
    await api.chrome.saveSession();
    refresh();
  });

  container.querySelector('#btn-go-projects')?.addEventListener('click', () => navigate('projects'));
}

async function refresh() {
  const status = await api.chrome.status();
  state.connectionStatus = status.cdpConnected ? 'online' : 'offline';
  updateStatusbar();
  render(status);
}

export default {
  id: 'connection',
  async mount(c) {
    container = c;
    await refresh();
    pollTimer = setInterval(refresh, 5000);
  },
  unmount() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    container = null;
  },
};

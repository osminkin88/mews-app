/* ── Connection Screen ── */
import { api, navigate, updateStatusbar, state } from '../app.js';

let container = null;
let pollTimer = null;

function render(status = {}) {
  const connected = status.cdpConnected || false;
  const chromeRunning = status.chromeRunning || false;
  const statusClass = connected ? 'online' : 'offline';
  const statusText = connected ? 'Подключено' : chromeRunning ? 'Chrome запущен · CDP не подключён' : 'Не подключено';

  container.innerHTML = `
    <div style="overflow-y:auto;padding:24px;flex:1;display:flex;align-items:center;justify-content:center">
      <div class="conn-card">
        <div class="conn-header">
          <div class="conn-icon">
            <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </div>
          <div class="conn-title">Подключение к Higgsfield</div>
          <div class="conn-subtitle">Управление Chrome + CDP</div>
        </div>
        <div class="conn-body">
          <div class="conn-status ${statusClass}">
            <div class="cs-dot"></div>
            <span class="cs-text">${statusText}</span>
          </div>
          <div class="conn-actions">
            <button id="btn-launch" class="btn btn-secondary">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              Запустить Chrome
            </button>
            <button id="btn-connect" class="btn btn-primary">
              <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Подключить CDP
            </button>
          </div>
          ${connected ? `<div class="conn-actions">
            <button id="btn-save-session" class="btn btn-secondary">Сохранить сессию</button>
            <button id="btn-go-projects" class="btn btn-primary">К проектам →</button>
          </div>` : ''}
        </div>
      </div>
    </div>
  `;

  // Events
  container.querySelector('#btn-launch')?.addEventListener('click', async () => {
    const r = await api.chrome.launch();
    if (r.success) refresh();
  });
  container.querySelector('#btn-connect')?.addEventListener('click', async () => {
    const r = await api.chrome.connect();
    if (r.success) refresh();
  });
  container.querySelector('#btn-save-session')?.addEventListener('click', () => api.chrome.saveSession());
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

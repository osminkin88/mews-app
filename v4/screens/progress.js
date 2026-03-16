/* ── Progress Screen ── */
import { api, navigate, state } from '../app.js';

let container = null;
let cleanupProgress = null;

function render() {
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 280px;overflow:hidden;flex:1">
      <div style="display:flex;flex-direction:column;overflow:hidden;padding:16px;gap:12px">
        <!-- Progress hero -->
        <div class="progress-hero">
          <div id="ph-percent" class="ph-percent">0%</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700">Генерация изображений</div>
            <div id="ph-detail" style="font-size:12px;color:var(--text-tertiary);margin-top:2px">Ожидание запуска…</div>
            <div class="progress-bar-track"><div id="ph-bar" class="progress-bar-fill" style="width:0%"></div></div>
          </div>
          <div>
            <button id="btn-stop" class="btn btn-secondary" style="font-size:11px;padding:6px 12px;color:var(--red)">Остановить</button>
          </div>
        </div>
        <!-- Live grid -->
        <div id="live-grid" class="live-grid"></div>
      </div>
      <!-- Log panel -->
      <div class="log-panel">
        <div class="log-header">
          <span class="log-title">Лог генерации</span>
          <span id="log-count" class="log-count">0 / 0</span>
        </div>
        <div id="log-list" class="log-list"></div>
      </div>
    </div>
  `;

  container.querySelector('#btn-stop')?.addEventListener('click', async () => {
    await api.generate.stop();
  });
}

function updateProgress(data) {
  if (!container) return;

  if (data.status === 'complete') {
    const pct = document.getElementById('ph-percent');
    const detail = document.getElementById('ph-detail');
    if (pct) pct.textContent = '100%';
    if (detail) detail.textContent = 'Генерация завершена';
    const bar = document.getElementById('ph-bar');
    if (bar) bar.style.width = '100%';
    setTimeout(() => navigate('selection'), 1500);
    return;
  }

  if (data.status === 'fatal_error' || data.status === 'auth_error') {
    const detail = document.getElementById('ph-detail');
    if (detail) {
      detail.textContent = data.message || 'Ошибка генерации';
      detail.style.color = 'var(--red)';
    }
    return;
  }

  const current = data.current || 0;
  const total = data.total || 1;
  const pct = Math.round((current / total) * 100);

  const pctEl = document.getElementById('ph-percent');
  const detailEl = document.getElementById('ph-detail');
  const barEl = document.getElementById('ph-bar');
  const countEl = document.getElementById('log-count');

  if (pctEl) pctEl.textContent = pct + '%';
  if (detailEl) detailEl.textContent = data.message || `Промпт ${current} / ${total}`;
  if (barEl) barEl.style.width = pct + '%';
  if (countEl) countEl.textContent = `${current} / ${total}`;

  // Add log entry
  const logList = document.getElementById('log-list');
  if (logList && data.message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `
      <span class="log-dot"></span>
      <span style="color:var(--text-secondary);flex:1">${data.message}</span>
    `;
    logList.prepend(entry);
  }
}

export default {
  id: 'progress',
  async mount(c) {
    container = c;
    render();
    cleanupProgress = api.generate.onProgress(updateProgress);

    const project = state.currentProject;
    if (project) {
      const projs = await api.projects.loadPrompts(project.id);
      const prompts = projs?.prompts || [];
      const cfg = await api.config.getAll() || {};
      if (prompts.length > 0) {
        api.generate.start(prompts, {
          model: cfg.selectedModel || 'nano_banana_pro',
          aspect: cfg.aspect || '1:1',
          quality: cfg.quality || '2K',
          imagesCount: cfg.imagesCount || 4,
        }, project.id);
      }
    }
  },
  unmount() {
    if (cleanupProgress) cleanupProgress();
    cleanupProgress = null;
    container = null;
  },
};

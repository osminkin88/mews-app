/* ── Results Screen ── */
import { api, state } from '../app.js';

let container = null;

async function render() {
  const project = state.currentProject;
  if (!project) {
    container.innerHTML = '<div class="empty-state">Выберите проект для просмотра результатов</div>';
    return;
  }

  const result = await api.projects.loadPrompts(project.id);
  const prompts = result?.prompts || [];
  const promptCount = prompts.length;

  // Collect selected images
  const allImages = [];
  for (let i = 0; i < promptCount; i++) {
    const r = await api.projects.getImages(project.id, i);
    if (r?.images?.length > 0) {
      allImages.push({ index: i + 1, prompt: prompts[i]?.prompt || prompts[i]?.text || '', images: r.images });
    }
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;overflow:hidden;flex:1">
      <!-- Summary -->
      <div class="results-header">
        <div class="results-title">Результаты</div>
        <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:5px;background:var(--green-soft);color:var(--green)">${project.name}</span>
        <div style="flex:1"></div>
        <div style="text-align:center;padding:0 12px">
          <div style="font-size:18px;font-weight:800">${allImages.length}</div>
          <div class="summary-label">промптов</div>
        </div>
        <button id="btn-open-folder" class="btn btn-secondary" style="padding:6px 14px;font-size:12px">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Открыть папку
        </button>
      </div>

      <!-- Grid -->
      <div class="results-grid">
        ${allImages.length > 0 ? allImages.map(item => {
          const thumb = item.images[0];
          const bg = thumb?.dataUrl ? `url(${thumb.dataUrl})` : 'linear-gradient(135deg,#3a4a5a,#4a5a3a)';
          return `
            <div class="result-card">
              <div class="result-thumb" style="background-image:${bg}"></div>
              <span class="result-num">${item.index}</span>
              <span class="result-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>
            </div>
          `;
        }).join('') : '<div class="empty-state" style="grid-column:1/-1">Нет сгенерированных изображений</div>'}

        <!-- Animation hint -->
        <div class="anim-hint">
          <div class="anim-icon">
            <svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          </div>
          <div style="flex:1">
            <div class="anim-title">Готово к анимации</div>
            <div class="anim-desc">Отобранные кадры в папке selected/ · Следующий шаг — оживление в Kling/Clink</div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#btn-open-folder')?.addEventListener('click', () => {
    api.fs.openFolder(null);
  });
}

export default {
  id: 'results',
  async mount(c) { container = c; await render(); },
  unmount() { container = null; },
};

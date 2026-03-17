/* ── Results Screen ── */
import { api, navigate, state, showToast } from '../app.js';

let container = null;

async function render() {
  const project = state.currentProject;
  if (!project) {
    container.innerHTML = '<div class="empty-state">Выберите проект для просмотра результатов</div>';
    return;
  }

  const result = await api.projects.loadPrompts(project.id);
  const prompts = result?.prompts || [];
  // Try selected/ directory first, fall back to generated/ first files
  let resultImages = [];
  let hasSelectedImages = false;
  const selectedResult = await api.projects.getSelectedImages(project.id);
  if (selectedResult?.success && selectedResult.images?.length > 0) {
    resultImages = selectedResult.images;
    hasSelectedImages = true;
  } else {
    // Fallback: gather first image from each generated prompt folder
    for (let i = 0; i < prompts.length; i++) {
      const imgs = await api.projects.getImages(project.id, i);
      if (imgs?.images?.length > 0) {
        resultImages.push({
          name: prompts[i]?.prompt?.substring(0, 40) || `Промпт ${i + 1}`,
          dataUrl: imgs.images[0]?.dataUrl || imgs.images[0],
        });
      }
    }
  }

  container.innerHTML = `
    <div class="results-header">
      <div style="flex:1">
        <div class="results-title">Результаты</div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">${project.name} · ${resultImages.length} изображений</div>
      </div>
      <div style="display:flex;gap:8px">
        <button id="btn-open-folder" class="btn btn-secondary">
          <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11Z"/></svg>
          Открыть папку
        </button>
        <button id="btn-back-projects" class="btn btn-primary">
          К проектам
        </button>
      </div>
    </div>

    ${resultImages.length > 0 ? `
      <div class="results-grid">
        ${resultImages.map((img, i) => {
          const src = typeof img === 'string' ? img : (img.dataUrl || '');
          const name = img.name || `Изображение ${i + 1}`;
          return `
            <div class="result-card" title="${name}">
              <div class="result-thumb" style="background-image:url(${src})"></div>
              <span class="result-num">${i + 1}</span>
              <span class="result-check">
                <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            </div>
          `;
        }).join('')}
      </div>
    ` : `
      <div style="padding:60px 24px;text-align:center;color:var(--text-tertiary)">
        <div style="font-size:48px;margin-bottom:12px">📭</div>
        <div style="font-size:14px;font-weight:600">Нет результатов</div>
        <div style="font-size:12px;margin-top:4px">Сначала выполните генерацию и отбор</div>
      </div>
    `}
  `;

  // ── Events ──
  container.querySelector('#btn-open-folder')?.addEventListener('click', async () => {
    const pathResult = await api.projects.getProjectPath(project.id);
    if (pathResult?.success && pathResult.path) {
      // Open the subfolder where results live
      const targetDir = hasSelectedImages
        ? pathResult.path + '/selected'
        : pathResult.path;
      const opened = await api.fs.openFolder(targetDir);
      if (!opened && hasSelectedImages) {
        // Fallback: try opening project root if selected/ doesn't exist yet
        const fallback = await api.fs.openFolder(pathResult.path);
        if (!fallback) {
          showToast('Папка проекта не найдена');
        } else {
          showToast('Папка selected/ ещё не создана — открыта корневая');
        }
      } else if (!opened) {
        showToast('Папка проекта не найдена');
      }
    }
  });

  container.querySelector('#btn-back-projects')?.addEventListener('click', () => {
    navigate('projects');
  });
}

export default {
  id: 'results',
  async mount(c) { container = c; await render(); },
  unmount() { container = null; },
};

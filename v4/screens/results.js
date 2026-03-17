/* ── Results Screen ── */
import { api, navigate, state, showToast } from '../app.js';

let container = null;

async function render() {
  const project = state.currentProject;
  if (!project) {
    container.innerHTML = `
      <div class="res-empty">
        <div class="res-empty-icon">
          <svg viewBox="0 0 24 24" width="48" height="48"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
        </div>
        <div class="res-empty-title">Выберите проект</div>
        <div class="res-empty-hint">Перейдите в проекты и выберите один для просмотра результатов</div>
        <button class="btn btn-primary" id="btn-go-projects" style="margin-top:8px">К проектам</button>
      </div>`;
    container.querySelector('#btn-go-projects')?.addEventListener('click', () => navigate('projects'));
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

  const sourceLabel = hasSelectedImages ? 'Отобранные финалы' : 'Сгенерированные (без отбора)';
  const sourceIcon = hasSelectedImages
    ? '<svg viewBox="0 0 24 24" width="14" height="14" style="fill:none;stroke:var(--green);stroke-width:2"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24" width="14" height="14" style="fill:none;stroke:var(--text-tertiary);stroke-width:2"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2 2"/></svg>';

  container.innerHTML = `
    <div class="res-scroll">
      <!-- Summary hero -->
      <div class="res-summary">
        <div class="res-summary-left">
          <div class="res-project-name">${project.name || 'Проект'}</div>
          <div class="res-summary-stats">
            <span class="res-stat">
              <svg viewBox="0 0 24 24" width="13" height="13" style="fill:none;stroke:currentColor;stroke-width:2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21"/></svg>
              ${resultImages.length} изображ.
            </span>
            <span class="res-stat-sep">·</span>
            <span class="res-stat">
              <svg viewBox="0 0 24 24" width="13" height="13" style="fill:none;stroke:currentColor;stroke-width:2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg>
              ${prompts.length} промпт.
            </span>
            <span class="res-stat-sep">·</span>
            <span class="res-stat res-source-badge ${hasSelectedImages ? 'selected' : 'generated'}">
              ${sourceIcon}
              ${sourceLabel}
            </span>
          </div>
        </div>
        <div class="res-summary-actions">
          <button id="btn-open-folder" class="btn btn-secondary res-action-btn">
            <svg viewBox="0 0 24 24" width="15" height="15"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
            Открыть папку
          </button>
          <button id="btn-back-projects" class="btn btn-primary res-action-btn">
            К проектам
          </button>
        </div>
      </div>

      <!-- Image grid or empty -->
      ${resultImages.length > 0 ? `
        <div class="results-grid">
          ${resultImages.map((img, i) => {
            const src = typeof img === 'string' ? img : (img.dataUrl || '');
            const name = img.name || `Изображение ${i + 1}`;
            return `
              <div class="result-card" title="${name}" data-idx="${i}">
                <div class="result-thumb" style="background-image:url(${src})"></div>
                <span class="result-num">${i + 1}</span>
                ${hasSelectedImages
                  ? '<span class="result-badge result-badge-selected">✓</span>'
                  : '<span class="result-badge result-badge-gen">gen</span>'
                }
                <div class="result-card-overlay">
                  <span class="result-card-name">${name}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="res-empty">
          <div class="res-empty-icon">
            <svg viewBox="0 0 24 24" width="48" height="48"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
          </div>
          <div class="res-empty-title">Нет результатов</div>
          <div class="res-empty-hint">Сначала выполните генерацию и отбор изображений.<br>Результаты появятся здесь автоматически.</div>
          <button class="btn btn-secondary" id="btn-go-settings" style="margin-top:12px;font-size:12px">← Перейти в настройки</button>
        </div>
      `}
    </div>
  `;

  // ── Events ──
  container.querySelector('#btn-go-settings')?.addEventListener('click', () => navigate('settings'));

  container.querySelector('#btn-open-folder')?.addEventListener('click', async () => {
    const pathResult = await api.projects.getProjectPath(project.id);
    if (pathResult?.success && pathResult.path) {
      const targetDir = hasSelectedImages
        ? pathResult.path + '/selected'
        : pathResult.path;
      const opened = await api.fs.openFolder(targetDir);
      if (!opened && hasSelectedImages) {
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

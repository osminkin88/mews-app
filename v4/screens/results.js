/* ── Results Screen ── */
import { api, navigate, state, showToast } from '../app.js';

const LOAD_CONCURRENCY = 4; // bounded parallel image loading

let container = null;

// Bounded-concurrency loader: runs tasks in parallel with max concurrency
async function loadBounded(tasks, concurrency) {
  const results = new Array(tasks.length).fill(null);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      try {
        results[idx] = await tasks[idx]();
      } catch {
        results[idx] = null;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function renderShell(project) {
  container.innerHTML = `
    <div class="res-scroll">
      <!-- Summary hero -->
      <div class="res-summary">
        <div class="res-summary-left">
          <div class="res-project-name">${project.name || 'Проект'}</div>
          <div class="res-summary-stats">
            <span class="res-stat" id="res-img-count">
              <svg viewBox="0 0 24 24" width="13" height="13" style="fill:none;stroke:currentColor;stroke-width:2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21"/></svg>
              <span id="res-count-num">…</span> изображ.
            </span>
            <span class="res-stat-sep">·</span>
            <span class="res-stat" id="res-prompt-count">
              <svg viewBox="0 0 24 24" width="13" height="13" style="fill:none;stroke:currentColor;stroke-width:2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg>
              … промпт.
            </span>
            <span class="res-stat-sep">·</span>
            <span class="res-stat" id="res-source-badge">
              <svg viewBox="0 0 24 24" width="14" height="14" style="fill:none;stroke:var(--text-tertiary);stroke-width:2"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2 2"/></svg>
              Загрузка…
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

      <!-- Image grid -->
      <div class="results-grid" id="results-grid">
        <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-tertiary);font-size:13px">Загрузка изображений…</div>
      </div>
    </div>
  `;

  // Attach nav events immediately
  container.querySelector('#btn-open-folder')?.addEventListener('click', async () => {
    const pathResult = await api.projects.getProjectPath(project.id);
    if (pathResult?.success && pathResult.path) {
      const opened = await api.fs.openFolder(pathResult.path);
      if (!opened) showToast('Папка проекта не найдена');
    }
  });

  container.querySelector('#btn-back-projects')?.addEventListener('click', () => {
    navigate('projects');
  });
}

function renderCard(img, idx, hasSelectedImages) {
  const src = typeof img === 'string' ? img : (img.dataUrl || '');
  const name = img.name || `Изображение ${idx + 1}`;
  return `
    <div class="result-card" title="${name}" data-idx="${idx}">
      <div class="result-thumb" style="background-image:url(${src})"></div>
      <span class="result-num">${idx + 1}</span>
      ${hasSelectedImages
        ? '<span class="result-badge result-badge-selected">✓</span>'
        : '<span class="result-badge result-badge-gen">gen</span>'
      }
      <div class="result-card-overlay">
        <span class="result-card-name">${name}</span>
      </div>
    </div>
  `;
}

function showEmpty() {
  const grid = container?.querySelector('#results-grid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="res-empty" style="grid-column:1/-1">
      <div class="res-empty-icon">
        <svg viewBox="0 0 24 24" width="48" height="48"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
      </div>
      <div class="res-empty-title">Нет результатов</div>
      <div class="res-empty-hint">Сначала выполните генерацию и отбор изображений.<br>Результаты появятся здесь автоматически.</div>
      <button class="btn btn-secondary" id="btn-go-settings" style="margin-top:12px;font-size:12px">← Перейти в настройки</button>
    </div>
  `;
  container.querySelector('#btn-go-settings')?.addEventListener('click', () => navigate('settings'));
}

function updateSourceBadge(hasSelectedImages) {
  const badge = container?.querySelector('#res-source-badge');
  if (!badge) return;
  const sourceLabel = hasSelectedImages ? 'Отобранные финалы' : 'Сгенерированные (без отбора)';
  const sourceIcon = hasSelectedImages
    ? '<svg viewBox="0 0 24 24" width="14" height="14" style="fill:none;stroke:var(--green);stroke-width:2"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24" width="14" height="14" style="fill:none;stroke:var(--text-tertiary);stroke-width:2"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2 2"/></svg>';
  badge.className = `res-stat res-source-badge ${hasSelectedImages ? 'selected' : 'generated'}`;
  badge.innerHTML = `${sourceIcon} ${sourceLabel}`;
}

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

  // ── Immediate first paint: shell with project name ──
  renderShell(project);

  // ── Async hydration: load prompts + selected images in parallel ──
  const [result, selectedResult] = await Promise.all([
    api.projects.loadPrompts(project.id),
    api.projects.getSelectedImages(project.id),
  ]);
  if (!container) return; // screen unmounted during load

  const prompts = result?.prompts || [];
  const hasSelectedImages = selectedResult?.success && selectedResult.images?.length > 0;

  // Update prompt count and source badge
  const promptCountEl = container.querySelector('#res-prompt-count');
  if (promptCountEl) {
    promptCountEl.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" style="fill:none;stroke:currentColor;stroke-width:2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg>
      ${prompts.length} промпт.
    `;
  }
  updateSourceBadge(hasSelectedImages);

  // Update open-folder to use selected/ subdir if applicable
  if (hasSelectedImages) {
    const oldBtn = container.querySelector('#btn-open-folder');
    if (oldBtn) {
      const newBtn = oldBtn.cloneNode(true);
      oldBtn.replaceWith(newBtn);
      newBtn.addEventListener('click', async () => {
        const pathResult = await api.projects.getProjectPath(project.id);
        if (pathResult?.success && pathResult.path) {
          const opened = await api.fs.openFolder(pathResult.path + '/selected');
          if (!opened) {
            const fallback = await api.fs.openFolder(pathResult.path);
            if (!fallback) showToast('Папка проекта не найдена');
            else showToast('Папка selected/ ещё не создана — открыта корневая');
          }
        }
      });
    }
  }

  if (hasSelectedImages) {
    const grid = container?.querySelector('#results-grid');
    const countEl = container?.querySelector('#res-count-num');
    if (grid) {
      grid.innerHTML = selectedResult.images.map((img, i) => renderCard(img, i, true)).join('');
    }
    if (countEl) countEl.textContent = selectedResult.images.length;
  } else {
    const grid = container?.querySelector('#results-grid');
    const countEl = container?.querySelector('#res-count-num');
    if (grid) grid.innerHTML = ''; // clear loading placeholder
    let loadedCount = 0;

    const tasks = prompts.map((p, i) => async () => {
      const imgs = await api.projects.getImages(project.id, i);
      if (imgs?.images?.length > 0) {
        const img = {
          name: p?.prompt?.substring(0, 40) || `Промпт ${i + 1}`,
          dataUrl: imgs.images[0]?.dataUrl || imgs.images[0],
        };
        if (grid && container) {
          const cardHtml = renderCard(img, i, false);
          const temp = document.createElement('div');
          temp.innerHTML = cardHtml.trim();
          const cardEl = temp.firstChild;
          cardEl.style.order = i;
          cardEl.style.animation = 'liveTileFadeIn 0.25s ease';
          grid.appendChild(cardEl);
          loadedCount++;
          if (countEl) countEl.textContent = loadedCount;
        }
        return img;
      }
      return null;
    });

    await loadBounded(tasks, LOAD_CONCURRENCY);

    if (loadedCount === 0) {
      showEmpty();
    }
  }
}

export default {
  id: 'results',
  async mount(c) { container = c; await render(); },
  unmount() { container = null; },
};

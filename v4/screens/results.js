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
  const activeSet = project.promptSets?.find(s => s.id === project.activePromptSetId);
  const setName = activeSet ? activeSet.name : 'Итерация';

  container.innerHTML = `
    <div class="res-scroll">
      <!-- Summary hero -->
      <div class="res-summary">
        <div class="res-summary-left">
          <div class="res-project-name">${project.name || 'Проект'} <span style="color:var(--text-tertiary);font-weight:400;font-size:14px;margin-left:8px;padding-left:8px;border-left:1px solid rgba(255,255,255,0.1)">${setName}</span></div>
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
          <button id="btn-export-results" class="btn btn-primary res-action-btn" style="display:none">
            Сохранить финалы
          </button>
          <div id="zip-export-wrap" style="position:relative;display:none">
            <div style="display:flex;align-items:stretch;border-radius:8px;overflow:hidden">
              <button id="btn-export-zip" class="btn btn-primary res-action-btn" style="border-radius:8px 0 0 8px;padding:0 14px 0 14px;gap:6px;border-right:1px solid rgba(255,255,255,0.15)" title="Скачать ZIP с финалами и промптами">
                <svg viewBox="0 0 24 24" width="14" height="14" style="fill:none;stroke:currentColor;stroke-width:2;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Скачать ZIP
              </button>
              <button id="btn-export-zip-toggle" class="btn btn-primary res-action-btn" style="border-radius:0 8px 8px 0;padding:0 10px;min-width:unset" title="Варианты экспорта">
                <svg viewBox="0 0 24 24" width="12" height="12" class="zip-toggle-arrow" style="fill:none;stroke:currentColor;stroke-width:2.5"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            </div>
            <div id="zip-dropdown" style="display:none;position:absolute;top:calc(100% + 6px);right:0;background:var(--bg-card,#1c1c1e);border:1px solid rgba(255,255,255,0.12);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.5);min-width:210px;z-index:500;overflow:hidden">
              <button id="zip-opt-with-prompts" class="zip-dropdown-opt" data-include-prompts="true">
                <div style="font-weight:500">Финалы + промпты</div>
                <div style="font-size:11px;color:var(--text-tertiary,rgba(255,255,255,0.4));margin-top:2px">Изображения + prompts.csv</div>
              </button>
              <div style="height:1px;background:rgba(255,255,255,0.07);margin:0 10px"></div>
              <button id="zip-opt-only-images" class="zip-dropdown-opt" data-include-prompts="false">
                <div style="font-weight:500">Только финалы</div>
                <div style="font-size:11px;color:var(--text-tertiary,rgba(255,255,255,0.4));margin-top:2px">Только изображения</div>
              </button>
            </div>
          </div>
          <button id="btn-cleanup-generated" class="btn btn-secondary res-action-btn" style="display:none;font-size:12px;opacity:0.7" title="Переместить невыбранные варианты в корзину Mews">
            Очистить черновики
          </button>
          <button id="btn-open-folder" class="btn btn-secondary res-action-btn" title="Открыть папку" style="padding:0 14px">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
          </button>
          <button id="btn-back-projects" class="btn btn-secondary res-action-btn" style="margin-left:auto;border-left:1px solid rgba(255,255,255,0.08);padding-left:16px">
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
    const btnExport = container.querySelector('#btn-export-results');
    if (btnExport) {
      btnExport.style.display = 'inline-flex';
      btnExport.addEventListener('click', async () => {
        const originalText = btnExport.textContent;
        btnExport.textContent = 'Экспортирую...';
        btnExport.style.opacity = '0.7';
        btnExport.style.pointerEvents = 'none';
        
        const res = await api.projects.exportSelected(project.id);
        
        btnExport.textContent = originalText;
        btnExport.style.opacity = '1';
        btnExport.style.pointerEvents = 'auto';
        
        if (res?.success) {
          showToast(`Успешно сохранено кадров: ${res.count}`);
        } else if (res?.error) {
          showToast(`Ошибка экспорта: ${res.error}`);
        }
      });
    }

    // ── ZIP export button: show wrap + attach handlers ──
    const zipWrap = container.querySelector('#zip-export-wrap');
    if (zipWrap) {
      zipWrap.style.display = 'block';
      attachZipDropdown(container, project);
    }

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

  // ── Determine cleanup eligibility ──
  const activeSet = project.promptSets?.find(s => s.id === project.activePromptSetId);
  const canCleanup = hasSelectedImages
    && activeSet?.status === 'completed'
    && !activeSet?.generationCleaned;

  if (canCleanup) {
    const btnCleanup = container.querySelector('#btn-cleanup-generated');
    if (btnCleanup) {
      btnCleanup.style.display = 'inline-flex';
      btnCleanup.addEventListener('click', () => openCleanupConfirm(project, btnCleanup));
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
    if (grid) {
      grid.innerHTML = ''; // clear loading placeholder
      grid.style.position = 'relative';
      grid.style.minHeight = '300px';
    }
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
    } else if (grid) {
      // Fade out loaded items slightly
      Array.from(grid.children).forEach(el => el.style.opacity = '0.3');
      
      // Inject glass overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;background:rgba(20,20,20,0.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:20;border-radius:12px;text-align:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.05);';
      overlay.innerHTML = `
        <svg viewBox="0 0 24 24" width="48" height="48" style="fill:none;stroke:var(--accent);stroke-width:1.5;margin-bottom:16px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="14" r="3"/></svg>
        <div style="font-size:20px;font-weight:600;margin-bottom:8px">Отбор не завершён</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.7);margin-bottom:24px;max-width:320px;line-height:1.5">У вас есть сгенерированные варианты, ожидающие вашего решения.</div>
        <button class="btn btn-primary" id="btn-goto-selection" style="font-size:14px;padding:10px 24px;border-radius:100px;box-shadow:0 4px 14px rgba(255,255,255,0.1)">Продолжить отбор</button>
      `;
      grid.appendChild(overlay);
      
      overlay.querySelector('#btn-goto-selection').addEventListener('click', () => navigate('selection'));
    }
  }
}

// ── Cleanup confirm dialog ──
function openCleanupConfirm(project, triggerBtn) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;';

  const card = document.createElement('div');
  card.style.cssText = 'background:var(--bg-card,#1c1c1e);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px 28px 24px;max-width:380px;width:90%;box-shadow:0 24px 60px rgba(0,0,0,0.5);';

  card.innerHTML = `
    <div style="font-size:15px;font-weight:600;margin-bottom:10px;letter-spacing:-0.2px">Очистить черновики?</div>
    <div style="font-size:13px;line-height:1.6;color:var(--text-secondary,rgba(255,255,255,0.6));margin-bottom:24px">
      Финальные кадры останутся на месте. Невыбранные варианты будут перемещены в корзину Mews и удалены через 30 дней.
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="cleanup-cancel" class="btn btn-secondary" style="font-size:13px">Отмена</button>
      <button id="cleanup-confirm" class="btn btn-secondary" style="font-size:13px;color:rgba(255,255,255,0.5)">Очистить черновики</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();

  card.querySelector('#cleanup-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
  });

  card.querySelector('#cleanup-confirm').addEventListener('click', async () => {
    close();
    await doCleanupGenerated(project, triggerBtn);
  });
}

async function doCleanupGenerated(project, triggerBtn) {
  if (!triggerBtn) return;

  // ── Loading state ──
  const originalText = triggerBtn.textContent;
  triggerBtn.textContent = 'Очищаю…';
  triggerBtn.style.opacity = '0.5';
  triggerBtn.style.pointerEvents = 'none';

  const res = await api.projects.cleanupGenerated(project.id);

  if (res?.success) {
    // ── Success: replace button with calm status label ──
    triggerBtn.style.display = 'none';

    // Insert animated status message in same slot
    const statusSpan = document.createElement('span');
    statusSpan.className = 'res-cleanup-status';
    const count = res.deletedCount || 0;
    statusSpan.innerHTML = `
      <svg viewBox="0 0 24 24" width="12" height="12" style="fill:none;stroke:currentColor;stroke-width:2.5;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>
      ${count > 0 ? `Удалено черновиков: ${count}` : 'Черновики очищены'}
    `;
    triggerBtn.parentNode.insertBefore(statusSpan, triggerBtn);
  } else if (!res?.canceled) {
    // ── Error: restore button, show toast ──
    triggerBtn.textContent = originalText;
    triggerBtn.style.opacity = '0.7';
    triggerBtn.style.pointerEvents = 'auto';
    if (typeof showToast === 'function') {
      showToast(res?.error || 'Не удалось очистить черновики');
    }
  } else {
    // canceled — just restore button
    triggerBtn.textContent = originalText;
    triggerBtn.style.opacity = '0.7';
    triggerBtn.style.pointerEvents = 'auto';
  }
}

// ── ZIP Dropdown: attach handlers ──
function attachZipDropdown(container, project) {
  const btnMain   = container.querySelector('#btn-export-zip');
  const btnToggle = container.querySelector('#btn-export-zip-toggle');
  const dropdown  = container.querySelector('#zip-dropdown');
  if (!btnMain || !btnToggle || !dropdown) return;

  let dropdownOpen = false;

  const openDropdown = () => {
    dropdownOpen = true;
    dropdown.style.display = 'block';
    btnToggle.classList.add('zip-toggle-open');
  };

  const closeDropdown = () => {
    dropdownOpen = false;
    dropdown.style.display = 'none';
    btnToggle.classList.remove('zip-toggle-open');
  };

  // Main button click → ZIP with prompts (default)
  btnMain.addEventListener('click', () => doExportZip(project, true));

  // Toggle arrow → open/close dropdown
  btnToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownOpen ? closeDropdown() : openDropdown();
  });

  // Dropdown options
  container.querySelector('#zip-opt-with-prompts')?.addEventListener('click', () => {
    closeDropdown();
    doExportZip(project, true);
  });
  container.querySelector('#zip-opt-only-images')?.addEventListener('click', () => {
    closeDropdown();
    doExportZip(project, false);
  });

  // Close on outside click
  document.addEventListener('click', function outsideHandler(e) {
    if (!container.querySelector('#zip-export-wrap')?.contains(e.target)) {
      closeDropdown();
    }
    // auto-remove handler when screen unmounts (container nulled)
    if (!container) document.removeEventListener('click', outsideHandler);
  });

  // Close on Escape
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape' && dropdownOpen) closeDropdown();
    if (!container) document.removeEventListener('keydown', escHandler);
  });
}

// ── ZIP export execution ──
async function doExportZip(project, includePrompts) {
  const btnMain = container?.querySelector('#btn-export-zip');
  const btnToggle = container?.querySelector('#btn-export-zip-toggle');

  const setLoading = (on) => {
    if (btnMain) {
      btnMain.innerHTML = on
        ? `<svg viewBox="0 0 24 24" width="14" height="14" style="fill:none;stroke:currentColor;stroke-width:2;animation:spin 1s linear infinite"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Создаю ZIP…`
        : `<svg viewBox="0 0 24 24" width="14" height="14" style="fill:none;stroke:currentColor;stroke-width:2;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Скачать ZIP`;
      btnMain.style.opacity = on ? '0.7' : '1';
      btnMain.style.pointerEvents = on ? 'none' : 'auto';
    }
    if (btnToggle) {
      btnToggle.style.pointerEvents = on ? 'none' : 'auto';
      btnToggle.style.opacity = on ? '0.5' : '1';
    }
  };

  setLoading(true);
  const res = await api.projects.exportZip(project.id, includePrompts);
  setLoading(false);

  if (res?.success) {
    const msg = includePrompts && res.includePrompts
      ? `ZIP сохранён: ${res.count} кадров + prompts.csv`
      : `ZIP сохранён: ${res.count} кадров`;
    showToast(msg);

    // Momentary success state on main button (1.5s)
    if (btnMain) {
      btnMain.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" style="fill:none;stroke:var(--green,#30d158);stroke-width:2.5;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg> Сохранено`;
      btnMain.style.boxShadow = '0 0 0 1.5px rgba(48,209,88,0.45)';
      btnMain.style.pointerEvents = 'none';
      if (btnToggle) btnToggle.style.pointerEvents = 'none';
      setTimeout(() => {
        if (!container) return;
        btnMain.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" style="fill:none;stroke:currentColor;stroke-width:2;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Скачать ZIP`;
        btnMain.style.boxShadow = '';
        btnMain.style.pointerEvents = 'auto';
        if (btnToggle) btnToggle.style.pointerEvents = 'auto';
      }, 1500);
    }
  } else if (res?.canceled) {
    // silent — user dismissed save dialog
  } else if (res?.error) {
    showToast(`Ошибка экспорта ZIP: ${res.error}`);
  }
}

export default {
  id: 'results',
  async mount(c) { container = c; await render(); },
  unmount() { container = null; },
};

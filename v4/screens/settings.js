/* ── Settings Screen ── */
import { api, navigate, state, showToast } from '../app.js';

let container = null;

async function render() {
  const project = state.currentProject;
  const cfg = await api.config.getAll() || {};
  const loadResult = project ? (await api.projects.loadPrompts(project.id)) : {};
  const prompts = loadResult?.prompts || [];
  const promptSets = loadResult?.promptSets || [];
  const activeSetId = loadResult?.activePromptSetId || null;
  const sourceMeta = loadResult?.sourceMeta || null;
  const promptCount = prompts.length;

  const activeSet = promptSets.find(s => s.id === activeSetId) || null;
  const activeSetHasProgress = activeSet && activeSet.status && activeSet.status !== 'draft';

  // ── Fetch model capabilities from single source of truth ──
  const models = await api.models.getUnlimitedList() || [];
  const selectedModel = cfg.selectedModel || models[0]?.id || 'nano_banana_pro';
  const caps = models.find(m => m.id === selectedModel) || models[0] || {};

  // Soft migration: read canonical keys first, fallback to old v4 keys
  let quality = cfg.selectedQuality || cfg.quality || caps.defaultQuality;
  let aspect = cfg.selectedRatio || cfg.aspect || caps.defaultAspect || '1:1';
  const imagesCount = cfg.lastImagesPerPrompt || cfg.imagesCount || 4;

  // ── Resolve against model constraints ──
  const hasQuality = caps.qualities && caps.qualities.length > 0;
  if (hasQuality && quality && !caps.qualities.includes(quality)) {
    quality = caps.defaultQuality;
  }
  if (caps.aspects && !caps.aspects.includes(aspect)) {
    aspect = caps.defaultAspect || caps.aspects[0] || '1:1';
  }

  const totalImages = promptCount * imagesCount;

  // Build Iteration History HTML
  let setChipsHTML = '';
  if (promptSets.length > 0) {
    const rows = promptSets.map(s => {
      const isActive = s.id === activeSetId;
      const mapStateText = { draft: 'Черновик', in_progress: 'В процессе', completed: 'Завершён' };
      const mapStateColor = { draft: 'var(--text-tertiary)', in_progress: 'var(--orange)', completed: 'var(--green)' };
      const statusText = mapStateText[s.status] || s.status;
      const statusColor = mapStateColor[s.status] || 'var(--text-tertiary)';
      const selCount = s.selections ? Object.keys(s.selections).length : 0;
      const selectionsCount = selCount > 0 ? ` &nbsp;·&nbsp; <span style="color:var(--text-secondary);font-weight:500">${selCount}</span> отобрано` : '';
      
      const activeBadge = isActive ? '<span style="font-size:10px;background:var(--accent);color:#fff;padding:2px 6px;border-radius:4px;font-weight:700;letter-spacing:0.3px">АКТИВНАЯ</span>' : '';
      const statusBadge = `<div style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:${statusColor};text-transform:uppercase;letter-spacing:0.3px;"><div style="width:6px;height:6px;border-radius:50%;background:${statusColor}"></div>${statusText}</div>`;
      
      const btnSwitch = !isActive ? `<button class="btn btn-ghost history-btn-switch" data-id="${s.id}" style="font-size:11px;padding:4px 12px;border-radius:100px;border:1px solid var(--border);margin-right:4px">Перейти</button>` : '';
      const btnRename = `<button class="history-btn-rename" data-id="${s.id}" data-name="${s.name}" title="Переименовать" style="padding:6px;color:var(--text-tertiary);background:transparent;border:none;cursor:pointer;border-radius:4px;transition:0.15s;display:flex" onmouseover="this.style.color='var(--text-primary)';this.style.background='var(--bg-float)'" onmouseout="this.style.color='var(--text-tertiary)';this.style.background='transparent'"><svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>`;
      const btnDel = !isActive ? `<button class="history-btn-del" data-id="${s.id}" data-name="${s.name}" title="Удалить" style="padding:6px;color:var(--text-tertiary);background:transparent;border:none;cursor:pointer;border-radius:4px;transition:0.15s;display:flex" onmouseover="this.style.color='var(--red)';this.style.background='var(--red-soft)'" onmouseout="this.style.color='var(--text-tertiary)';this.style.background='transparent'"><svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>` : '';

      return `
      <div class="history-set-row ${isActive ? 'active' : ''}" data-set-id="${s.id}" style="display:flex;align-items:center;background:var(--bg-float);padding:12px 14px;border-radius:10px;border:1px solid ${isActive ? 'var(--accent)' : 'var(--border-2)'};cursor:default;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span class="history-set-name" style="font-weight:600;font-size:13px;color:${isActive ? 'var(--text-primary)' : 'var(--text-secondary)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;" title="${s.name}">${s.name}</span>
            ${isActive ? activeBadge : statusBadge}
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);">
            <span style="color:var(--text-secondary);font-weight:500">${s.promptCount}</span> промптов
            ${selectionsCount}
          </div>
        </div>
        
        <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;">
          ${btnSwitch}
          ${btnRename}
          ${btnDel}
        </div>
      </div>
      `;
    }).join('');

    setChipsHTML = `
      <div class="history-block" style="margin-top:36px;border-top:1px solid var(--border);padding-top:24px;">
        <div class="field-label" style="margin-bottom:14px;font-size:14px;display:flex;align-items:baseline">
          <span style="color:var(--text-primary)">История итераций</span>
          <span style="font-size:12px;color:var(--text-tertiary);margin-left:8px;font-weight:400">${promptSets.length} запусков</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${rows}
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div style="overflow-y:auto;padding:16px 24px 40px;flex:1">
      <div class="settings-card">
        <div class="settings-header">
          <div style="font-size:18px;font-weight:800;letter-spacing:-0.3px">Подготовка к запуску</div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:3px">${project ? project.name : 'Выберите проект'} <span style="font-weight:400;margin-left:8px;padding-left:8px;border-left:1px solid rgba(255,255,255,0.1)">${activeSet ? activeSet.name : 'Итерация'}</span></div>
        </div>

        <div class="settings-body">
          <!-- Source file -->
          <div id="source-area">
            ${promptCount > 0 ? `
              <div class="source-file">
                <div class="source-icon">
                  <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <div class="source-info">
                  <div class="source-name">${sourceMeta?.originalFileName || 'prompts.csv'}</div>
                  <div class="source-meta">${promptCount} промптов</div>
                </div>
                <button id="btn-replace-file" class="source-replace">Добавить новый</button>
              </div>
              <div class="template-hint template-hint-subtle" style="margin-top:12px;margin-bottom:0">
                <a id="btn-download-template" class="template-link" style="font-size:11px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.04);border:1px solid var(--border);">↓ Скачать шаблон</a>
              </div>
              ${setChipsHTML}
            ` : `
              <div id="drop-zone" class="drop-zone">
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div style="font-size:13px;font-weight:600">Загрузить промпты</div>
                <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">CSV или XLSX</div>
              </div>
              <div class="template-hint">
                <span>Нет файла?</span>
                <a id="btn-download-template" class="template-link">Скачайте шаблон</a>
              </div>
            `}
          </div>

          <!-- Model + Quality -->
          <div class="field-row">
            <div class="field-col">
              <div class="field">
                <div class="field-label">Модель</div>
                <select id="sel-model" class="select-input">
                  ${models.map(m => `<option value="${m.id}" ${m.id === selectedModel ? 'selected' : ''}>${m.name}</option>`).join('')}
                </select>
                <div class="field-tag">∞ Unlimited</div>
              </div>
            </div>
            <div class="field-col">
              <div class="field" id="quality-field" ${!hasQuality ? 'style="display:none"' : ''}>
                <div class="field-label">Качество</div>
                <div class="seg" id="seg-quality">
                  ${hasQuality ? caps.qualities.map(q =>
                    `<button class="seg-btn ${q === quality ? 'on' : ''}" data-val="${q}">${q}</button>`
                  ).join('') : ''}
                </div>
              </div>
              ${!hasQuality ? `
                <div class="field">
                  <div class="field-label">Качество</div>
                  <div style="font-size:12px;color:var(--text-tertiary);padding:8px 0">Авто для ${caps.name || selectedModel}</div>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Aspect -->
          <div class="field">
            <div class="field-label">Формат</div>
            <div class="ratio-grid" id="ratio-grid">
              ${(caps.aspects || ['1:1']).filter(r => r !== 'Auto').map(r => {
                const [w, h] = r.split(':').map(Number);
                const bw = Math.round(18 * (w / Math.max(w, h)));
                const bh = Math.round(18 * (h / Math.max(w, h)));
                return `<div class="ratio-item ${r === aspect ? 'on' : ''}" data-ratio="${r}"><div class="ratio-box" style="width:${bw}px;height:${bh}px"></div><div class="ratio-name">${r}</div></div>`;
              }).join('')}
            </div>
          </div>

          <!-- Images per prompt -->
          <div class="field">
            <div class="field-label">Вариантов на промпт</div>
            <div class="seg" id="seg-count">
              ${[1, 2, 4].map(n => `<button class="seg-btn ${n === imagesCount ? 'on' : ''}" data-val="${n}">${n}</button>`).join('')}
            </div>
          </div>
        </div>

        <!-- Launch -->
        <div class="settings-footer">
          <div class="summary-row">
            <div class="summary-col"><div class="summary-value">${promptCount}</div><div class="summary-label">промптов</div></div>
            <div class="summary-col"><div class="summary-value">×${imagesCount}</div><div class="summary-label">вариантов</div></div>
            <div class="summary-col"><div class="summary-value" style="color:var(--accent)">${totalImages}</div><div class="summary-label">всего</div></div>
          </div>
          ${activeSetHasProgress ? `
            <div style="display:flex;gap:12px;width:100%">
              <button id="btn-launch" class="btn-launch" style="flex:1" ${promptCount === 0 ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Продолжить генерацию
              </button>
              <button id="btn-restart" class="btn-launch" style="flex:0.6;background:var(--bg-elevated);color:var(--text-secondary);border:1px solid var(--border-2)" ${promptCount === 0 ? 'disabled' : ''}>
                ↺ Начать заново
              </button>
            </div>
          ` : `
            <button id="btn-launch" class="btn-launch" ${promptCount === 0 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Запустить генерацию
            </button>
          `}
        </div>
      </div>
    </div>
  `;

  // ── Events ──
  const dropZone = container.querySelector('#drop-zone');
  const replaceBtn = container.querySelector('#btn-replace-file');
  const importFile = async () => {
    if (!project) {
      showToast('Сначала создайте проект');
      return;
    }
    const filePath = await api.file.select();
    if (!filePath) return;
    const result = await api.file.import(filePath);
    const importedPrompts = result.rows || result.prompts;
    if (result.success && importedPrompts && project) {
      await api.projects.savePrompts(project.id, importedPrompts, filePath);
      // Reload project to get updated promptSets
      const projects = await api.projects.list();
      const updatedProject = projects.find(p => p.id === project.id);
      if (updatedProject) state.currentProject = updatedProject;
      render();
    }
  };
  dropZone?.addEventListener('click', importFile);
  replaceBtn?.addEventListener('click', importFile);

  // Download template
  const downloadTemplate = async () => {
    const result = await api.file.downloadTemplate();
    if (result.success) {
      showToast('Шаблон сохранён');
    } else if (result.canceled) {
      // User cancelled save dialog — do nothing
    } else {
      showToast(result.error || 'Не удалось сохранить шаблон');
    }
  };
  container.querySelector('#btn-download-template')?.addEventListener('click', downloadTemplate);

  // Switch Set
  container.querySelectorAll('.history-btn-switch').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const setId = btn.dataset.id;
      if (setId === activeSetId) return;
      await api.projects.switchSet(project.id, setId);
      state.selections = {};
      state.selectionCurrentPrompt = 0;
      const projects = await api.projects.list();
      const updatedProject = projects.find(p => p.id === project.id);
      if (updatedProject) state.currentProject = updatedProject;
      render();
    });
  });

  // Rename Set
  container.querySelectorAll('.history-btn-rename').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const setId = btn.dataset.id;
      const currentName = btn.dataset.name;
      const newName = prompt('Новое название итерации:', currentName);
      if (newName && newName.trim() && newName.trim() !== currentName) {
        api.projects.renameSet(project.id, setId, newName.trim()).then(async () => {
          const projects = await api.projects.list();
          const updatedProject = projects.find(p => p.id === project.id);
          if (updatedProject) state.currentProject = updatedProject;
          render();
        });
      }
    });
  });

  // Delete Set
  container.querySelectorAll('.history-btn-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const delId = btn.dataset.id;
      const delName = btn.dataset.name;
      // Need prompt count so just search the array:
      const delCount = promptSets.find(s => s.id === delId)?.promptCount || 0;

      // Confirmation modal
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-card" style="width:360px">
          <div class="modal-header">Удалить набор?</div>
          <div class="modal-body">
            <div style="font-size:13px;margin-bottom:8px">
              <strong>${delName}</strong> &mdash; ${delCount} промптов
            </div>
            <div style="font-size:12px;color:var(--text-tertiary);line-height:1.5">
              Все сгенерированные и отобранные файлы этого набора будут удалены.
            </div>
          </div>
          <div class="modal-footer">
            <button id="del-cancel" class="btn btn-secondary">Отмена</button>
            <button id="del-confirm" class="btn" style="background:var(--red);color:#fff">Удалить</button>
          </div>
        </div>
      `;
      container.appendChild(overlay);

      overlay.querySelector('#del-cancel').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });

      overlay.querySelector('#del-confirm').addEventListener('click', async () => {
        overlay.remove();
        const result = await api.projects.deleteSet(project.id, delId);
        if (!result.success) {
          showToast(result.error || 'Не удалось удалить');
          return;
        }
        // Reset selection state
        state.selections = {};
        state.selectionCurrentPrompt = 0;
        // Reload project
        const projects = await api.projects.list();
        const updatedProject = projects.find(p => p.id === project.id);
        if (updatedProject) state.currentProject = updatedProject;
        render();
      });
    });
  });

  // Model change → re-render to update quality/aspect options
  container.querySelector('#sel-model')?.addEventListener('change', async (e) => {
    await api.config.set('selectedModel', e.target.value);
    // Clear stale quality/aspect that may not be valid for new model
    const newCaps = models.find(m => m.id === e.target.value);
    if (newCaps) {
      if (newCaps.qualities.length > 0) {
        await api.config.set('selectedQuality', newCaps.defaultQuality);
      }
      if (newCaps.aspects && newCaps.aspects.length > 0) {
        await api.config.set('selectedRatio', newCaps.defaultAspect);
      }
    }
    render();
  });

  // Write only canonical config keys
  container.querySelector('#seg-quality')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    container.querySelectorAll('#seg-quality .seg-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    api.config.set('selectedQuality', btn.dataset.val);
  });

  container.querySelector('#ratio-grid')?.addEventListener('click', (e) => {
    const item = e.target.closest('.ratio-item');
    if (!item) return;
    container.querySelectorAll('.ratio-item').forEach(i => i.classList.remove('on'));
    item.classList.add('on');
    api.config.set('selectedRatio', item.dataset.ratio);
  });

  container.querySelector('#seg-count')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    container.querySelectorAll('#seg-count .seg-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    api.config.set('lastImagesPerPrompt', parseInt(btn.dataset.val));
    render();
  });

  // ── Launch logic ──
  const handleLaunch = async (isRestart = false) => {
    if (promptCount === 0) return;

    // Pre-launch validation: resolve settings against model capabilities
    const launchSettings = {
      model: selectedModel,
      quality: quality || null,
      aspect: aspect,
      imagesPerPrompt: imagesCount,
    };
    const resolved = await api.models.resolveSettings(launchSettings);

    if (resolved.blocked) {
      showToast(resolved.blockReason || 'Эта модель недоступна для Unlimited');
      return;
    }

    // Show warnings but proceed — settings have been auto-corrected
    if (resolved.warnings && resolved.warnings.length > 0) {
      for (const w of resolved.warnings) {
        showToast(w.message, 4000);
      }
      // Save corrected values
      if (resolved.effective) {
        if (resolved.effective.quality !== quality) {
          await api.config.set('selectedQuality', resolved.effective.quality);
        }
        if (resolved.effective.aspect !== aspect) {
          await api.config.set('selectedRatio', resolved.effective.aspect);
        }
      }
    }

    // ── Guard: check connection status before navigating to progress ──
    const connStatus = state.connectionStatus;
    const READY_STATUSES = ['ready', 'page_not_ready']; // allow page_not_ready — engine will navigate itself
    if (!connStatus || !READY_STATUSES.includes(connStatus)) {
      let msg;
      if (!connStatus || connStatus === 'no_chrome' || connStatus === 'chrome_stopped') {
        msg = 'Сначала запустите Chrome и подключитесь';
      } else if (connStatus === 'not_connected') {
        msg = 'Нажмите «Подключиться» в разделе Подключение';
      } else if (connStatus === 'not_logged_in') {
        msg = 'Войдите в Higgsfield в Chrome, затем нажмите «Проверить»';
      } else {
        msg = 'Chrome не готов. Проверьте подключение.';
      }
      showToast(msg, 4000);
      return;
    }

    if (isRestart) {
      const res = await api.projects.duplicateSetAsActive(project.id);
      if (!res.success) {
        showToast(res.error || 'Не удалось создать новый запуск');
        return;
      }
    }

    // ── New cycle: clear old selection state ──
    state.selections = {};
    state.selectionCurrentPrompt = 0;
    if (project) {
      // Reset active set selections and mark as in_progress
      api.projects.update(project.id, {
        selections: {},
        selectionCurrentPrompt: 0,
        status: 'in_progress',
      });
    }

    state.generationRequested = true;
    navigate('progress');
  };

  container.querySelector('#btn-launch')?.addEventListener('click', () => handleLaunch(false));
  
  container.querySelector('#btn-restart')?.addEventListener('click', () => {
    if (promptCount === 0) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card" style="width:360px">
        <div class="modal-header">Начать генерацию заново?</div>
        <div class="modal-body">
          <div style="font-size:13px;line-height:1.5">
            Будет создан новый набор, и прогресс начнется с нуля (0%).<br><br>
            <span style="color:var(--text-tertiary)">Старые картинки не удалятся &mdash; они останутся в истории предыдущего набора.</span>
          </div>
        </div>
        <div class="modal-footer">
          <button id="restart-cancel" class="btn btn-secondary">Отмена</button>
          <button id="restart-confirm" class="btn btn-primary" style="background:var(--orange);border:none;color:#fff">Начать заново</button>
        </div>
      </div>
    `;
    container.appendChild(overlay);

    overlay.querySelector('#restart-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#restart-confirm').addEventListener('click', async () => {
      overlay.remove();
      handleLaunch(true);
    });
  });
}

// ── Resume Banner: shown when a previous generation was stopped mid-batch ──
function _showResumeBanner(resume, project) {
  if (!container) return;

  // Remove existing banner if any
  container.querySelector('#resume-banner')?.remove();

  const banner = document.createElement('div');
  banner.id = 'resume-banner';
  banner.style.cssText = `
    position:sticky;top:0;z-index:10;
    background:linear-gradient(135deg,rgba(255,159,10,0.12),rgba(255,159,10,0.06));
    border:1px solid rgba(255,159,10,0.3);
    border-radius:10px;margin:0 0 12px;padding:12px 16px;
    display:flex;align-items:flex-start;gap:12px;
    animation:liveTileFadeIn 0.3s ease;
  `;

  // Build action breakdown
  const actionLines = [];
  if (resume.pendingCount > 0) {
    actionLines.push(`<span style="color:var(--text-primary);font-weight:600">${resume.pendingCount}</span> ${resume.pendingCount === 1 ? 'промпт требует генерации' : 'промптов требуют генерации'}`);
  }
  if (resume.partialCount > 0) {
    actionLines.push(`<span style="color:var(--accent);font-weight:600">${resume.partialCount}</span> ${resume.partialCount === 1 ? 'промпт частично заполнен' : 'промпта частично заполнены'} — дозаполним недостающие варианты`);
  }

  const totalAction = resume.pendingCount + resume.partialCount;
  const btnLabel = totalAction === 1 ? '1 промпт' : `${totalAction} промпта`;

  banner.innerHTML = `
    <span style="font-size:20px;margin-top:1px">⏸</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:700;color:var(--orange)">Генерация остановлена</div>
      <div style="font-size:11px;color:var(--text-secondary);margin-top:3px;line-height:1.6">
        Готово: <strong style="color:var(--text-primary)">${resume.doneCount}</strong> из ${resume.totalPrompts} &nbsp;·&nbsp;
        Осталось: <strong style="color:var(--text-primary)">${totalAction}</strong>
      </div>
      ${actionLines.length > 0 ? `<div style="margin-top:6px;display:flex;flex-direction:column;gap:2px">
        ${actionLines.map(l => `<div style="font-size:11px;color:var(--text-tertiary)">${l}</div>`).join('')}
      </div>` : ''}
    </div>
    <div style="flex-shrink:0;margin-top:2px">
      <button id="btn-resume-continue" class="btn btn-primary" style="font-size:11px;padding:5px 14px;background:var(--orange);border-color:var(--orange)">
        ▶ Продолжить (${btnLabel})
      </button>
    </div>
  `;

  // Insert at top of scroll area
  const scrollArea = container.querySelector('[style*="overflow-y:auto"]') || container.firstElementChild;
  if (scrollArea) {
    scrollArea.insertBefore(banner, scrollArea.firstChild);
  }

  // ── "Continue": navigate to progress — meta.json classifier will skip done prompts ──
  banner.querySelector('#btn-resume-continue')?.addEventListener('click', async () => {
    const connStatus = state.connectionStatus;
    const READY_STATUSES = ['ready', 'page_not_ready'];
    if (!connStatus || !READY_STATUSES.includes(connStatus)) {
      const { showToast } = await import('../app.js');
      showToast('Chrome не готов. Проверьте подключение.', 4000);
      return;
    }
    // meta.json classifier in generate:start will automatically skip 'done' prompts
    state.generationRequested = true;
    const { navigate } = await import('../app.js');
    navigate('progress');
  });
}

export default {
  id: 'settings',
  async mount(c) {
    container = c;
    await render();

    // ── Resume state check ──
    // If a previous generation was stopped, show a prominent resume banner
    const project = state.currentProject;
    if (project) {
      try {
        const resume = await api.generate.getResumeState(project.id);
        if (resume?.canResume) {
          _showResumeBanner(resume, project);
        }
      } catch (e) {
        // Non-fatal — settings render already complete
      }
    }
  },
  unmount() { container = null; },
};

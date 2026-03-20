/* ── Settings Screen ── */
import { api, navigate, state, showToast } from '../app.js';

let container = null;

// Module-level selection state (survives re-renders within same mount)
let selectedIndices = null;          // null = all, Set<number> = selected 0-based indices
let promptStatuses = [];             // [{index, status, hasSelection, promptPreview}]
let selectSectionOpen = false;       // collapse state

// Google Sheets state
let sheetsMode = false;              // true = showing sheets input form (when no prompts)
let sheetsLoading = false;           // true during fetch/sync
let sheetsPreview = null;            // cached preview data from API

async function render() {
  const project = state.currentProject;
  const cfg = await api.config.getAll() || {};
  const loadResult = project ? (await api.projects.loadPrompts(project.id)) : {};
  const prompts = loadResult?.prompts || [];
  const promptSets = loadResult?.promptSets || [];
  const activeSetId = loadResult?.activePromptSetId || null;
  const sourceMeta = loadResult?.sourceMeta || null;
  const promptCount = prompts.length;

  // ── Fetch prompt statuses for selective run UI ──
  if (project && promptCount > 0) {
    try {
      const statusResult = await api.projects.getPromptStatuses(project.id);
      promptStatuses = statusResult?.statuses || [];
    } catch { promptStatuses = []; }
  } else {
    promptStatuses = [];
  }

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

  // ── Compute selected prompt count ──
  const selectedCount = selectedIndices ? selectedIndices.size : promptCount;
  const totalImages = selectedCount * imagesCount;

  // Build Iteration History HTML
  let setChipsHTML = '';
  if (promptSets.length > 0) {
    const activeSets   = promptSets.filter(s => !s.archived);
    const archivedSets = promptSets.filter(s => s.archived);

    // ── Render one history row for active (non-archived) sets ──
    const renderActiveRow = (s) => {
      const isActive = s.id === activeSetId;
      const mapStateText  = { draft: 'Черновик', in_progress: 'В процессе', completed: 'Завершён' };
      const mapStateColor = { draft: 'var(--text-tertiary)', in_progress: 'var(--orange)', completed: 'var(--green)' };
      const statusText  = mapStateText[s.status] || s.status;
      const statusColor = mapStateColor[s.status] || 'var(--text-tertiary)';
      const selCount = s.selections ? Object.keys(s.selections).length : 0;
      const selectionsCount = selCount > 0 ? ` &nbsp;·&nbsp; <span style="color:var(--text-secondary);font-weight:500">${selCount}</span> отобрано` : '';

      const activeBadge = isActive
        ? '<span style="font-size:10px;background:var(--accent);color:#fff;padding:2px 6px;border-radius:4px;font-weight:700;letter-spacing:0.3px">АКТИВНАЯ</span>'
        : '';
      const statusBadge = `<div style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:${statusColor};text-transform:uppercase;letter-spacing:0.3px;"><div style="width:6px;height:6px;border-radius:50%;background:${statusColor}"></div>${statusText}</div>`;

      const btnSwitch = !isActive
        ? `<button class="btn btn-ghost history-btn-switch" data-id="${s.id}" style="font-size:11px;padding:4px 12px;border-radius:100px;border:1px solid var(--border);margin-right:4px">Перейти</button>`
        : '';
      const btnRename = `<button class="history-btn-rename" data-id="${s.id}" data-name="${s.name}" title="Переименовать" style="padding:6px;color:var(--text-tertiary);background:transparent;border:none;cursor:pointer;border-radius:4px;transition:0.15s;display:flex" onmouseover="this.style.color='var(--text-primary)';this.style.background='var(--bg-float)'" onmouseout="this.style.color='var(--text-tertiary)';this.style.background='transparent'"><svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>`;

      // Archive button — disabled for in_progress sets
      const isInProgress = s.status === 'in_progress';
      const archiveTitle = isInProgress ? 'В процессе генерации — архивировать нельзя' : 'В архив';
      const btnArchive = `<button class="history-btn-archive" data-id="${s.id}" data-name="${s.name}" data-is-active="${isActive}" title="${archiveTitle}" ${isInProgress ? 'disabled' : ''} style="padding:6px;color:var(--text-tertiary);background:transparent;border:none;cursor:${isInProgress ? 'not-allowed' : 'pointer'};border-radius:4px;transition:0.15s;display:flex;opacity:${isInProgress ? '0.35' : '1'}" onmouseover="if(!this.disabled){this.style.color='var(--accent)';this.style.background='rgba(99,102,241,0.1)'}" onmouseout="this.style.color='var(--text-tertiary)';this.style.background='transparent'"><svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg></button>`;

      const btnDel = !isActive
        ? `<button class="history-btn-del" data-id="${s.id}" data-name="${s.name}" title="Удалить" style="padding:6px;color:var(--text-tertiary);background:transparent;border:none;cursor:pointer;border-radius:4px;transition:0.15s;display:flex" onmouseover="this.style.color='var(--red)';this.style.background='var(--red-soft)'" onmouseout="this.style.color='var(--text-tertiary)';this.style.background='transparent'"><svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>`
        : '';

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
          ${btnArchive}
          ${btnDel}
        </div>
      </div>
      `;
    };

    // ── Render one row for archived sets ──
    const renderArchivedRow = (s) => {
      const mapStateText  = { draft: 'Черновик', in_progress: 'В процессе', completed: 'Завершён' };
      const mapStateColor = { draft: 'var(--text-tertiary)', in_progress: 'var(--orange)', completed: 'var(--green)' };
      const statusText  = mapStateText[s.status] || s.status;
      const statusColor = mapStateColor[s.status] || 'var(--text-tertiary)';
      const archivedDate = s.archivedAt ? new Date(s.archivedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';

      const btnRestore = `<button class="history-btn-restore" data-id="${s.id}" data-name="${s.name}" title="Восстановить из архива" style="font-size:11px;padding:4px 12px;border-radius:100px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);cursor:pointer;transition:0.15s;margin-right:4px" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-secondary)'">Восстановить</button>`;
      const btnDel = `<button class="history-btn-del" data-id="${s.id}" data-name="${s.name}" title="Удалить" style="padding:6px;color:var(--text-tertiary);background:transparent;border:none;cursor:pointer;border-radius:4px;transition:0.15s;display:flex" onmouseover="this.style.color='var(--red)';this.style.background='var(--red-soft)'" onmouseout="this.style.color='var(--text-tertiary)';this.style.background='transparent'"><svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>`;

      return `
      <div class="history-set-row" data-set-id="${s.id}" style="display:flex;align-items:center;background:var(--bg-float);padding:12px 14px;border-radius:10px;border:1px solid var(--border);cursor:default;opacity:0.75;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="font-weight:600;font-size:13px;color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;" title="${s.name}">${s.name}</span>
            <div style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:${statusColor};text-transform:uppercase;letter-spacing:0.3px;"><div style="width:6px;height:6px;border-radius:50%;background:${statusColor}"></div>${statusText}</div>
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);">
            <span style="color:var(--text-tertiary);font-weight:500">${s.promptCount}</span> промптов
            ${archivedDate ? ` &nbsp;·&nbsp; архив ${archivedDate}` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;">
          ${btnRestore}
          ${btnDel}
        </div>
      </div>
      `;
    };

    const activeRows   = activeSets.map(renderActiveRow).join('');
    const archivedRows = archivedSets.map(renderArchivedRow).join('');

    // ── Archive collapsed section ──
    const archiveSection = archivedSets.length > 0 ? `
      <div class="history-archive-section" style="margin-top:10px;">
        <button class="history-archive-toggle" id="archive-toggle" style="display:flex;align-items:center;gap:6px;background:transparent;border:none;cursor:pointer;padding:6px 2px;color:var(--text-tertiary);font-size:12px;font-weight:600;width:100%;text-align:left;transition:0.15s;" onmouseover="this.style.color='var(--text-secondary)'" onmouseout="this.style.color='var(--text-tertiary)'">
          <svg id="archive-toggle-icon" viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform 0.2s"><polyline points="9 18 15 12 9 6"></polyline></svg>
          Архив
          <span style="font-size:11px;font-weight:400;color:inherit;margin-left:2px">${archivedSets.length}</span>
        </button>
        <div id="archive-rows" style="display:none;flex-direction:column;gap:8px;margin-top:6px;">
          ${archivedRows}
        </div>
      </div>
    ` : '';

    const totalSets = promptSets.length;
    setChipsHTML = `
      <div class="history-block" style="margin-top:36px;border-top:1px solid var(--border);padding-top:24px;">
        <div class="field-label" style="margin-bottom:14px;font-size:14px;display:flex;align-items:baseline">
          <span style="color:var(--text-primary)">История итераций</span>
          <span style="font-size:12px;color:var(--text-tertiary);margin-left:8px;font-weight:400">${totalSets} запусков</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${activeRows}
        </div>
        ${archiveSection}
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
            ${promptCount > 0 ? (() => {
              const isSheets = sourceMeta?.type === 'google_sheets';
              const sheetsMeta = sourceMeta?.sheets;
              if (isSheets && sheetsMeta) {
                // ── Google Sheets source display ──
                const syncTime = sheetsMeta.lastSyncAt ? new Date(sheetsMeta.lastSyncAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
                return `
                  <div class="source-file sheets-source">
                    <div class="source-icon sheets-icon">
                      <svg viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                    </div>
                    <div class="source-info">
                      <div class="source-name">Google Sheets</div>
                      <div class="source-meta">${promptCount} промптов · столбец «${sheetsMeta.promptColumn || 'prompt'}»</div>
                      <div class="source-meta" style="margin-top:2px;font-size:10px;color:var(--text-tertiary)">Синхронизировано: ${syncTime}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0">
                      <button id="btn-sheets-refresh" class="source-replace" style="font-size:11px">🔄 Обновить</button>
                      <button id="btn-replace-file" class="source-replace" style="font-size:11px;color:var(--text-tertiary);border-color:var(--border)">CSV</button>
                    </div>
                  </div>
                  <div class="sheets-sync-options" style="margin-top:10px;display:flex;align-items:center;gap:10px">
                    <label class="sheets-checkbox" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:var(--text-secondary)">
                      <input type="checkbox" id="chk-sync-before-launch" ${sheetsMeta.syncBeforeLaunch ? 'checked' : ''} style="accent-color:var(--accent)" />
                      Обновлять перед запуском
                    </label>
                  </div>
                  ${setChipsHTML}
                `;
              } else {
                // ── CSV source display (original) ──
                return `
                  <div class="source-file">
                    <div class="source-icon">
                      <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                    <div class="source-info">
                      <div class="source-name">${sourceMeta?.originalFileName || 'prompts.csv'}</div>
                      <div class="source-meta">${promptCount} промптов</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0">
                      <button id="btn-replace-file" class="source-replace">Добавить новый</button>
                      <button id="btn-sheets-connect" class="source-replace" style="font-size:11px;color:var(--text-tertiary);border-color:var(--border)">из Sheets</button>
                    </div>
                  </div>
                  <div class="template-hint template-hint-subtle" style="margin-top:12px;margin-bottom:0">
                    <a id="btn-download-template" class="template-link" style="font-size:11px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.04);border:1px solid var(--border);">↓ Скачать шаблон</a>
                  </div>
                  ${setChipsHTML}
                `;
              }
            })() : `
              <div class="settings-onboarding-hint">
                <span class="soh-step soh-step-done">✓ Проект создан</span>
                <span class="soh-arrow">→</span>
                <span class="soh-step soh-step-current">Загрузите промпты</span>
                <span class="soh-arrow">→</span>
                <span class="soh-step soh-step-next">Настройте</span>
                <span class="soh-arrow">→</span>
                <span class="soh-step soh-step-next">Запустите</span>
              </div>
              <div class="source-tabs" style="display:flex;gap:10px;margin-bottom:14px">
                <button class="source-tab ${!sheetsMode ? 'source-tab-active' : ''}" id="tab-csv">📄 CSV / XLSX</button>
                <button class="source-tab ${sheetsMode ? 'source-tab-active' : ''}" id="tab-sheets">📊 Google Sheets</button>
              </div>
              ${!sheetsMode ? `
                <div id="drop-zone" class="drop-zone drop-zone-onboarding">
                  <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <div style="font-size:13px;font-weight:600">Загрузите промпты</div>
                  <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">CSV или XLSX — кликните или перетащите</div>
                </div>
                <div class="template-hint-inline">
                  <span>Нет файла?</span>
                  <a id="btn-download-template" class="template-link">Скачайте шаблон</a>
                  <span style="color:var(--text-tertiary)">&nbsp;— заполните и загрузите</span>
                </div>
              ` : `
                <div class="sheets-input-area">
                  <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;line-height:1.5">
                    Вставьте ссылку на Google Sheets. Таблица должна быть открыта для всех по ссылке.
                  </div>
                  <div class="sheets-url-row">
                    <input type="text" id="sheets-url" class="sheets-url-input" placeholder="https://docs.google.com/spreadsheets/d/..." autocomplete="off" spellcheck="false" />
                    <button id="btn-sheets-check" class="btn btn-primary sheets-check-btn" ${sheetsLoading ? 'disabled' : ''}>${sheetsLoading ? '…' : 'Проверить'}</button>
                  </div>
                  <div id="sheets-error" class="sheets-error" style="display:none"></div>
                  <div id="sheets-preview" class="sheets-preview" style="display:${sheetsPreview ? 'block' : 'none'}">
                    ${sheetsPreview ? buildSheetsPreviewHTML(sheetsPreview) : ''}
                  </div>
                </div>
              `}
            `}
          </div>

          <!-- Selective Prompt Run -->
          ${promptCount > 0 ? (() => {
            // Summary text for collapsed state
            const summaryText = selectedIndices
              ? `Выбрано ${selectedCount} из ${promptCount}`
              : `Все ${promptCount} промптов`;

            // Quick filter chip counts
            const pendingCount = promptStatuses.filter(s => s.status === 'pending').length;
            const errorCount = promptStatuses.filter(s => s.status === 'error' || s.status === 'partial').length;
            const noSelectionCount = promptStatuses.filter(s => s.status === 'done' && !s.hasSelection).length;

            // Build checkbox rows
            const checkboxRows = promptStatuses.map(s => {
              const checked = selectedIndices ? selectedIndices.has(s.index) : true;
              const statusDot = s.status === 'done' ? '<span style="color:var(--green);font-size:9px">●</span>'
                : s.status === 'error' || s.status === 'partial' ? '<span style="color:var(--red);font-size:9px">●</span>'
                : s.status === 'in_progress' ? '<span style="color:var(--orange);font-size:9px">●</span>'
                : '<span style="color:var(--text-tertiary);font-size:9px">○</span>';
              const dimmed = s.status === 'done' && (selectedIndices ? !selectedIndices.has(s.index) : false) ? 'opacity:0.45;' : '';
              return `<label class="sp-row" style="${dimmed}" data-idx="${s.index}">
                <input type="checkbox" class="sp-check" data-idx="${s.index}" ${checked ? 'checked' : ''} />
                <span class="sp-num">${s.index + 1}</span>
                ${statusDot}
                <span class="sp-text">${s.promptPreview || '—'}</span>
              </label>`;
            }).join('');

            return `
            <div class="sp-section" style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px;">
              <button id="sp-toggle" class="sp-toggle">
                <svg id="sp-toggle-icon" viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform 0.2s;${selectSectionOpen ? 'transform:rotate(90deg)' : ''}"><polyline points="9 18 15 12 9 6"></polyline></svg>
                <span class="sp-toggle-label">${summaryText}</span>
                ${selectedIndices ? '<span class="sp-toggle-reset" id="sp-reset">Сбросить</span>' : ''}
              </button>
              <div id="sp-body" style="display:${selectSectionOpen ? 'block' : 'none'};margin-top:12px;">
                <div class="sp-filters">
                  <button class="sp-chip ${!selectedIndices ? 'sp-chip-active' : ''}" data-filter="all">Все</button>
                  ${pendingCount > 0 ? `<button class="sp-chip" data-filter="pending">Без генераций <span class="sp-chip-count">${pendingCount}</span></button>` : ''}
                  ${errorCount > 0 ? `<button class="sp-chip" data-filter="errors">Ошибки <span class="sp-chip-count">${errorCount}</span></button>` : ''}
                  ${noSelectionCount > 0 ? `<button class="sp-chip" data-filter="no-final">Без финала <span class="sp-chip-count">${noSelectionCount}</span></button>` : ''}
                </div>
                <div class="sp-list-header">
                  <label class="sp-select-all">
                    <input type="checkbox" id="sp-check-all" ${!selectedIndices || selectedCount === promptCount ? 'checked' : ''} />
                    <span>Выбрать все</span>
                  </label>
                  <span class="sp-list-count" id="sp-selected-count">${summaryText}</span>
                </div>
                <div class="sp-list" id="sp-list">
                  ${checkboxRows}
                </div>
              </div>
            </div>`;
          })() : ''}

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
            <div class="summary-col"><div class="summary-value">${selectedCount}</div><div class="summary-label">${selectedIndices ? `из ${promptCount}` : 'промптов'}</div></div>
            <div class="summary-col"><div class="summary-value">×${imagesCount}</div><div class="summary-label">вариантов</div></div>
            <div class="summary-col"><div class="summary-value" style="color:var(--accent)">${totalImages}</div><div class="summary-label">всего</div></div>
          </div>
          ${(() => {
            const s = (typeof state !== 'undefined' ? state.connectionStatus : null) || 'unknown';
            const bad = !['ready', 'page_not_ready'].includes(s);
            if (!bad) return '';
            const msgs = {
              no_chrome: 'Установите Google Chrome для запуска',
              chrome_stopped: 'Запустите Chrome и подключитесь',
              chrome_running: 'Подключаюсь к Chrome…',
              not_logged_in: 'Войдите в Higgsfield в Chrome',
              unknown: 'Проверяю соединение…',
            };
            const msg = msgs[s] || 'Проверьте подключение к Chrome';
            return `<div class="settings-conn-hint" data-nav="connection">
              <span class="sch-dot"></span>
              <span class="sch-msg">${msg}</span>
              <span class="sch-link">Подключить →</span>
            </div>`;
          })()}
          ${activeSetHasProgress ? `
            <div style="display:flex;gap:12px;width:100%">
              <button id="btn-launch" class="btn-launch" style="flex:1" ${selectedCount === 0 ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                ${selectedIndices ? `Запустить ${selectedCount} промптов` : 'Продолжить генерацию'}
              </button>
              <button id="btn-restart" class="btn-launch" style="flex:0.6;background:var(--bg-elevated);color:var(--text-secondary);border:1px solid var(--border-2)" ${selectedCount === 0 ? 'disabled' : ''}>
                ↺ Начать заново
              </button>
            </div>
          ` : `
            <button id="btn-launch" class="btn-launch" ${selectedCount === 0 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              ${selectedIndices ? `Запустить ${selectedCount} промптов` : 'Запустить генерацию'}
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
      // Reset selection on new file import
      selectedIndices = null;
      state.selectedPromptIndices = null;
      sheetsPreview = null;
      sheetsMode = false;
      // Reload project to get updated promptSets
      const projects = await api.projects.list();
      const updatedProject = projects.find(p => p.id === project.id);
      if (updatedProject) state.currentProject = updatedProject;
      render();
    }
  };
  dropZone?.addEventListener('click', importFile);
  replaceBtn?.addEventListener('click', importFile);

  // Connection hint → navigate to connection screen
  container.querySelector('.settings-conn-hint')?.addEventListener('click', () => {
    navigate('connection');
  });

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

  // ── Source Tabs (CSV ↔ Google Sheets) ──
  container.querySelector('#tab-csv')?.addEventListener('click', () => {
    sheetsMode = false;
    sheetsPreview = null;
    render();
  });
  container.querySelector('#tab-sheets')?.addEventListener('click', () => {
    sheetsMode = true;
    render();
  });

  // ── Google Sheets: Check URL ──
  container.querySelector('#btn-sheets-check')?.addEventListener('click', async () => {
    const urlInput = container.querySelector('#sheets-url');
    const errorEl = container.querySelector('#sheets-error');
    const previewEl = container.querySelector('#sheets-preview');
    const checkBtn = container.querySelector('#btn-sheets-check');
    if (!urlInput) return;

    const url = urlInput.value.trim();
    if (!url) {
      showSheetsError(errorEl, 'Вставьте ссылку на Google Sheets');
      return;
    }

    // Show loading
    if (checkBtn) { checkBtn.disabled = true; checkBtn.textContent = '…'; }
    if (errorEl) errorEl.style.display = 'none';
    sheetsLoading = true;

    try {
      const result = await api.sheets.preview(url);
      sheetsLoading = false;
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Проверить'; }

      if (!result.success) {
        sheetsPreview = null;
        showSheetsError(errorEl, result.error);
        if (previewEl) previewEl.style.display = 'none';
        return;
      }

      // Show preview
      sheetsPreview = { ...result, url };
      if (previewEl) {
        previewEl.innerHTML = buildSheetsPreviewHTML(sheetsPreview);
        previewEl.style.display = 'block';
      }

      // Bind sync button inside preview
      bindSheetsSync(project);
    } catch (err) {
      sheetsLoading = false;
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Проверить'; }
      showSheetsError(errorEl, 'Ошибка соединения');
    }
  });

  // Enter key in URL input triggers check
  container.querySelector('#sheets-url')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      container.querySelector('#btn-sheets-check')?.click();
    }
  });

  // ── Google Sheets: Connect from existing CSV view ──
  container.querySelector('#btn-sheets-connect')?.addEventListener('click', () => {
    sheetsMode = true;
    // Force re-render to show sheets input (even when prompts exist, we'll show the form below)
    // For simplicity: create a small inline form
    showInlineSheetsForm(project);
  });

  // ── Google Sheets: Refresh from connected source ──
  container.querySelector('#btn-sheets-refresh')?.addEventListener('click', async () => {
    if (!project || !sourceMeta?.sheets) return;
    const refreshBtn = container.querySelector('#btn-sheets-refresh');
    if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = '…'; }

    try {
      const result = await api.sheets.sync(project.id, sourceMeta.sheets.url, sourceMeta.sheets.promptColumn);
      if (!result.success) {
        showToast(result.error || 'Не удалось обновить');
        if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '🔄 Обновить'; }
        return;
      }

      showToast(`✓ Синхронизировано: ${result.promptCount} промптов`);
      selectedIndices = null;
      state.selectedPromptIndices = null;
      const projects = await api.projects.list();
      const updatedProject = projects.find(p => p.id === project.id);
      if (updatedProject) state.currentProject = updatedProject;
      render();
    } catch {
      showToast('Ошибка синхронизации');
      if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '🔄 Обновить'; }
    }
  });

  // ── Sync Before Launch checkbox ──
  container.querySelector('#chk-sync-before-launch')?.addEventListener('change', async (e) => {
    if (!project || !sourceMeta?.sheets) return;
    // Update syncBeforeLaunch in the active set's sourceMeta
    const activeSet = (await api.projects.loadPrompts(project.id));
    if (activeSet?.sourceMeta?.sheets) {
      activeSet.sourceMeta.sheets.syncBeforeLaunch = e.target.checked;
      // Persist via project update (we update the whole sourceMeta)
      // For simplicity, store in config as a per-project flag
      await api.config.set(`syncBeforeLaunch_${project.id}`, e.target.checked);
    }
  });

  // If there's an existing preview and sync button, bind it
  bindSheetsSync(project);

  // ── Selective Prompt Picker events ──
  // Toggle expand/collapse
  container.querySelector('#sp-toggle')?.addEventListener('click', (e) => {
    // Don't toggle if clicking reset button
    if (e.target.closest('#sp-reset')) return;
    selectSectionOpen = !selectSectionOpen;
    const body = container.querySelector('#sp-body');
    const icon = container.querySelector('#sp-toggle-icon');
    if (body) body.style.display = selectSectionOpen ? 'block' : 'none';
    if (icon) icon.style.transform = selectSectionOpen ? 'rotate(90deg)' : '';
  });

  // Reset selection
  container.querySelector('#sp-reset')?.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedIndices = null;
    state.selectedPromptIndices = null;
    render();
  });

  // Quick filter chips
  container.querySelectorAll('.sp-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const filter = chip.dataset.filter;
      if (filter === 'all') {
        selectedIndices = null;
      } else {
        const indices = new Set();
        promptStatuses.forEach(s => {
          if (filter === 'pending' && s.status === 'pending') indices.add(s.index);
          if (filter === 'errors' && (s.status === 'error' || s.status === 'partial')) indices.add(s.index);
          if (filter === 'no-final' && s.status === 'done' && !s.hasSelection) indices.add(s.index);
        });
        selectedIndices = indices.size > 0 ? indices : null;
      }
      state.selectedPromptIndices = selectedIndices ? [...selectedIndices] : null;
      render();
    });
  });

  // Individual checkboxes
  container.querySelectorAll('.sp-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx);
      // Initialize from current state if needed
      if (!selectedIndices) {
        selectedIndices = new Set(promptStatuses.map(s => s.index));
      }
      if (cb.checked) {
        selectedIndices.add(idx);
      } else {
        selectedIndices.delete(idx);
      }
      // If all selected, reset to null (= all)
      if (selectedIndices.size === promptStatuses.length) {
        selectedIndices = null;
      }
      state.selectedPromptIndices = selectedIndices ? [...selectedIndices] : null;
      render();
    });
  });

  // Select all checkbox
  container.querySelector('#sp-check-all')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      selectedIndices = null;
    } else {
      selectedIndices = new Set(); // empty = nothing selected
    }
    state.selectedPromptIndices = selectedIndices ? [...selectedIndices] : null;
    render();
  });

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

  // ── Archive Toggle (expand/collapse archive section) ──
  const archiveToggleBtn = container.querySelector('#archive-toggle');
  if (archiveToggleBtn) {
    archiveToggleBtn.addEventListener('click', () => {
      const archiveRows = container.querySelector('#archive-rows');
      const toggleIcon  = container.querySelector('#archive-toggle-icon');
      if (!archiveRows) return;
      const isOpen = archiveRows.style.display !== 'none';
      archiveRows.style.display = isOpen ? 'none' : 'flex';
      if (toggleIcon) toggleIcon.style.transform = isOpen ? '' : 'rotate(90deg)';
    });
  }

  // ── Archive Set handler ──
  container.querySelectorAll('.history-btn-archive').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;

      const archId     = btn.dataset.id;
      const archName   = btn.dataset.name;
      const isActive   = btn.dataset.isActive === 'true';
      const archSet    = promptSets.find(s => s.id === archId);

      if (archSet?.status === 'in_progress') {
        showToast('⛔ Остановите генерацию перед архивированием');
        return;
      }

      // Determine next active set info for the confirm modal
      const remainingActive = promptSets.filter(s => s.id !== archId && !s.archived);
      const nextSet = remainingActive.length > 0 ? remainingActive[remainingActive.length - 1] : null;

      if (isActive) {
        // Needs explicit confirm modal for active set
        await showArchiveActiveSetModal(archId, archName, project, nextSet);
      } else {
        // Non-active set: archive directly
        await doArchiveSet(archId, archName, project, false);
      }
    });
  });

  // ── Restore (unarchive) handler ──
  container.querySelectorAll('.history-btn-restore').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const restoreId   = btn.dataset.id;
      const restoreName = btn.dataset.name;

      const result = await api.projects.unarchiveSet(project.id, restoreId);
      if (!result?.success) {
        showToast(`⛔ ${result?.error || 'Не удалось восстановить набор'}`);
        return;
      }

      showToast(`📦 «${restoreName}» восстановлен из архива`);

      // Reload and re-render
      const projects = await api.projects.list();
      const updatedProject = projects.find(p => p.id === project.id);
      if (updatedProject) state.currentProject = updatedProject;
      render();
    });
  });

  // Delete Set — trash-based, with in_progress guard and nextActiveSet notification
  container.querySelectorAll('.history-btn-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const delId = btn.dataset.id;
      const delName = btn.dataset.name;
      const delSet = promptSets.find(s => s.id === delId);
      const delCount = delSet?.promptCount || 0;
      const isActive = delId === activeSetId;

      // UI guard: in_progress
      if (delSet?.status === 'in_progress') {
        showToast('⛔ Остановите генерацию перед удалением набора');
        return;
      }

      // Determine which set becomes active after deletion
      const remainingSets = promptSets.filter(s => s.id !== delId);
      const nextSet = remainingSets.length > 0 ? remainingSets[remainingSets.length - 1] : null;

      const nextSetNote = isActive
        ? nextSet
          ? `<div style="margin-top:8px;display:flex;align-items:flex-start;gap:6px;padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;font-size:11px;color:var(--text-secondary);text-align:left;line-height:1.5">
               <svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:var(--text-tertiary);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;margin-top:1px"><polyline points="9 18 15 12 9 6"/></svg>
               После удаления активным станет: <strong>&nbsp;«${nextSet.name}»</strong>
             </div>`
          : `<div style="margin-top:8px;display:flex;align-items:flex-start;gap:6px;padding:8px 12px;background:rgba(255,159,10,0.08);border:1px solid rgba(255,159,10,0.25);border-radius:8px;font-size:11px;color:var(--orange);text-align:left;line-height:1.5">
               <svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
               Это последний набор — проект станет пустым
             </div>`
        : '';

      // Confirmation modal
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-card delete-confirm-modal" style="width:380px">
          <div class="delete-modal-icon">
            <svg viewBox="0 0 24 24" style="width:28px;height:28px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </div>
          <div class="modal-header" style="padding-top:0">Удалить набор?</div>
          <div class="delete-modal-body">
            <div class="delete-modal-target">«${delName}»</div>
            <div class="delete-modal-meta">${delCount} промптов · все изображения${isActive ? ' · <span style="color:var(--accent)">активный</span>' : ''}</div>
            <div class="delete-modal-note">
              <svg viewBox="0 0 24 24" style="width:13px;height:13px;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Набор будет перемещён в корзину Mews.<br>Вы сможете восстановить его в течение 30 дней.
            </div>

            ${nextSetNote}
          </div>
          <div class="modal-footer">
            <button id="del-cancel" class="btn btn-secondary">Отмена</button>
            <button id="del-confirm" class="btn btn-danger">Удалить набор</button>
          </div>
        </div>
      `;
      container.appendChild(overlay);

      overlay.querySelector('#del-cancel').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
      overlay.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') overlay.remove(); });

      overlay.querySelector('#del-confirm').addEventListener('click', async () => {
        overlay.remove();
        const result = await api.projects.deleteSet(project.id, delId);
        if (!result.success) {
          showToast(`⛔ ${result.error || 'Не удалось удалить набор'}`);
          return;
        }
        const toastMsg = result.nextActiveSet
          ? `🗑 Набор удалён. Активный: «${result.nextActiveSet.name}»`
          : '🗑 Набор удалён';
        showToast(toastMsg);
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

    // ── Pre-launch: Sync from Google Sheets if enabled ──
    if (sourceMeta?.type === 'google_sheets' && sourceMeta?.sheets) {
      const syncFlag = await api.config.get(`syncBeforeLaunch_${project.id}`);
      if (syncFlag || sourceMeta.sheets.syncBeforeLaunch) {
        showToast('Обновляю промпты из Google Sheets…', 3000);
        try {
          const syncResult = await api.sheets.sync(project.id, sourceMeta.sheets.url, sourceMeta.sheets.promptColumn);
          if (syncResult.success) {
            showToast(`✓ Синхронизировано: ${syncResult.promptCount} промптов`);
            // Reload project to pick up new set
            const projects = await api.projects.list();
            const updatedProject = projects.find(p => p.id === project.id);
            if (updatedProject) state.currentProject = updatedProject;
          } else {
            showToast(`⚠ Sheets: ${syncResult.error}. Запуск со старыми промптами.`, 4000);
          }
        } catch {
          showToast('⚠ Не удалось обновить из Sheets. Запуск со старыми промптами.', 4000);
        }
      }
    }

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
    state.selectedPromptIndices = selectedIndices ? [...selectedIndices] : null;
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


// ── doArchiveSet: execute archive + reload ──
async function doArchiveSet(setId, setName, project, wasActiveSet) {
  const result = await api.projects.archiveSet(project.id, setId);
  if (!result?.success) {
    showToast(`⛔ ${result?.error || 'Не удалось архивировать набор'}`);
    return;
  }

  let toastMsg = `📦 «${setName}» перемещён в архив`;
  if (wasActiveSet && result.nextActiveSet) {
    toastMsg += `. Активный: «${result.nextActiveSet.name}»`;
  } else if (wasActiveSet && !result.nextActiveSet) {
    toastMsg += '. Активных наборов не осталось';
  }
  showToast(toastMsg);

  // Reset selection state if active set changed
  if (wasActiveSet) {
    state.selections = {};
    state.selectionCurrentPrompt = 0;
  }

  // Reload project
  const projects = await api.projects.list();
  const updatedProject = projects.find(p => p.id === project.id);
  if (updatedProject) state.currentProject = updatedProject;
  render();
}

// ── showArchiveActiveSetModal: confirm dialog before archiving the ACTIVE set ──
function showArchiveActiveSetModal(setId, setName, project, nextSet) {
  return new Promise((resolve) => {
    const nextSetNote = nextSet
      ? `<div style="margin-top:8px;display:flex;align-items:flex-start;gap:6px;padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;font-size:11px;color:var(--text-secondary);text-align:left;line-height:1.5">
           <svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:var(--accent);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;margin-top:1px"><polyline points="9 18 15 12 9 6"/></svg>
           После архивирования активным станет:&nbsp;<strong>«${nextSet.name}»</strong>
         </div>`
      : `<div style="margin-top:8px;display:flex;align-items:flex-start;gap:6px;padding:8px 12px;background:rgba(255,159,10,0.08);border:1px solid rgba(255,159,10,0.25);border-radius:8px;font-size:11px;color:var(--orange);text-align:left;line-height:1.5">
           <svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
           Это единственный активный набор — проект останется без активного набора
         </div>`;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card delete-confirm-modal" style="width:400px">
        <div class="delete-modal-icon" style="background:rgba(99,102,241,0.12);border-color:rgba(99,102,241,0.25)">
          <svg viewBox="0 0 24 24" style="width:26px;height:26px;stroke:var(--accent)"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>
        </div>
        <div class="modal-header" style="padding-top:0">Архивировать активный набор?</div>
        <div class="delete-modal-body">
          <div class="delete-modal-target">«${setName}»</div>
          <div class="delete-modal-meta">Активный набор · файлы сохранятся</div>
          <div class="delete-modal-note">
            <svg viewBox="0 0 24 24" style="width:13px;height:13px;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Набор скроется из списка, но файлы не удалятся.<br>Восстановить можно в любое время.
          </div>
          ${nextSetNote}
        </div>
        <div class="modal-footer">
          <button id="arch-cancel" class="btn btn-secondary">Отмена</button>
          <button id="arch-confirm" class="btn btn-primary" style="background:var(--accent);border-color:var(--accent)">В архив</button>
        </div>
      </div>
    `;

    container.appendChild(overlay);
    requestAnimationFrame(() => overlay.querySelector('#arch-confirm')?.focus());

    const cleanup = (confirmed) => {
      overlay.remove();
      resolve(confirmed);
    };

    overlay.querySelector('#arch-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('#arch-confirm').addEventListener('click', async () => {
      cleanup(true);
      await doArchiveSet(setId, setName, project, true);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') cleanup(false); });
  });
}
// ── Google Sheets helper functions ──

function buildSheetsPreviewHTML(preview) {
  if (!preview) return '';
  const previewLines = (preview.preview || []).map((p, i) =>
    `<div class="sheets-preview-line"><span class="sheets-preview-num">${i + 1}</span>${p.length > 80 ? p.substring(0, 80) + '…' : p}</div>`
  ).join('');

  return `
    <div class="sheets-preview-card">
      <div class="sheets-preview-header">
        <div class="sheets-preview-stat">
          <span class="sheets-preview-count">${preview.promptCount}</span> промптов
          ${preview.skippedCount > 0 ? `<span class="sheets-preview-skipped">(${preview.skippedCount} пустых пропущено)</span>` : ''}
        </div>
        <div class="sheets-preview-col">Столбец: <strong>${preview.promptColumn || '?'}</strong></div>
      </div>
      <div class="sheets-preview-body">
        ${previewLines}
      </div>
      <button id="btn-sheets-sync" class="btn btn-primary sheets-sync-btn">
        <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;margin-right:6px"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        Синхронизировать
      </button>
    </div>
  `;
}

function showSheetsError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function bindSheetsSync(project) {
  if (!container) return;
  const syncBtn = container.querySelector('#btn-sheets-sync');
  if (!syncBtn || syncBtn._bound) return;
  syncBtn._bound = true;

  syncBtn.addEventListener('click', async () => {
    if (!project || !sheetsPreview) return;
    syncBtn.disabled = true;
    syncBtn.innerHTML = '…';

    try {
      const result = await api.sheets.sync(project.id, sheetsPreview.url, sheetsPreview.promptColumn);
      if (!result.success) {
        showToast(result.error || 'Ошибка синхронизации');
        syncBtn.disabled = false;
        syncBtn.innerHTML = 'Синхронизировать';
        return;
      }

      showToast(`✓ Синхронизировано: ${result.promptCount} промптов`);
      selectedIndices = null;
      state.selectedPromptIndices = null;
      sheetsPreview = null;
      sheetsMode = false;

      // Reload project
      const projects = await api.projects.list();
      const updatedProject = projects.find(p => p.id === project.id);
      if (updatedProject) state.currentProject = updatedProject;
      render();
    } catch {
      showToast('Ошибка синхронизации');
      syncBtn.disabled = false;
      syncBtn.innerHTML = 'Синхронизировать';
    }
  });
}

function showInlineSheetsForm(project) {
  if (!container) return;

  // Create inline form below existing source info
  const sourceArea = container.querySelector('#source-area');
  if (!sourceArea) return;

  // Remove existing inline form if any
  sourceArea.querySelector('.sheets-inline-form')?.remove();

  const form = document.createElement('div');
  form.className = 'sheets-inline-form';
  form.style.cssText = 'margin-top:14px;border-top:1px solid var(--border);padding-top:14px;';
  form.innerHTML = `
    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;line-height:1.5">
      Вставьте ссылку на Google Sheets. Таблица должна быть открыта для всех по ссылке.
    </div>
    <div class="sheets-url-row">
      <input type="text" id="sheets-url-inline" class="sheets-url-input" placeholder="https://docs.google.com/spreadsheets/d/..." autocomplete="off" spellcheck="false" />
      <button id="btn-sheets-check-inline" class="btn btn-primary sheets-check-btn">Проверить</button>
    </div>
    <div id="sheets-error-inline" class="sheets-error" style="display:none"></div>
    <div id="sheets-preview-inline" class="sheets-preview" style="display:none"></div>
  `;
  sourceArea.appendChild(form);

  // Focus input
  form.querySelector('#sheets-url-inline')?.focus();

  // Check button handler
  form.querySelector('#btn-sheets-check-inline')?.addEventListener('click', async () => {
    const urlInput = form.querySelector('#sheets-url-inline');
    const errorEl = form.querySelector('#sheets-error-inline');
    const previewEl = form.querySelector('#sheets-preview-inline');
    const checkBtn = form.querySelector('#btn-sheets-check-inline');
    const url = urlInput?.value?.trim();

    if (!url) {
      showSheetsError(errorEl, 'Вставьте ссылку на Google Sheets');
      return;
    }

    if (checkBtn) { checkBtn.disabled = true; checkBtn.textContent = '…'; }
    if (errorEl) errorEl.style.display = 'none';

    try {
      const result = await api.sheets.preview(url);
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Проверить'; }

      if (!result.success) {
        showSheetsError(errorEl, result.error);
        if (previewEl) previewEl.style.display = 'none';
        return;
      }

      sheetsPreview = { ...result, url };
      if (previewEl) {
        previewEl.innerHTML = buildSheetsPreviewHTML(sheetsPreview);
        previewEl.style.display = 'block';
      }
      bindSheetsSync(project);
    } catch {
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Проверить'; }
      showSheetsError(errorEl, 'Ошибка соединения');
    }
  });

  // Enter key
  form.querySelector('#sheets-url-inline')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.querySelector('#btn-sheets-check-inline')?.click();
    }
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

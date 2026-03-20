/* ── Progress Screen ── */
import { api, navigate, state } from '../app.js';

const MAX_STATE_WITH_PREVIEW = 200; // state cap: beyond this, age out old tiles

let container = null;
let cleanupProgress = null;
let isRunning = false;
let lastPct = 0;       // monotonic: bar never goes backwards
let uiPhase = 'generating'; // generating | pauseRequested | paused | cancelConfirm | cancelling | cancelled
let cancelWatchdog = null;          // 20s safety timer after cancel — shows terminal state if 'complete' never arrives
let cancelCountdownInterval = null; // live elapsed-seconds ticker shown in the hero detail text

// ── Clear cancel watchdog + countdown ticker (safe to call multiple times) ──
function _clearCancelWatchdog() {
  if (cancelWatchdog)          { clearTimeout(cancelWatchdog);    cancelWatchdog          = null; }
  if (cancelCountdownInterval) { clearInterval(cancelCountdownInterval); cancelCountdownInterval = null; }
}
let lastRunSnapshot = null; // {promptTotal, agedCounts, liveTileCount, primary, detail} — post-run context
// persistentGrid REMOVED: DOM is rebuilt from state on every mount (browser img cache prevents flash)

// Format raw seconds in messages: (102с) → (1м 42с)
function formatTime(msg) {
  if (!msg) return msg;
  return msg.replace(/\((\d+)с\)/g, (_, sStr) => {
    const s = parseInt(sStr);
    if (s < 60) return `(${s}с)`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r > 0 ? `(${m}м ${r}с)` : `(${m}м)`;
  });
}

// Persistent state across remounts (survives unmount/mount cycle)
let activeRunProjectId = null;
let activeRunProjectName = '';
let activeRunSetName = '';
let lastState = {
  pct: 0,
  primary: 'Генерация изображений',
  detail: 'Ожидание запуска…',
  detailColor: '',
  logEntries: [],      // [{message, step, mode}]
  liveTiles: [],       // [{key, promptIdx, slotIdx, status, url, isBackfill}] — recent tiles data
  agedCounts: { done: 0, failed: 0 }, // aggregate counters for aged-out tiles
  agedSlots: new Map(),   // Map<promptIdx, bitmask> — bits 0-7: done slots, bits 8-15: failed slots
  promptCur: 0,
  promptTotal: 0,
  savedSlotsPerPrompt: {}, // {promptIdx: maxSavedSlot} — confirmed progress floor
  sessionMode: null,       // 'normal' | 'mixed' | 'resume' | null
  sessionSummary: null,    // {runCount, backfillCount, skipCount} — from session_start
};

// ── Build a single log entry HTML based on step + mode ──
function _buildLogEntryHTML(message, step, mode) {
  if (step === 'debug') {
    return `<span style="color:var(--text-tertiary);font-size:10px;font-family:monospace;flex:1;margin-left:14px;">🛠 ${message}</span>`;
  }

  // Step-based priority (errors/retries) > mode-based colour
  const isFailed  = step === 'slot_failed' || step === 'boundary_desync';
  const isRetry   = step === 'retry';
  const isSkipped = step === 'session_start';

  let dotStyle = '';
  let textColor = 'var(--text-secondary)';

  if (isFailed) {
    dotStyle  = 'background:var(--red)';
    textColor = 'var(--red)';
  } else if (isRetry) {
    dotStyle  = 'background:var(--orange)';
    textColor = 'var(--orange)';
  } else if (isSkipped) {
    dotStyle  = 'background:transparent;border:1px solid var(--border-2)';
    textColor = 'var(--text-tertiary)';
  } else if (mode === 'backfill') {
    dotStyle  = 'background:var(--accent)';
    textColor = 'var(--text-secondary)';
  } else if (mode === 'resume') {
    dotStyle  = 'background:var(--text-tertiary)';
    textColor = 'var(--text-tertiary)';
  }
  // 'normal' — default: dot accent, text secondary (no override needed)

  return `<span class="log-dot" style="${dotStyle}"></span><span style="color:${textColor};flex:1">${message}</span>`;
}

function _buildTileHTML(tile) {
  const slotLabel = `${tile.promptIdx}.${tile.slotIdx}`;
  
  if (tile.status === 'failed') {
    return `
      <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
        <span style="font-size:20px;opacity:0.5">✕</span>
        <span style="font-size:10px;color:var(--red);font-weight:600">Слот ${tile.slotIdx}</span>
        <span style="font-size:9px;color:var(--text-tertiary)">${tile.reason || 'ошибка'}</span>
      </div>
      <span style="position:absolute;bottom:6px;left:6px;font-size:10px;font-weight:700;background:rgba(0,0,0,0.6);color:var(--red);padding:2px 6px;border-radius:4px;">${slotLabel}</span>
      <span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--red);box-shadow:0 0 6px var(--red);"></span>
    `;
  }
  
  if (tile.status === 'placeholder') {
    return `
      <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
        <span style="font-size:20px;color:var(--green)">✓</span>
        <span style="font-size:10px;color:var(--text-secondary);font-weight:600">Сохранено</span>
      </div>
      <span style="position:absolute;bottom:6px;left:6px;font-size:10px;font-weight:700;background:rgba(0,0,0,0.6);color:#fff;padding:2px 6px;border-radius:4px;">${slotLabel}</span>
      <span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);"></span>
    `;
  }
  
  // saved status (has url)
  return `
    ${tile.url ? `<img src="${tile.url}" style="width:100%;height:100%;object-fit:cover;display:block" />` : ''}
    <span style="position:absolute;bottom:6px;left:6px;font-size:10px;font-weight:700;background:rgba(0,0,0,0.6);color:#fff;padding:2px 6px;border-radius:4px;backdrop-filter:blur(4px);">${slotLabel}</span>
    ${tile.isBackfill ? `<span style="position:absolute;top:6px;left:6px;font-size:9px;font-weight:700;background:var(--accent);color:#fff;padding:2px 6px;border-radius:4px;box-shadow:0 0 6px var(--accent);backdrop-filter:blur(4px);">⟳ backfill</span>` : ''}
    <span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);"></span>
  `;
}

function _updateDOMTile(tile) {
  if (!container) return;
  const grid = document.getElementById('live-grid');
  if (!grid) return;
  
  let node = grid.querySelector(`[data-key="${tile.key}"]`);
  
  if (!node) {
    node = document.createElement('div');
    node.className = 'live-tile';
    node.dataset.key = tile.key;
    if (tile.status !== 'failed') node.dataset.saved = 'true';
    const extraStyle = tile.status === 'failed' ? 'border:1px solid rgba(255,59,48,0.2);' : '';
    node.style.cssText = `position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg-float);animation: liveTileFadeIn 0.35s ease;${extraStyle}`;
    node.innerHTML = _buildTileHTML(tile);
    grid.appendChild(node);
    return;
  }

  // FIX A: для saved-плиток с url — не трогать img если src не изменился
  if (tile.status === 'saved' && tile.url) {
    const existingImg = node.querySelector('img');
    if (existingImg && existingImg.getAttribute('src') === tile.url) {
      return; // img уже правильный — нет смысла пересоздавать, нет flash
    }
  }

  const htmlContent = _buildTileHTML(tile);
  if (node.innerHTML !== htmlContent) {
    node.innerHTML = htmlContent;
  }
}

function upsertTile(tileData) {
  if (!tileData || !tileData.key) return;

  const existingIdx = lastState.liveTiles.findIndex(t => t.key === tileData.key);
  let tile;
  
  if (existingIdx >= 0) {
    // Merge while preserving required fields
    tile = { ...lastState.liveTiles[existingIdx], ...tileData };
    lastState.liveTiles[existingIdx] = tile;
  } else {
    // Create new with unified shape
    tile = {
      key: tileData.key,
      promptIdx: tileData.promptIdx || 1,
      slotIdx: tileData.slotIdx || 1,
      status: tileData.status || 'unknown',
      url: tileData.url || null,
      isBackfill: !!tileData.isBackfill,
      reason: tileData.reason || null
    };
    lastState.liveTiles.push(tile);
  }

  // Stable sort: oldest prompts first, then slot order
  lastState.liveTiles.sort((a, b) => {
    if (a.promptIdx !== b.promptIdx) return a.promptIdx - b.promptIdx;
    return a.slotIdx - b.slotIdx;
  });

  ageOutOldTiles();
  _updateDOMTile(tile); // Updates HTML content and ensures it exists in DOM
  
  // Force existing DOM nodes into the visually stable order
  const grid = document.getElementById('live-grid');
  if (grid) {
    lastState.liveTiles.forEach(t => {
      const node = grid.querySelector(`[data-key="${t.key}"]`);
      if (node) grid.appendChild(node);
    });
    updateSummaryRow();
  }
}

// FIX B: патч только hero-элементов без полного rebuild при remount
function _patchHero() {
  const pct = isRunning ? lastState.pct : 0;
  const pctEl     = document.getElementById('ph-percent');
  const barEl     = document.getElementById('ph-bar');
  const primaryEl = document.getElementById('ph-primary');
  const detailEl  = document.getElementById('ph-detail');
  const countEl   = document.getElementById('log-count');
  if (pctEl)     pctEl.textContent = pct + '%';
  if (barEl)     barEl.style.width = pct + '%';
  if (primaryEl) primaryEl.textContent = isRunning ? lastState.primary : 'Генерация изображений';
  if (detailEl) {
    detailEl.textContent = isRunning ? lastState.detail : 'Ожидание запуска…';
    detailEl.style.color = isRunning ? (lastState.detailColor || 'var(--text-tertiary)') : 'var(--text-tertiary)';
  }
  if (countEl) countEl.textContent = isRunning ? `${lastState.promptCur} / ${lastState.promptTotal}` : '0 / 0';
}

// FIX B: обновить состояние кнопок pause/cancel без rebuild
function _patchButtonStates() {
  const heroActions    = document.getElementById('hero-actions');
  const confirmStrip   = document.getElementById('cancel-confirm-strip');
  const cancellingStrip = document.getElementById('cancelling-strip');
  const btnPause       = document.getElementById('btn-pause');
  const btnCancel      = document.getElementById('btn-cancel');

  if (uiPhase === 'cancelConfirm') {
    if (heroActions)      heroActions.style.display = 'none';
    if (confirmStrip)     confirmStrip.style.display = 'flex';
    if (cancellingStrip)  cancellingStrip.style.display = 'none';
  } else if (uiPhase === 'cancelling') {
    if (heroActions)      heroActions.style.display = 'none';
    if (confirmStrip)     confirmStrip.style.display = 'none';
    if (cancellingStrip)  cancellingStrip.style.display = 'block';
  } else {
    if (heroActions)      heroActions.style.display = 'flex';
    if (confirmStrip)     confirmStrip.style.display = 'none';
    if (cancellingStrip)  cancellingStrip.style.display = 'none';
  }

  if (btnPause) {
    if (uiPhase === 'pauseRequested') {
      btnPause.textContent = 'Останавливаю…';
      btnPause.disabled = true;
      btnPause.style.opacity = '0.6';
    } else {
      btnPause.textContent = '⏸ Пауза';
      btnPause.disabled = false;
      btnPause.style.opacity = '';
    }
  }
  if (btnCancel) {
    btnCancel.style.display = uiPhase === 'pauseRequested' ? 'none' : '';
  }
}

// FIX B: перепривязать обработчики кнопок после patch-mode remount
function _reattachEventListeners() {
  const btnPause   = document.getElementById('btn-pause');
  const btnCancel  = document.getElementById('btn-cancel');
  const btnConfirm = document.getElementById('btn-cancel-confirm');
  const btnDismiss = document.getElementById('btn-cancel-dismiss');

  // Клонируем узлы чтобы снять старые listeners (безопасно — мы не трогали grid)
  const replaceBtn = (el) => {
    if (!el) return null;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    return clone;
  };

  const newPause   = replaceBtn(btnPause);
  const newCancel  = replaceBtn(btnCancel);
  const newConfirm = replaceBtn(btnConfirm);
  const newDismiss = replaceBtn(btnDismiss);

  newPause?.addEventListener('click', async () => {
    uiPhase = 'pauseRequested';
    _patchButtonStates();
    const bar = document.getElementById('ph-bar');
    if (bar) bar.classList.add('pulsing');
    const detailEl = document.getElementById('ph-detail');
    if (detailEl) {
      detailEl.textContent = 'Останавливаю — дождитесь завершения текущего слота…';
      detailEl.style.color = 'var(--orange)';
    }
    lastState.detail = 'Останавливаю — дождитесь завершения текущего слота…';
    lastState.detailColor = 'var(--orange)';
    await api.generate.pause();
  });

  newCancel?.addEventListener('click', () => {
    uiPhase = 'cancelConfirm';
    _patchButtonStates();
  });

  newDismiss?.addEventListener('click', () => {
    uiPhase = 'generating';
    _patchButtonStates();
  });

  newConfirm?.addEventListener('click', async () => {
    uiPhase = 'cancelling';
    _patchButtonStates();
    const detailEl = document.getElementById('ph-detail');
    if (detailEl) {
      detailEl.textContent = 'Прерываю процесс без сохранения текущего слота…';
      detailEl.style.color = 'var(--red)';
    }
    lastState.detail = 'Прерываю процесс без сохранения текущего слота…';
    lastState.detailColor = 'var(--red)';

    // ── Live countdown: update detail text every 3s so screen looks alive ──
    _clearCancelWatchdog();
    let countSec = 0;
    cancelCountdownInterval = setInterval(() => {
      countSec += 3;
      const el = document.getElementById('ph-detail');
      if (el && uiPhase === 'cancelling') el.textContent = `Завершаю текущий слот… (${countSec}с)`;
    }, 3000);

    await api.generate.cancel();

    // ── Watchdog: if 'complete' doesn't arrive in 20s → show terminal state inline ──
    cancelWatchdog = setTimeout(() => {
      if (uiPhase === 'cancelling') _showCancelledFinalState();
    }, 20000);
  });
}

function render() {
  // Only reset progress counters if NOT resuming an active generation
  if (!isRunning && !lastRunSnapshot) {
    lastPct = 0;
    uiPhase = 'generating';
    // activeRunProjectId is managed by IPC and updateProgress
    // activeRunProjectName = '';
    // activeRunSetName = '';
    lastState = {
      pct: 0,
      primary: 'Генерация изображений',
      detail: 'Ожидание запуска…',
      detailColor: '',
      logEntries: [],
      liveTiles: [],
      agedCounts: { done: 0, failed: 0 },
      agedSlots: new Map(),
      promptCur: 0,
      promptTotal: 0,
      savedSlotsPerPrompt: {},
      sessionMode: null,
      sessionSummary: null,
    };
  }

  // FIX B: PATCH MODE при remount во время активной генерации
  // Если grid уже присутствует в DOM — обновляем только hero, не трогаем плитки
  const isForeign = activeRunProjectId && state.currentProject && state.currentProject.id !== activeRunProjectId;
  if (isRunning && !isForeign && document.getElementById('live-grid')) {
    _patchHero();
    _patchButtonStates();
    updateSummaryRow();
    _renderHeroSessionChips();
    _reattachEventListeners();
    return;
  }

  const pct = isRunning ? lastState.pct : 0;
  const primary = isRunning ? lastState.primary : 'Генерация изображений';
  const detail = isRunning ? lastState.detail : 'Ожидание запуска…';
  const detailColor = isRunning ? lastState.detailColor : '';
  const logCount = isRunning ? `${lastState.promptCur} / ${lastState.promptTotal}` : '0 / 0';

  // Compute summary counts
  const agedTotal = lastState.agedCounts.done + lastState.agedCounts.failed;
  const totalGenerated = lastState.liveTiles.length + agedTotal;

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 280px;overflow:hidden;flex:1">
      <div style="display:flex;flex-direction:column;overflow:hidden;padding:16px;gap:12px">
        <!-- Progress hero -->
        ${isForeign ? `
          <div class="foreign-alert" style="background:rgba(255,159,10,0.1);border:1px solid rgba(255,159,10,0.3);border-radius:10px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;margin-bottom:0px">
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--orange)">⚠️ Фоновая генерация</div>
              <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">Выполняется для: <strong>${activeRunProjectName || 'неизвестного проекта'}</strong>${activeRunSetName ? ` / ${activeRunSetName}` : ''}</div>
            </div>
            <button id="btn-switch-active" class="btn btn-secondary" style="font-size:11px;padding:6px 12px;color:var(--orange);border-color:var(--orange)">Перейти к ней</button>
          </div>
        ` : ''}
        <div class="progress-hero">
          <div id="ph-percent" class="ph-percent">${pct}%</div>
          <div style="flex:1">
            ${(!isForeign && (activeRunProjectName || activeRunSetName)) ? `
              <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;font-weight:600">
                ПРОЕКТ: ${activeRunProjectName}${activeRunSetName ? ` / ${activeRunSetName}` : ''}
              </div>
            ` : ''}
            <div style="display:flex;align-items:center;gap:8px">
              <div id="ph-primary" style="font-size:14px;font-weight:700">${primary}</div>
              ${lastState.sessionMode && lastState.sessionMode !== 'normal' ? `<span id="session-mode-badge" class="session-mode-badge session-mode-badge--${lastState.sessionMode}">${lastState.sessionMode === 'mixed' ? 'Новые + дозаполнение' : '✓ всё готово'}</span>` : ''}
            </div>
            <div id="ph-detail" style="font-size:12px;color:${detailColor || 'var(--text-tertiary)'};margin-top:2px">${detail}</div>
            <div class="progress-bar-track"><div id="ph-bar" class="progress-bar-fill" style="width:${pct}%"></div></div>
            <div id="hero-session-chips" class="hero-session-chips"></div>
          </div>
          <div id="hero-actions-container">
            <div id="hero-actions" style="display:${uiPhase === 'cancelConfirm' || uiPhase === 'cancelling' ? 'none' : 'flex'};align-items:center;gap:8px">
              <button id="btn-pause" class="btn btn-secondary" style="font-size:11px;padding:6px 12px;color:var(--red)" ${uiPhase === 'pauseRequested' ? 'disabled' : ''}>
                ${uiPhase === 'pauseRequested' ? 'Останавливаю…' : '⏸ Пауза'}
              </button>
              <button id="btn-cancel" class="btn-cancel-ghost" ${uiPhase === 'pauseRequested' ? 'style="display:none"' : ''}>✕ Отменить</button>
            </div>
            <div id="cancel-confirm-strip" class="cancel-confirm-strip" style="display:${uiPhase === 'cancelConfirm' ? 'flex' : 'none'}">
              <span style="font-size:11px;margin-right:4px">Отменить генерацию?</span>
              <button id="btn-cancel-confirm" class="btn btn-primary" style="background:var(--red);border:none;padding:4px 10px;font-size:11px">Да, отменить</button>
              <button id="btn-cancel-dismiss" class="btn-cancel-ghost" style="padding:4px 8px;font-size:11px">Нет</button>
            </div>
            <div id="cancelling-strip" style="display:${uiPhase === 'cancelling' ? 'block' : 'none'};font-size:11px;color:var(--red);opacity:0.8;padding:6px 0">
              Отменяю…
            </div>
          </div>
        </div>
        <!-- Live grid -->
        <div id="live-grid" class="live-grid">
          ${agedTotal > 0 ? `<div class="prompt-summary-row">
            <span class="prompt-summary-num">\u2714</span>
            <span>${agedTotal} \u0440\u0430\u043D\u0435\u0435</span>
            <span class="prompt-summary-count">${totalGenerated} \u0432\u0441\u0435\u0433\u043E</span>
          </div>` : ''}
        </div>
      </div>
      <!-- Log panel -->
      <div class="log-panel">
        <div class="log-header">
          <span class="log-title">\u041B\u043E\u0433 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438</span>
          <span id="log-count" class="log-count">${logCount}</span>
        </div>
        <div id="log-list" class="log-list"></div>
      </div>
    </div>
  `;

  // Restore log entries on remount (всегда — log не персистируется в DOM)
  if (isRunning && lastState.logEntries.length > 0) {
    const logList = document.getElementById('log-list');
    if (logList) {
      lastState.logEntries.forEach(entry => {
        const el = document.createElement('div');
        el.className = 'log-entry';
        el.innerHTML = _buildLogEntryHTML(entry.message, entry.step, entry.mode);
        logList.appendChild(el);
      });
    }
  }

  // ATOMIC REBUILD: всегда строим grid из lastState.liveTiles
  // Browser кеширует img по src → повторная вставка того же dataUrl не даёт flash
  if (isRunning && lastState.liveTiles.length > 0) {
    const grid = document.getElementById('live-grid');
    if (grid) {
      for (let i = 0; i < lastState.liveTiles.length; i++) {
        _updateDOMTile(lastState.liveTiles[i]);
      }
    }
  }
  // Update summary row
  updateSummaryRow();

  // Restore hero session chips on remount
  _renderHeroSessionChips();

  // Restore button states (pause/cancel strip visibility)
  _patchButtonStates();

  container.querySelector('#btn-switch-active')?.addEventListener('click', async () => {
    const list = await api.projects.list();
    const p = list.find(x => x.id === activeRunProjectId);
    if (p) {
      state.currentProject = p;
      const { updateStatusbar } = await import('../app.js');
      updateStatusbar();
      render();
    }
  });

  container.querySelector('#btn-pause')?.addEventListener('click', async () => {
    uiPhase = 'pauseRequested';
    
    // Immediate visual feedback
    const btnPause = container.querySelector('#btn-pause');
    const btnCancel = container.querySelector('#btn-cancel');
    if (btnPause) {
      btnPause.textContent = 'Останавливаю…';
      btnPause.disabled = true;
      btnPause.style.opacity = '0.6';
    }
    if (btnCancel) btnCancel.style.display = 'none';

    // Pulse progress bar
    const bar = document.getElementById('ph-bar');
    if (bar) bar.classList.add('pulsing');

    const detailEl = document.getElementById('ph-detail');
    if (detailEl) {
      detailEl.textContent = 'Останавливаю — дождитесь завершения текущего слота…';
      detailEl.style.color = 'var(--orange)';
    }
    lastState.detail = 'Останавливаю — дождитесь завершения текущего слота…';
    lastState.detailColor = 'var(--orange)';
    
    await api.generate.pause();
  });

  container.querySelector('#btn-cancel')?.addEventListener('click', () => {
    uiPhase = 'cancelConfirm';
    const heroActions = container.querySelector('#hero-actions');
    const confirmStrip = container.querySelector('#cancel-confirm-strip');
    if (heroActions) heroActions.style.display = 'none';
    if (confirmStrip) confirmStrip.style.display = 'flex';
  });

  container.querySelector('#btn-cancel-dismiss')?.addEventListener('click', () => {
    uiPhase = 'generating';
    const heroActions = container.querySelector('#hero-actions');
    const confirmStrip = container.querySelector('#cancel-confirm-strip');
    if (heroActions) heroActions.style.display = 'flex';
    if (confirmStrip) confirmStrip.style.display = 'none';
  });

  container.querySelector('#btn-cancel-confirm')?.addEventListener('click', async () => {
    uiPhase = 'cancelling';

    const confirmStrip = container.querySelector('#cancel-confirm-strip');
    const cancellingStrip = container.querySelector('#cancelling-strip');
    if (confirmStrip) confirmStrip.style.display = 'none';
    if (cancellingStrip) cancellingStrip.style.display = 'block';

    const detailEl = document.getElementById('ph-detail');
    if (detailEl) {
      detailEl.textContent = 'Прерываю процесс без сохранения текущего слота…';
      detailEl.style.color = 'var(--red)';
    }
    lastState.detail = 'Прерываю процесс без сохранения текущего слота…';
    lastState.detailColor = 'var(--red)';

    // ── Live countdown ──
    _clearCancelWatchdog();
    let countSec = 0;
    cancelCountdownInterval = setInterval(() => {
      countSec += 3;
      const el = document.getElementById('ph-detail');
      if (el && uiPhase === 'cancelling') el.textContent = `Завершаю текущий слот… (${countSec}с)`;
    }, 3000);

    await api.generate.cancel();

    // ── 20s watchdog ──
    cancelWatchdog = setTimeout(() => {
      if (uiPhase === 'cancelling') _showCancelledFinalState();
    }, 20000);
  });
}

function showError(message) {
  if (!container) return;
  const detail = document.getElementById('ph-detail');
  if (detail) {
    detail.textContent = message || 'Ошибка генерации';
    detail.style.color = 'var(--red)';
  }
  const primary = document.getElementById('ph-primary');
  if (primary) primary.textContent = 'Ошибка';
  // Add "Back to Settings" button
  const heroEl = container.querySelector('.progress-hero');
  if (heroEl && !container.querySelector('#btn-back-settings')) {
    const btn = document.createElement('button');
    btn.id = 'btn-back-settings';
    btn.className = 'btn btn-secondary';
    btn.style.cssText = 'font-size:11px;padding:6px 14px;margin-top:8px';
    btn.textContent = '← Вернуться в настройки';
    btn.addEventListener('click', () => navigate('settings'));
    heroEl.appendChild(btn);
  }
}

// ── State cap: age out old tiles to free memory ──
function ageOutOldTiles() {
  while (lastState.liveTiles.length > MAX_STATE_WITH_PREVIEW) {
    const old = lastState.liveTiles.shift();
    // Aggregate into compact counters instead of keeping individual records
    if (old.status === 'failed') {
      lastState.agedCounts.failed++;
    } else {
      lastState.agedCounts.done++;
    }
    // Track slot in compact per-prompt bitmask for accurate reconciliation
    // Bits 0-7: done slots, Bits 8-15: failed slots
    const promptIdx = old.promptIdx || 0;
    const slotMatch = old.key.match(/s(\d+)/);
    if (slotMatch) {
      const slotBit = parseInt(slotMatch[1]) - 1; // 0-based
      const shift = old.status === 'failed' ? slotBit + 8 : slotBit;
      const prev = lastState.agedSlots.get(promptIdx) || 0;
      lastState.agedSlots.set(promptIdx, prev | (1 << shift));
    }
  }
}

// ── Update summary row in the live grid ──
function updateSummaryRow() {
  const grid = document.getElementById('live-grid');
  if (!grid) return;
  const { done, failed } = lastState.agedCounts;
  const agedTotal = done + failed;
  const totalGenerated = lastState.liveTiles.length + agedTotal;
  let row = grid.querySelector('.prompt-summary-row');
  if (agedTotal > 0) {
    if (!row) {
      row = document.createElement('div');
      row.className = 'prompt-summary-row';
      grid.insertBefore(row, grid.firstChild);
    }
    const parts = [];
    if (done > 0) parts.push(`${done} сохранено`);
    if (failed > 0) parts.push(`<span style="color:var(--red)">${failed} ошибок</span>`);
    row.innerHTML = `
      <span class="prompt-summary-num">✔</span>
      <span>${parts.join(' · ')}</span>
      <span class="prompt-summary-count">${totalGenerated} всего</span>
    `;
  } else if (row) {
    row.remove();
  }
}

// ── syncDiskImages (Phase 1 hook) ──
function syncDiskImages(promptIdx) {
  if (!activeRunProjectId) return;
  api.projects.getImages(activeRunProjectId, promptIdx - 1).then(res => {
    if (res && res.images) {
      res.images.forEach(img => {
        const match = img.name.match(/gen_(\d+)/);
        if (match) {
          const slot = parseInt(match[1]);
          const key = `p${promptIdx}-s${slot}`;
          const existingTile = lastState.liveTiles.find(t => t.key === key);
          const mask = lastState.agedSlots.get(promptIdx) || 0;
          const doneAged = (mask & (1 << (slot - 1))) !== 0;

          if (existingTile) {
            upsertTile({ key, url: img.dataUrl, status: existingTile.status === 'placeholder' ? 'saved' : existingTile.status });
          } else if (!doneAged) {
            upsertTile({ key, promptIdx, slotIdx: slot, status: 'saved', url: img.dataUrl, isBackfill: true });
          }
        }
      });
    }
  });
}

// ── Tile reconciliation ──
// After a prompt is 'done', ensure all expected slots have tiles.
// This catches any missed/late/reordered 'saved' events.
function reconcileTiles(promptIdx, slotCount) {
  for (let s = 1; s <= slotCount; s++) {
    const key = `p${promptIdx}-s${s}`;
    const exists = lastState.liveTiles.find(t => t.key === key);
    // Also check for failed tiles and aged tiles
    const failKey = `p${promptIdx}-s${s}-fail`;
    const failExists = lastState.liveTiles.find(t => t.key === failKey);
    // Check if this specific slot was already aged out (bitmask lookup)
    const mask = lastState.agedSlots.get(promptIdx) || 0;
    const slotBit = s - 1; // 0-based
    const doneAged = (mask & (1 << slotBit)) !== 0;
    const failAged = (mask & (1 << (slotBit + 8))) !== 0;
    if (!exists && !failExists && !doneAged && !failAged) {
      // Backfill placeholder tile
      upsertTile({ key, promptIdx, slotIdx: s, status: 'placeholder' });
    }
  }
}

function updateProgress(data) {
  // ── Terminal states ──
  if (data.status === 'complete' || data.status === 'fatal_error' || data.status === 'auth_error') {
    isRunning = false;
    _clearCancelWatchdog(); // always disarm watchdog on any terminal event
  }

  // ── Terminal states ──
  if (data.status === 'complete' || data.status === 'fatal_error' || data.status === 'auth_error') {
    // ── FIX: Force completion state into persistent model BEFORE DOM check ──
    if (data.status === 'complete' && uiPhase !== 'pauseRequested' && uiPhase !== 'cancelling') {
      lastPct = 100;
      lastState.pct = 100;
      lastState.primary = 'Генерация завершена';
      lastState.detail = 'Переход к отбору…';
      lastState.detailColor = 'var(--green)';

      // ── RECONCILE: final sweep across all prompts ──
      if (data.results && Array.isArray(data.results)) {
        data.results.forEach((r, i) => {
          const runIdx = i + 1;
          const total = r.totalSlots || 4;
          reconcileTiles(runIdx, total);
        });
      }
    } else if (data.status === 'complete' && uiPhase === 'pauseRequested') {
      lastState.primary = 'Приостановлено';
      lastState.detail = 'Генерация приостановлена. Сохранённые изображения доступны.';
      lastState.detailColor = 'var(--orange)';
    } else if (data.status === 'complete' && uiPhase === 'cancelling') {
      lastState.primary = 'Отменено';
      lastState.detail = 'Генерация отменена. Текущий слот потерян.';
      lastState.detailColor = 'var(--red)';
    }

    // ── Snapshot AFTER reconciliation — accurate final counts ──
    const liveDone = lastState.liveTiles.filter(t => t.status !== 'failed').length;
    const liveFailed = lastState.liveTiles.filter(t => t.status === 'failed').length;
    lastRunSnapshot = {
      promptTotal: lastState.promptTotal,
      doneCount: lastState.agedCounts.done + liveDone,
      failedCount: lastState.agedCounts.failed + liveFailed,
      status: data.status,
      isStopped: uiPhase === 'pauseRequested',
      recentLogs: lastState.logEntries.slice(0, 5),
      recentTiles: lastState.liveTiles.slice(-8).map(t => ({ key: t.key, status: t.status, url: t.url, promptIdx: t.promptIdx, slotIdx: t.slotIdx, isBackfill: t.isBackfill })),
    };

    const isForeign = activeRunProjectId && state.currentProject && state.currentProject.id !== activeRunProjectId;
    if (data.status === 'complete' || data.status === 'fatal_error' || data.status === 'auth_error') {
       activeRunProjectId = null;
    }

    if (!container) return;

    if (isForeign) {
       if (data.status === 'complete') {
          container.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;text-align:center;padding:40px;">
              <div style="font-size:36px;opacity:0.5">✅</div>
              <div style="font-size:16px;font-weight:700;color:var(--text-secondary)">Фоновая генерация завершена</div>
            </div>`;
       }
       return;
    }

    if (data.status === 'complete') {
      // ── Guard: watchdog already showed terminal cancelled state — ignore late 'complete' ──
      if (uiPhase === 'cancelled') return;

      const pctEl = document.getElementById('ph-percent');
      const primary = document.getElementById('ph-primary');
      const detail = document.getElementById('ph-detail');
      const bar = document.getElementById('ph-bar');
      if (uiPhase === 'pauseRequested') {
        // ── Paused: stay on Progress, show paused state in hero ──
        uiPhase = 'paused';
        showPausedState();
      } else if (uiPhase === 'cancelling' || uiPhase === 'cancelConfirm') {
        // ── Cancelled (engine finished before watchdog) — show inline terminal state ──
        _showCancelledFinalState();
      } else {
        if (pctEl) pctEl.textContent = '100%';
        if (primary) primary.textContent = lastState.primary;
        if (detail) {
          detail.textContent = lastState.detail;
          detail.style.color = lastState.detailColor;
        }
        if (bar) bar.style.width = '100%';
        setTimeout(() => navigate('selection'), 1500);
      }
    } else {
      showError(data.message);
    }
    return;
  }

  // ── Recoverable desync: quarantine event ──
  if (data.step === 'boundary_desync') {
    lastState.primary = 'Десинк-карантин';
    lastState.detail = 'Обнаружен поздний результат — изолирован. Batch продолжается.';
    lastState.detailColor = 'var(--orange)';
    if (container) {
      const primaryEl = document.getElementById('ph-primary');
      const detailEl = document.getElementById('ph-detail');
      if (primaryEl) primaryEl.textContent = lastState.primary;
      if (detailEl) {
        detailEl.textContent = lastState.detail;
        detailEl.style.color = lastState.detailColor;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // STATE PERSISTENCE: always runs, even when container is null
  // ══════════════════════════════════════════════════════════════

  // ── SESSION START: summary event from main.js ──
  if (data.step === 'session_start') {
    lastState.sessionMode    = data.sessionMode || 'normal';
    lastState.sessionSummary = { runCount: data.runCount || 0, backfillCount: data.backfillCount || 0, skipCount: data.skipCount || 0 };
    lastState.promptTotal    = data.promptTotal || lastState.promptTotal;
    activeRunProjectId       = data.projectId || activeRunProjectId;
    activeRunProjectName     = data.projectName || activeRunProjectName;
    activeRunSetName         = data.setName || activeRunSetName;

    // Persist as first log entry
    lastState.logEntries.unshift({ message: data.message, step: 'session_start', mode: null });

    // DOM: render session chips in hero + mode badge
    if (container) {
      // Render chips in hero (not in log)
      _renderHeroSessionChips();

      // Update mode badge in hero (next to ph-primary)
      const primaryEl = document.getElementById('ph-primary');
      if (primaryEl && lastState.sessionMode !== 'normal') {
        let existing = document.getElementById('session-mode-badge');
        if (!existing) {
          existing = document.createElement('span');
          existing.id = 'session-mode-badge';
          primaryEl.after(existing);
        }
        existing.className = `session-mode-badge session-mode-badge--${lastState.sessionMode}`;
        existing.textContent = lastState.sessionMode === 'mixed' ? 'Новые + дозаполнение' : '✓ всё готово';
      }
    }
    return; // session_start has no progress bar impact
  }

  // ── Calculate combined progress ──
  const promptCur = data.promptCurrent || 1;
  const promptTotal = data.promptTotal || 1;
  const ipp = data.imagesPerPrompt || 4;
  const slotCur = data.current || 0;

  // Track confirmed saved slots as progress floor
  if (data.step === 'saved') {
    const savedSlot = data.savedSlot || slotCur;
    const prev = lastState.savedSlotsPerPrompt[promptCur] || 0;
    lastState.savedSlotsPerPrompt[promptCur] = Math.max(prev, savedSlot);
  }
  if (data.step === 'slot_failed') {
    const failedSlot = data.failedSlot || slotCur;
    const prev = lastState.savedSlotsPerPrompt[promptCur] || 0;
    lastState.savedSlotsPerPrompt[promptCur] = Math.max(prev, failedSlot);
  }
  const confirmedFloor = lastState.savedSlotsPerPrompt[promptCur] || 0;

  let combinedPct = 0;
  const basePromptPct = ((promptCur - 1) / promptTotal) * 100;
  const perPromptPct = 100 / promptTotal;
  // Floor: never go below confirmed saved progress for this prompt
  const floorPct = basePromptPct + (confirmedFloor / ipp) * perPromptPct;

  if (data.step === 'saved') {
    const savedSlot = data.savedSlot || slotCur;
    combinedPct = basePromptPct + (savedSlot / ipp) * perPromptPct;
  } else if (data.step === 'slot_failed') {
    const failedSlot = data.failedSlot || slotCur;
    combinedPct = basePromptPct + (failedSlot / ipp) * perPromptPct;
  } else if (data.step === 'done' || data.step === 'partial_skipped') {
    // 'done'            — prompt fully generated, reconcile tiles
    // 'partial_skipped' — prompt had partial results, skipped (Stage 2). Count as full step.
    combinedPct = (promptCur / promptTotal) * 100;
    
    // Sync actual disk images (Phase 1)
    syncDiskImages(promptCur);

    if (data.step === 'done') {
      // ── RECONCILE: backfill any missing tiles for this prompt ──
      reconcileTiles(promptCur, ipp);
    }
    // partial_skipped: no reconcileTiles — partial prompts have no expected tiles to fill

  } else if (data.step === 'generate' || data.step === 'downloading' || data.step === 'waiting') {
    const slotIdx = slotCur || 1;
    combinedPct = basePromptPct + ((slotIdx - 1) / ipp) * perPromptPct;
  } else {
    combinedPct = basePromptPct;
  }

  // Apply floor: never go below confirmed saved progress
  combinedPct = Math.max(combinedPct, floorPct);

  // Monotonic: never go backwards
  const pct = Math.max(Math.round(combinedPct), lastPct);
  lastPct = pct;

  // Persist state (always, regardless of container mount state)
  if (!data._retryUpgrade) {
    const isPausedUi = uiPhase === 'pauseRequested' || uiPhase === 'cancelling' || uiPhase === 'cancelConfirm';
    const primaryText = isPausedUi ? lastState.primary : `Промпт ${promptCur} из ${promptTotal}`;
    const detailText = isPausedUi ? lastState.detail : formatTime(data.message || `Промпт ${promptCur} / ${promptTotal}`);
    const detailCol = isPausedUi ? lastState.detailColor : '';
    lastState.pct = pct;
    lastState.primary = primaryText;
    lastState.detail = detailText;
    lastState.detailColor = detailCol;
    lastState.promptCur = promptCur;
    lastState.promptTotal = promptTotal;
  }

  // Persist log entry (always, skip for retry-upgrade)
  if (!data._retryUpgrade && data.message) {
    lastState.logEntries.unshift({ message: formatTime(data.message), step: data.step, mode: data._mode || null });
    if (lastState.logEntries.length > 100) lastState.logEntries.length = 100;
  }

  // Persist tile state (always) — saved tiles
  if (data.step === 'saved') {
    const promptIdx = data.promptIndex || promptCur;
    const slotIdx = data.slotIndex || data.savedSlot;
    const key = `p${promptIdx}-s${slotIdx}`;
    upsertTile({ key, promptIdx, slotIdx, status: 'saved', url: data.previewDataUrl });
  }

  // Persist failed tile state (always)
  if (data.step === 'slot_failed') {
    const key = `p${promptCur}-s${data.failedSlot}-fail`;
    upsertTile({ key, promptIdx: promptCur, slotIdx: data.failedSlot, status: 'failed', reason: data.failedReason });
  }

  // ══════════════════════════════════════════════════════════════
  // DOM UPDATES: only when mounted
  // ══════════════════════════════════════════════════════════════
  if (!container) return;

  // ── Update UI elements ──
  const pctEl = document.getElementById('ph-percent');
  const primaryEl = document.getElementById('ph-primary');
  const detailEl = document.getElementById('ph-detail');
  const barEl = document.getElementById('ph-bar');
  const countEl = document.getElementById('log-count');

  if (pctEl) pctEl.textContent = pct + '%';
  if (barEl) barEl.style.width = pct + '%';
  if (countEl) countEl.textContent = `${promptCur} / ${promptTotal}`;

  const isPausedUi = uiPhase === 'pauseRequested' || uiPhase === 'cancelling' || uiPhase === 'cancelConfirm';
  if (primaryEl && !isPausedUi) primaryEl.textContent = lastState.primary;
  if (detailEl && !isPausedUi) {
    detailEl.textContent = lastState.detail;
    detailEl.style.color = lastState.detailColor;
  }

  // ── Log entry DOM ──
  if (!data._retryUpgrade) {
    const logList = document.getElementById('log-list');
    if (logList && data.message) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = _buildLogEntryHTML(formatTime(data.message), data.step, data._mode);
      logList.prepend(entry);
    }
  }
}

// ── Render session summary chips into hero (single source of truth) ──
function _renderHeroSessionChips() {
  const chipsEl = document.getElementById('hero-session-chips');
  if (!chipsEl) return;
  const summary = lastState.sessionSummary;
  if (!summary || lastState.sessionMode === 'normal' || lastState.sessionMode === null) {
    chipsEl.innerHTML = '';
    return;
  }
  const chips = [];
  if (summary.runCount > 0)      chips.push(`<span class="hero-chip hero-chip--normal">🟢 ${summary.runCount} ${summary.runCount === 1 ? 'новый' : 'новых'}</span>`);
  if (summary.backfillCount > 0) chips.push(`<span class="hero-chip hero-chip--backfill">🔵 ${summary.backfillCount} дозаполн${summary.backfillCount === 1 ? 'ение' : 'ения'}</span>`);
  if (summary.skipCount > 0)     chips.push(`<span class="hero-chip hero-chip--skip">⏱ ${summary.skipCount} уже готов${summary.skipCount === 1 ? '' : 'ы'}</span>`);
  chipsEl.innerHTML = chips.join('');
}

// ── Paused state: replaces hero content only, keeps grid + log intact ──
function showPausedState() {
  if (!container) return;
  const heroEl = container.querySelector('.progress-hero');
  if (!heroEl) return;

  const s = lastRunSnapshot;
  if (!s) return;

  // Stats
  const remaining = Math.max(0, (s.promptTotal || 0) - Math.ceil((s.doneCount || 0) / 4));
  const statParts = [];
  if (s.doneCount > 0)   statParts.push(`<strong>${s.doneCount}</strong> сохранено`);
  if (s.failedCount > 0) statParts.push(`<span style="color:var(--red)"><strong>${s.failedCount}</strong> ошибок</span>`);
  if (remaining > 0)     statParts.push(`<strong>${remaining}</strong> промптов осталось`);

  heroEl.className = 'progress-hero progress-paused';
  heroEl.innerHTML = `
    <div class="paused-layout">
      <div class="paused-icon">⏸</div>
      <div class="paused-body">
        <div class="paused-title">Генерация приостановлена</div>
        <div class="paused-stats">${statParts.join(' · ')}</div>
        <div class="paused-actions">
          <button id="btn-paused-resume" class="btn btn-primary paused-resume-btn">▶ Продолжить генерацию</button>
        </div>
        <div class="paused-links">
          ${s.doneCount > 0 ? '<a id="link-paused-selection" class="paused-link">Перейти к отбору</a><span class="paused-link-sep">·</span>' : ''}
          <a id="link-paused-settings" class="paused-link">К настройкам</a>
        </div>
      </div>
    </div>
  `;

  // ── Resume: restart generation from paused state ──
  heroEl.querySelector('#btn-paused-resume')?.addEventListener('click', async () => {
    // Check connection before resuming
    const connStatus = state.connectionStatus;
    const READY_STATUSES = ['ready', 'page_not_ready'];
    if (!connStatus || !READY_STATUSES.includes(connStatus)) {
      const { showToast } = await import('../app.js');
      showToast('Chrome не готов. Проверьте подключение.', 4000);
      return;
    }
    // Reset paused state and re-trigger generation
    uiPhase = 'generating';
    lastRunSnapshot = null;
    lastPct = 0;
    activeRunProjectId = state.currentProject ? state.currentProject.id : null;
    activeRunProjectName = state.currentProject ? state.currentProject.name : '';
    activeRunSetName = ''; // We could look it up, but it'll update on session_start
    lastState = {
      pct: 0, primary: 'Генерация изображений', detail: 'Возобновление…',
      detailColor: '', logEntries: [], liveTiles: [],
      agedCounts: { done: 0, failed: 0 }, agedSlots: new Map(),
      promptCur: 0, promptTotal: 0, savedSlotsPerPrompt: {},
      sessionMode: null, sessionSummary: null,
    };
    state.generationRequested = true;
    // Re-mount the screen to trigger new generation
    const { navigate } = await import('../app.js');
    navigate('progress');
  });

  heroEl.querySelector('#link-paused-selection')?.addEventListener('click', () => navigate('selection'));
  heroEl.querySelector('#link-paused-settings')?.addEventListener('click', () => navigate('settings'));
}

// ── Cancelled terminal state: shown inline on Progress screen (keeps gallery visible) ──
// Called either by the 20s watchdog OR by status:'complete' while uiPhase==='cancelling'
function _showCancelledFinalState() {
  _clearCancelWatchdog();
  isRunning = false;
  uiPhase = 'cancelled';

  if (!container) return;
  const heroEl = container.querySelector('.progress-hero');
  if (!heroEl) return;

  const savedCount  = lastState.agedCounts.done   + lastState.liveTiles.filter(t => t.status !== 'failed').length;
  const failedCount = lastState.agedCounts.failed + lastState.liveTiles.filter(t => t.status === 'failed').length;

  const statParts = [];
  if (savedCount  > 0) statParts.push(`<strong>${savedCount}</strong> сохранено`);
  if (failedCount > 0) statParts.push(`<span style="color:var(--red)"><strong>${failedCount}</strong> ошибок</span>`);

  // Build snapshot so any subsequent navigation has accurate data
  lastRunSnapshot = {
    promptTotal:  lastState.promptTotal,
    doneCount:    savedCount,
    failedCount:  failedCount,
    status:       'complete',
    isStopped:    false,
    recentLogs:   lastState.logEntries.slice(0, 5),
    recentTiles:  lastState.liveTiles.slice(-8).map(t => ({
      key: t.key, status: t.status, url: t.url,
      promptIdx: t.promptIdx, slotIdx: t.slotIdx, isBackfill: t.isBackfill,
    })),
  };

  heroEl.className = 'progress-hero progress-paused';
  heroEl.innerHTML = `
    <div class="paused-layout">
      <div class="paused-icon">✕</div>
      <div class="paused-body">
        <div class="paused-title" style="color:var(--red)">Генерация отменена</div>
        ${statParts.length > 0
          ? `<div class="paused-stats">${statParts.join(' · ')}</div>`
          : `<div class="paused-stats" style="color:var(--text-tertiary)">Изображения не были сохранены</div>`
        }
        <div class="paused-links" style="margin-top:12px">
          ${savedCount > 0 ? `<a id="link-cancelled-selection" class="paused-link">Перейти к отбору</a><span class="paused-link-sep">·</span>` : ''}
          <a id="link-cancelled-settings" class="paused-link">В настройки</a>
        </div>
      </div>
    </div>
  `;

  heroEl.querySelector('#link-cancelled-selection')?.addEventListener('click', () => navigate('selection'));
  heroEl.querySelector('#link-cancelled-settings')?.addEventListener('click', () => navigate('settings'));
}

function showIdleState() {
  if (!container) return;
  const heroEl = container.querySelector('.progress-hero');
  if (!heroEl) return;

  if (lastRunSnapshot) {
    const s = lastRunSnapshot;

    // Status-dependent title, icon, tone
    let statusIcon, statusTitle, statusColor;
    if (s.status === 'auth_error') {
      statusIcon = '🔒';
      statusTitle = 'Ошибка авторизации';
      statusColor = 'var(--red)';
    } else if (s.status === 'fatal_error') {
      statusIcon = '❌';
      statusTitle = 'Генерация прервана ошибкой';
      statusColor = 'var(--red)';
    } else if (s.isStopped) {
      statusIcon = '⏹️';
      statusTitle = 'Генерация остановлена';
      statusColor = 'var(--orange)';
    } else {
      statusIcon = s.failedCount > 0 ? '⚠️' : '✅';
      statusTitle = 'Генерация завершена';
      statusColor = s.failedCount > 0 ? 'var(--orange)' : 'var(--green)';
    }

    // Summary stats
    const parts = [];
    if (s.promptTotal > 0) parts.push(`${s.promptTotal} промптов`);
    if (s.doneCount > 0) parts.push(`${s.doneCount} сохранено`);
    if (s.failedCount > 0) parts.push(`<span style="color:var(--red)">${s.failedCount} ошибок</span>`);

    // Recent logs
    const logsHtml = (s.recentLogs && s.recentLogs.length > 0)
      ? `<div style="margin-top:8px;text-align:left;max-width:400px;width:100%">
           ${s.recentLogs.map(l => `<div style="font-size:11px;color:var(--text-tertiary);line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.message}</div>`).join('')}
         </div>`
      : '';

    heroEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:24px;text-align:center">
        <div style="font-size:28px">${statusIcon}</div>
        <div style="font-size:15px;font-weight:700;color:${statusColor}">${statusTitle}</div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.6">
          ${parts.join(' · ')}
        </div>
        ${logsHtml}
        <div style="display:flex;gap:8px;margin-top:4px">
          ${s.doneCount > 0 ? `<button class="btn btn-primary" style="font-size:12px;padding:6px 16px" id="btn-idle-selection">Перейти к отбору</button>` : ''}
          <button class="btn btn-secondary" style="font-size:12px;padding:6px 16px" id="btn-idle-settings">В настройки</button>
        </div>
      </div>`;
    container.querySelector('#btn-idle-settings')?.addEventListener('click', () => navigate('settings'));
    container.querySelector('#btn-idle-selection')?.addEventListener('click', () => navigate('selection'));

    // Update log panel with last-run entries
    const logList = container.querySelector('#log-list');
    const logCount = container.querySelector('#log-count');
    if (logList && s.recentLogs) {
      s.recentLogs.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.textContent = entry.message;
        logList.appendChild(div);
      });
    }
    if (logCount) logCount.textContent = `${s.promptTotal} / ${s.promptTotal}`;

    // Restore bounded recent tiles into live grid
    const grid = document.getElementById('live-grid');
    if (grid && s.recentTiles && s.recentTiles.length > 0) {
      s.recentTiles.forEach(t => {
        const tile = document.createElement('div');
        tile.className = 'live-tile';
        tile.dataset.key = t.key;
        tile.style.cssText = `position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg-float);${t.status === 'failed' ? 'border:1px solid rgba(255,59,48,0.2);' : ''}`;
        tile.innerHTML = _buildTileHTML(t);
        grid.appendChild(tile);
      });
    }
    return;
  }

  heroEl.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:40px;text-align:center">
      <div style="font-size:36px;opacity:0.5">⏸</div>
      <div style="font-size:16px;font-weight:700;color:var(--text-secondary)">Нет активной генерации</div>
      <div style="font-size:13px;color:var(--text-tertiary);line-height:1.6">Перейдите в Настройки и нажмите<br>«Запустить генерацию»</div>
      <button class="btn btn-secondary" style="margin-top:8px;font-size:12px;padding:6px 16px" id="btn-idle-settings">← Перейти в настройки</button>
    </div>`;
  container.querySelector('#btn-idle-settings')?.addEventListener('click', () => navigate('settings'));
}

export default {
  id: 'progress',
  async mount(c) {
    container = c;

    // If a new generation is requested, reset all previous-run context BEFORE first render
    if (state.generationRequested && !isRunning) {
      lastRunSnapshot = null;
      lastPct = 0;
      uiPhase = 'generating';
      activeRunProjectId = state.currentProject ? state.currentProject.id : null;
      activeRunProjectName = state.currentProject ? state.currentProject.name : '';
      activeRunSetName = '';
      lastState = {
        pct: 0,
        primary: 'Генерация изображений',
        detail: 'Ожидание запуска…',
        detailColor: '',
        logEntries: [],
        liveTiles: [],
        agedCounts: { done: 0, failed: 0 },
        agedSlots: new Map(),
        promptCur: 0,
        promptTotal: 0,
        savedSlotsPerPrompt: {},
        sessionMode: null,
        sessionSummary: null,
      };
    }

    if (isRunning && !activeRunProjectId) {
      activeRunProjectId = state.currentProject?.id;
      activeRunProjectName = state.currentProject?.name;
    }

    render();
    cleanupProgress = api.generate.onProgress(updateProgress);

    // Sync disk images for active live tiles (Phase 1)
    if (isRunning && activeRunProjectId) {
      const activePromptIndices = [...new Set(lastState.liveTiles.map(t => t.promptIdx).filter(Boolean))];
      activePromptIndices.forEach(pIdx => {
        syncDiskImages(pIdx);
      });
      // Always sync current prompt too, just in case
      if (lastState.promptCur && !activePromptIndices.includes(lastState.promptCur)) {
        syncDiskImages(lastState.promptCur);
      }
    }

    // Guard: don't start a new generation if one is already running
    if (isRunning) return;

    // Guard: only start generation if explicitly requested (via settings launch button)
    if (!state.generationRequested) {
      // Show idle state — user opened progress tab without launching
      showIdleState();
      return;
    }

    // Consume the flag so re-mounting doesn't re-trigger
    state.generationRequested = false;

    const project = state.currentProject;
    if (project) {
      const projs = await api.projects.loadPrompts(project.id);
      const allPrompts = projs?.prompts || [];
      const cfg = await api.config.getAll() || {};

      // ── Selective run: filter prompts if user selected a subset ──
      const sel = state.selectedPromptIndices; // null = all, Array<number> = 0-based indices
      const prompts = sel
        ? allPrompts.filter((_, i) => sel.includes(i))
        : allPrompts;
      // Consume selection flag so re-mount doesn't re-apply stale filter
      state.selectedPromptIndices = null;

      if (prompts.length > 0) {
        isRunning = true;

        // Legacy parity: resolve settings against model capabilities before starting
        const rawSettings = {
          model: cfg.selectedModel || 'nano_banana_pro',
          quality: cfg.selectedQuality || cfg.quality || '2K',
          aspect: cfg.selectedRatio || cfg.aspect || '1:1',
          imagesPerPrompt: cfg.lastImagesPerPrompt || cfg.imagesCount || 4,
        };

        const resolved = await api.models.resolveSettings(rawSettings);
        if (resolved.blocked) {
          isRunning = false;
          showError(resolved.blockReason || 'Модель недоступна для Unlimited');
          return;
        }

        // Log warnings (auto-corrections)
        if (resolved.warnings?.length > 0) {
          resolved.warnings.forEach(w => console.log(`[progress] ⚠️ ${w.message}`));
        }

        const eff = resolved.effective;
        const result = await api.generate.start(prompts, {
          model: eff.model,
          aspect: eff.aspect,
          quality: eff.quality,
          imagesCount: eff.imagesPerPrompt,
        }, project.id);

        // Handle immediate error from generate:start
        if (result && result.success === false) {
          isRunning = false;
          showError(result.error || 'Не удалось запустить генерацию');
        }
      }
    }
  },
  unmount() {
    if (cleanupProgress) cleanupProgress();
    cleanupProgress = null;
    _clearCancelWatchdog(); // disarm watchdog when user navigates away
    // DOM is discarded on unmount — state in lastState.liveTiles is the source of truth
    // On next mount, render() rebuilds grid atomically from state (no detach/reattach needed)
    container = null;
    // Note: isRunning is intentionally NOT reset here
    // so re-mounting won't restart a generation that's still going
  },
};

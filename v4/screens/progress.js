/* ── Progress Screen ── */
import { api, navigate, state } from '../app.js';

const MAX_VISIBLE_TILES = 16;  // DOM cap: only most recent N tile nodes mounted
const MAX_STATE_WITH_PREVIEW = 24; // state cap: beyond this, strip data URLs from old tiles

let container = null;
let cleanupProgress = null;
let isRunning = false;
let lastPct = 0;       // monotonic: bar never goes backwards
let isStopping = false; // immediate stop feedback
let lastRunSnapshot = null; // {promptTotal, agedCounts, liveTileCount, primary, detail} — post-run context

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
let lastState = {
  pct: 0,
  primary: 'Генерация изображений',
  detail: 'Ожидание запуска…',
  detailColor: '',
  logEntries: [],      // [{message, step, mode}]
  liveTiles: [],       // [{key, html, promptIdx}] — recent tiles with full html
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

function render() {
  // Only reset progress counters if NOT resuming an active generation
  if (!isRunning && !lastRunSnapshot) {
    lastPct = 0;
    isStopping = false;
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
        <div class="progress-hero">
          <div id="ph-percent" class="ph-percent">${pct}%</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px">
              <div id="ph-primary" style="font-size:14px;font-weight:700">${primary}</div>
              ${lastState.sessionMode && lastState.sessionMode !== 'normal' ? `<span id="session-mode-badge" class="session-mode-badge session-mode-badge--${lastState.sessionMode}">${lastState.sessionMode === 'mixed' ? 'Новые + дозаполнение' : '✓ всё готово'}</span>` : ''}
            </div>
            <div id="ph-detail" style="font-size:12px;color:${detailColor || 'var(--text-tertiary)'};margin-top:2px">${detail}</div>
            <div class="progress-bar-track"><div id="ph-bar" class="progress-bar-fill" style="width:${pct}%"></div></div>
            <div id="hero-session-chips" class="hero-session-chips"></div>
          </div>
          <div>
            <button id="btn-stop" class="btn btn-secondary" style="font-size:11px;padding:6px 12px;color:var(--red)" ${isStopping ? 'disabled' : ''}>${isStopping ? 'Останавливаю\u2026' : '⏸ Приостановить'}</button>
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

  // Restore log entries on remount
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

  // Restore live tiles on remount (only most recent MAX_VISIBLE_TILES)
  if (isRunning && lastState.liveTiles.length > 0) {
    const grid = document.getElementById('live-grid');
    if (grid) {
      const startIdx = Math.max(0, lastState.liveTiles.length - MAX_VISIBLE_TILES);
      for (let i = startIdx; i < lastState.liveTiles.length; i++) {
        const tile = lastState.liveTiles[i];
        const el = document.createElement('div');
        el.className = 'live-tile';
        el.dataset.key = tile.key;
        el.style.cssText = `position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg-float);`;
        el.innerHTML = tile.html;
        grid.appendChild(el);
      }
    }
  }

  // Update summary row
  updateSummaryRow();

  // Restore hero session chips on remount
  _renderHeroSessionChips();

  container.querySelector('#btn-stop')?.addEventListener('click', async () => {
    isStopping = true;
    // Immediate visual feedback
    const btn = container?.querySelector('#btn-stop');
    if (btn) {
      btn.textContent = 'Останавливаю…';
      btn.disabled = true;
      btn.style.opacity = '0.6';
    }
    const detailEl = document.getElementById('ph-detail');
    if (detailEl) {
      detailEl.textContent = 'Останавливаю — дождитесь завершения текущего слота…';
      detailEl.style.color = 'var(--orange)';
    }
    lastState.detail = 'Останавливаю — дождитесь завершения текущего слота…';
    lastState.detailColor = 'var(--orange)';
    await api.generate.stop();
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

// ── DOM cap: enforce maximum mounted tile count ──
function enforceDomCap() {
  const grid = document.getElementById('live-grid');
  if (!grid) return;
  const tiles = grid.querySelectorAll('.live-tile');
  if (tiles.length <= MAX_VISIBLE_TILES) return;
  const excess = tiles.length - MAX_VISIBLE_TILES;
  for (let i = 0; i < excess; i++) {
    tiles[i].remove();
  }
  updateSummaryRow();
}

// ── State cap: age out old tiles to free memory ──
function ageOutOldTiles() {
  while (lastState.liveTiles.length > MAX_STATE_WITH_PREVIEW) {
    const old = lastState.liveTiles.shift();
    // Aggregate into compact counters instead of keeping individual records
    if (old.isFailed) {
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
      const shift = old.isFailed ? slotBit + 8 : slotBit;
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
      const slotLabel = `${promptIdx}.${s}`;
      const tileHtml = `
        <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
          <span style="font-size:20px;color:var(--green)">✓</span>
          <span style="font-size:10px;color:var(--text-secondary);font-weight:600">Сохранено</span>
        </div>
        <span style="position:absolute;bottom:6px;left:6px;font-size:10px;font-weight:700;background:rgba(0,0,0,0.6);color:#fff;padding:2px 6px;border-radius:4px;">${slotLabel}</span>
        <span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);"></span>
      `;
      lastState.liveTiles.push({ key, html: tileHtml, promptIdx });
      ageOutOldTiles();

      // Also add to DOM if mounted
      if (container) {
        const grid = document.getElementById('live-grid');
        if (grid && !grid.querySelector(`[data-key="${key}"]`)) {
          const tile = document.createElement('div');
          tile.className = 'live-tile';
          tile.dataset.key = key;
          tile.dataset.saved = 'true';
          tile.style.cssText = 'position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg-float);animation: liveTileFadeIn 0.35s ease;';
          tile.innerHTML = tileHtml;
          grid.appendChild(tile);
          enforceDomCap();
        }
      }
    }
  }
}

function updateProgress(data) {
  // ── Terminal states ──
  if (data.status === 'complete' || data.status === 'fatal_error' || data.status === 'auth_error') {
    isRunning = false;
  }

  // ── Terminal states ──
  if (data.status === 'complete' || data.status === 'fatal_error' || data.status === 'auth_error') {
    // ── FIX: Force completion state into persistent model BEFORE DOM check ──
    if (data.status === 'complete' && !isStopping) {
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
    } else if (data.status === 'complete' && isStopping) {
      lastState.primary = 'Приостановлено';
      lastState.detail = 'Генерация приостановлена. Сохранённые изображения доступны.';
      lastState.detailColor = 'var(--orange)';
    }

    // ── Snapshot AFTER reconciliation — accurate final counts ──
    const liveDone = lastState.liveTiles.filter(t => !t.isFailed).length;
    const liveFailed = lastState.liveTiles.filter(t => t.isFailed).length;
    lastRunSnapshot = {
      promptTotal: lastState.promptTotal,
      doneCount: lastState.agedCounts.done + liveDone,
      failedCount: lastState.agedCounts.failed + liveFailed,
      status: data.status,
      isStopped: isStopping,
      recentLogs: lastState.logEntries.slice(0, 5),
      recentTiles: lastState.liveTiles.slice(-8).map(t => ({ key: t.key, html: t.html, isFailed: t.isFailed })),
    };

    if (!container) return;

    if (data.status === 'complete') {
      const pctEl = document.getElementById('ph-percent');
      const primary = document.getElementById('ph-primary');
      const detail = document.getElementById('ph-detail');
      const bar = document.getElementById('ph-bar');
      if (isStopping) {
        // ── Paused: stay on Progress, show paused state in hero ──
        showPausedState();
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
    const primaryText = isStopping ? lastState.primary : `Промпт ${promptCur} из ${promptTotal}`;
    const detailText = isStopping ? lastState.detail : formatTime(data.message || `Промпт ${promptCur} / ${promptTotal}`);
    const detailCol = isStopping ? lastState.detailColor : '';
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
    const key = `p${data.promptIndex || promptCur}-s${data.slotIndex || data.savedSlot}`;
    const existingTile = lastState.liveTiles.find(t => t.key === key);
    const slotLabel = `${data.promptIndex || promptCur}.${data.slotIndex || data.savedSlot}`;

    if (data.previewDataUrl && existingTile) {
      // Upgrade persisted placeholder with real preview
      existingTile.html = `
        <img src="${data.previewDataUrl}" style="width:100%;height:100%;object-fit:cover;display:block" />
        <span style="position:absolute;bottom:6px;left:6px;font-size:10px;font-weight:700;background:rgba(0,0,0,0.6);color:#fff;padding:2px 6px;border-radius:4px;backdrop-filter:blur(4px);">${slotLabel}</span>
        <span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);"></span>
      `;
    } else if (!existingTile) {
      // New tile
      const tileHtml = data.previewDataUrl
        ? `
          <img src="${data.previewDataUrl}" style="width:100%;height:100%;object-fit:cover;display:block" />
          <span style="position:absolute;bottom:6px;left:6px;font-size:10px;font-weight:700;background:rgba(0,0,0,0.6);color:#fff;padding:2px 6px;border-radius:4px;backdrop-filter:blur(4px);">${slotLabel}</span>
          <span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);"></span>
        `
        : `
          <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
            <span style="font-size:20px;color:var(--green)">✓</span>
            <span style="font-size:10px;color:var(--text-secondary);font-weight:600">Сохранено</span>
          </div>
          <span style="position:absolute;bottom:6px;left:6px;font-size:10px;font-weight:700;background:rgba(0,0,0,0.6);color:#fff;padding:2px 6px;border-radius:4px;">${slotLabel}</span>
          <span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);"></span>
        `;
      lastState.liveTiles.push({ key, html: tileHtml, promptIdx: data.promptIndex || promptCur });
      ageOutOldTiles();
    }
  }

  // Persist failed tile state (always)
  if (data.step === 'slot_failed') {
    const key = `p${promptCur}-s${data.failedSlot}-fail`;
    if (!lastState.liveTiles.find(t => t.key === key)) {
      const tileHtml = `
        <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
          <span style="font-size:20px;opacity:0.5">✕</span>
          <span style="font-size:10px;color:var(--red);font-weight:600">Слот ${data.failedSlot}</span>
          <span style="font-size:9px;color:var(--text-tertiary)">${data.failedReason || 'ошибка'}</span>
        </div>
        <span style="position:absolute;bottom:6px;left:6px;font-size:10px;font-weight:700;background:rgba(0,0,0,0.6);color:var(--red);padding:2px 6px;border-radius:4px;">${promptCur}.${data.failedSlot}</span>
        <span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--red);box-shadow:0 0 6px var(--red);"></span>
      `;
      lastState.liveTiles.push({ key, html: tileHtml, isFailed: true, promptIdx: promptCur });
      ageOutOldTiles();
    }
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

  if (primaryEl && !isStopping) primaryEl.textContent = lastState.primary;
  if (detailEl && !isStopping) {
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

  // ── Live tile DOM (sync with persisted state) ──
  if (data.step === 'saved') {
    const grid = document.getElementById('live-grid');
    if (grid) {
      const key = `p${data.promptIndex || promptCur}-s${data.slotIndex || data.savedSlot}`;
      const existing = grid.querySelector(`[data-key="${key}"]`);
      const tileData = lastState.liveTiles.find(t => t.key === key);

      if (existing && data.previewDataUrl) {
        // Upgrade DOM tile
        existing.innerHTML = tileData?.html || existing.innerHTML;
      } else if (!existing && tileData) {
        // Create DOM tile from persisted state
        const tile = document.createElement('div');
        tile.className = 'live-tile';
        tile.dataset.key = key;
        tile.dataset.saved = 'true';
        tile.style.cssText = `position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg-float);animation: liveTileFadeIn 0.35s ease;`;
        tile.innerHTML = tileData.html;
        grid.appendChild(tile);
        enforceDomCap();
      }
    }
  }

  // ── Failed slot tile DOM ──
  if (data.step === 'slot_failed') {
    const grid = document.getElementById('live-grid');
    if (grid) {
      const key = `p${promptCur}-s${data.failedSlot}-fail`;
      if (!grid.querySelector(`[data-key="${key}"]`)) {
        const tileData = lastState.liveTiles.find(t => t.key === key);
        if (tileData) {
          const tile = document.createElement('div');
          tile.className = 'live-tile';
          tile.dataset.key = key;
          tile.style.cssText = `position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg-float);border:1px solid rgba(255,59,48,0.2);animation: liveTileFadeIn 0.35s ease;`;
          tile.innerHTML = tileData.html;
          grid.appendChild(tile);
          enforceDomCap();
        }
      }
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
          <a id="link-paused-settings" class="paused-link">Новая генерация</a>
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
    isStopping = false;
    lastRunSnapshot = null;
    lastPct = 0;
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
          <button class="btn btn-secondary" style="font-size:12px;padding:6px 16px" id="btn-idle-settings">Новая генерация</button>
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
        tile.style.cssText = `position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg-float);${t.isFailed ? 'border:1px solid rgba(255,59,48,0.2);' : ''}`;
        tile.innerHTML = t.html;
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
      isStopping = false;
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

    render();
    cleanupProgress = api.generate.onProgress(updateProgress);

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
      const prompts = projs?.prompts || [];
      const cfg = await api.config.getAll() || {};

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
    container = null;
    // Note: isRunning is intentionally NOT reset here
    // so re-mounting won't restart a generation that's still going
  },
};

/* ── Progress Screen ── */
import { api, navigate, state } from '../app.js';

let container = null;
let cleanupProgress = null;
let isRunning = false;
let lastPct = 0;       // monotonic: bar never goes backwards
let isStopping = false; // immediate stop feedback

// Persistent state across remounts (survives unmount/mount cycle)
let lastState = {
  pct: 0,
  primary: 'Генерация изображений',
  detail: 'Ожидание запуска…',
  detailColor: '',
  logEntries: [],      // [{message}]
  liveTiles: [],       // [{key, html}]
  promptCur: 0,
  promptTotal: 0,
};

function render() {
  // Only reset progress counters if NOT resuming an active generation
  if (!isRunning) {
    lastPct = 0;
    isStopping = false;
    lastState = {
      pct: 0,
      primary: 'Генерация изображений',
      detail: 'Ожидание запуска…',
      detailColor: '',
      logEntries: [],
      liveTiles: [],
      promptCur: 0,
      promptTotal: 0,
    };
  }

  const pct = isRunning ? lastState.pct : 0;
  const primary = isRunning ? lastState.primary : 'Генерация изображений';
  const detail = isRunning ? lastState.detail : 'Ожидание запуска…';
  const detailColor = isRunning ? lastState.detailColor : '';
  const logCount = isRunning ? `${lastState.promptCur} / ${lastState.promptTotal}` : '0 / 0';

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 280px;overflow:hidden;flex:1">
      <div style="display:flex;flex-direction:column;overflow:hidden;padding:16px;gap:12px">
        <!-- Progress hero -->
        <div class="progress-hero">
          <div id="ph-percent" class="ph-percent">${pct}%</div>
          <div style="flex:1">
            <div id="ph-primary" style="font-size:14px;font-weight:700">${primary}</div>
            <div id="ph-detail" style="font-size:12px;color:${detailColor || 'var(--text-tertiary)'};margin-top:2px">${detail}</div>
            <div class="progress-bar-track"><div id="ph-bar" class="progress-bar-fill" style="width:${pct}%"></div></div>
          </div>
          <div>
            <button id="btn-stop" class="btn btn-secondary" style="font-size:11px;padding:6px 12px;color:var(--red)" ${isStopping ? 'disabled' : ''}>${isStopping ? 'Останавливаю…' : 'Остановить'}</button>
          </div>
        </div>
        <!-- Live grid -->
        <div id="live-grid" class="live-grid"></div>
      </div>
      <!-- Log panel -->
      <div class="log-panel">
        <div class="log-header">
          <span class="log-title">Лог генерации</span>
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
        el.innerHTML = `<span class="log-dot"></span><span style="color:var(--text-secondary);flex:1">${entry.message}</span>`;
        logList.appendChild(el);
      });
    }
  }

  // Restore live tiles on remount
  if (isRunning && lastState.liveTiles.length > 0) {
    const grid = document.getElementById('live-grid');
    if (grid) {
      lastState.liveTiles.forEach(tile => {
        const el = document.createElement('div');
        el.className = 'live-tile';
        el.dataset.key = tile.key;
        el.style.cssText = `position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg-float);`;
        el.innerHTML = tile.html;
        grid.appendChild(el);
      });
    }
  }

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

function updateProgress(data) {
  // Always reset isRunning on terminal states, even if container is unmounted
  if (data.status === 'complete' || data.status === 'fatal_error' || data.status === 'auth_error') {
    isRunning = false;
  }

  if (!container) return;

  // ── Terminal: complete ──
  if (data.status === 'complete') {
    isRunning = false;
    const pctEl = document.getElementById('ph-percent');
    const primary = document.getElementById('ph-primary');
    const detail = document.getElementById('ph-detail');
    const bar = document.getElementById('ph-bar');
    if (isStopping) {
      // Stopped: keep actual progress, don't jump to 100%
      if (primary) primary.textContent = 'Остановлено';
      if (detail) {
        detail.textContent = 'Генерация остановлена. Сохранённые изображения доступны для отбора.';
        detail.style.color = 'var(--orange)';
      }
    } else {
      // Normal completion
      if (pctEl) pctEl.textContent = '100%';
      if (primary) primary.textContent = 'Генерация завершена';
      if (detail) {
        detail.textContent = 'Переход к отбору…';
        detail.style.color = 'var(--green)';
      }
      if (bar) bar.style.width = '100%';
    }
    setTimeout(() => navigate('selection'), isStopping ? 2500 : 1500);
    return;
  }

  // ── Terminal: fatal/auth error ──
  if (data.status === 'fatal_error' || data.status === 'auth_error') {
    isRunning = false;
    showError(data.message);
    return;
  }

  // ── Calculate combined progress ──
  const promptCur = data.promptCurrent || 1;
  const promptTotal = data.promptTotal || 1;
  const ipp = data.imagesPerPrompt || 4;
  const slotCur = data.current || 0;

  let combinedPct = 0;
  const basePromptPct = ((promptCur - 1) / promptTotal) * 100;
  const perPromptPct = 100 / promptTotal;

  if (data.step === 'saved') {
    const savedSlot = data.savedSlot || slotCur;
    combinedPct = basePromptPct + (savedSlot / ipp) * perPromptPct;
  } else if (data.step === 'done') {
    combinedPct = (promptCur / promptTotal) * 100;
  } else if (data.step === 'generate' || data.step === 'downloading' || data.step === 'waiting') {
    const slotIdx = slotCur || 1;
    combinedPct = basePromptPct + ((slotIdx - 1) / ipp) * perPromptPct;
  } else {
    combinedPct = basePromptPct;
  }

  // Monotonic: never go backwards
  const pct = Math.max(Math.round(combinedPct), lastPct);
  lastPct = pct;

  // ── Update UI ──
  const pctEl = document.getElementById('ph-percent');
  const primaryEl = document.getElementById('ph-primary');
  const detailEl = document.getElementById('ph-detail');
  const barEl = document.getElementById('ph-bar');
  const countEl = document.getElementById('log-count');

  if (pctEl) pctEl.textContent = pct + '%';
  if (barEl) barEl.style.width = pct + '%';
  if (countEl) countEl.textContent = `${promptCur} / ${promptTotal}`;

  const primaryText = isStopping ? lastState.primary : `Промпт ${promptCur} из ${promptTotal}`;
  const detailText = isStopping ? lastState.detail : (data.message || `Промпт ${promptCur} / ${promptTotal}`);
  const detailCol = isStopping ? lastState.detailColor : '';

  if (primaryEl && !isStopping) primaryEl.textContent = primaryText;
  if (detailEl && !isStopping) {
    detailEl.textContent = detailText;
    detailEl.style.color = detailCol;
  }

  // Persist state for remount
  lastState.pct = pct;
  lastState.primary = primaryText;
  lastState.detail = detailText;
  lastState.detailColor = detailCol;
  lastState.promptCur = promptCur;
  lastState.promptTotal = promptTotal;

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
    // Persist log (keep last 100 entries)
    lastState.logEntries.unshift({ message: data.message });
    if (lastState.logEntries.length > 100) lastState.logEntries.length = 100;
  }

  // ── Live preview tile ──
  if (data.step === 'saved' && data.previewDataUrl) {
    const grid = document.getElementById('live-grid');
    if (grid) {
      const key = `p${data.promptIndex || promptCur}-s${data.slotIndex || data.savedSlot}`;
      if (!grid.querySelector(`[data-key="${key}"]`)) {
        const tileHtml = `
          <img src="${data.previewDataUrl}" style="width:100%;height:100%;object-fit:cover;display:block" />
          <span style="position:absolute;bottom:6px;left:6px;font-size:10px;font-weight:700;background:rgba(0,0,0,0.6);color:#fff;padding:2px 6px;border-radius:4px;backdrop-filter:blur(4px);">${data.promptIndex || promptCur}.${data.slotIndex || data.savedSlot}</span>
          <span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);"></span>
        `;
        const tile = document.createElement('div');
        tile.className = 'live-tile';
        tile.dataset.key = key;
        tile.style.cssText = `position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:var(--bg-float);animation: liveTileFadeIn 0.35s ease;`;
        tile.innerHTML = tileHtml;
        grid.appendChild(tile);
        // Persist tile for remount
        lastState.liveTiles.push({ key, html: tileHtml });
      }
    }
  }
}

export default {
  id: 'progress',
  async mount(c) {
    container = c;
    render();
    cleanupProgress = api.generate.onProgress(updateProgress);

    // Guard: don't start a new generation if one is already running
    if (isRunning) return;

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

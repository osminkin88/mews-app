/* ── Selection Screen ── */
import { api, navigate, state, showToast } from '../app.js';

let container = null;
let prompts = [];
let currentIndex = 0;
let images = [];
let selections = {};
let viewingVariant = 0;
let wasBackfilled = false;
let backfillMap = {};  // {promptIndex: bool} — cached per-prompt backfill flags

async function loadPromptImages(idx) {
  const project = state.currentProject;
  if (!project) return;
  const result = await api.projects.getImages(project.id, idx);
  images = result?.images || [];
  wasBackfilled = result?.wasBackfilled || false;
  backfillMap[idx] = wasBackfilled;

  // Clamp: if saved selection points beyond available images, treat as invalid
  const savedSel = selections[idx];
  if (savedSel !== undefined && savedSel >= images.length) {
    delete selections[idx]; // stale selection from previous cycle
  }

  // viewingVariant: use valid selection or default to 0, clamped to range
  viewingVariant = selections[idx] !== undefined
    ? selections[idx]
    : Math.min(0, images.length - 1);
  if (viewingVariant < 0) viewingVariant = 0;
}

// Persist selections to state (cross-screen) and project.json (cross-restart)
function persistSelections() {
  state.selections = { ...selections };
  state.selectionCurrentPrompt = currentIndex;
  const project = state.currentProject;
  if (project) {
    api.projects.update(project.id, {
      selections: { ...selections },
      selectionCurrentPrompt: currentIndex,
    });
  }
}

// Select a variant and auto-advance to next unfinished prompt
async function selectVariant(variantIdx) {
  selections[currentIndex] = variantIdx;
  viewingVariant = variantIdx;
  persistSelections();
  render(); // Show selection state immediately

  // Auto-advance after brief delay (800ms to let user clearly see their choice)
  const nextUnfinished = findNextUnfinished(currentIndex);
  if (nextUnfinished !== null) {
    setTimeout(async () => {
      currentIndex = nextUnfinished;
      await loadPromptImages(currentIndex);
      render();
    }, 800);
  }
}

function findNextUnfinished(fromIndex) {
  // Search forward from current
  for (let i = fromIndex + 1; i < prompts.length; i++) {
    if (selections[i] === undefined) return i;
  }
  // Wrap around from beginning
  for (let i = 0; i < fromIndex; i++) {
    if (selections[i] === undefined) return i;
  }
  return null; // All done
}

function clearSelection() {
  delete selections[currentIndex];
  viewingVariant = 0;
  persistSelections();
  render();
}

// promptExpanded removed — full prompt shown via modal now
let promptModalOpen = false;
let activeModalCleanup = null; // cleanup handle for unmount safety

function render() {
  const prompt = prompts[currentIndex];
  const selected = selections[currentIndex];
  const doneCount = Object.keys(selections).length;
  const totalCount = prompts.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const allDone = doneCount >= totalCount && totalCount > 0;
  const isLast = currentIndex >= prompts.length - 1;
  const hasSelections = doneCount > 0;
  const imgCount = images.length;

  const heroSrc = images[viewingVariant]?.dataUrl || '';

  // Keyboard hint based on real image count
  const keyHint = imgCount > 1 ? `1–${imgCount} выбрать · 0 снять · ←→ навигация` : imgCount === 1 ? 'Нажмите 1 или кнопку ниже · 0 снять' : '';

  // Next/Finish button state
  let nextBtnText, nextBtnAction;
  if (allDone) {
    nextBtnText = `Завершить отбор · ${doneCount}/${totalCount}`;
    nextBtnAction = 'finish';
  } else if (isLast) {
    const nextUnfinished = findNextUnfinished(currentIndex);
    if (nextUnfinished !== null) {
      nextBtnText = `К промпту ${nextUnfinished + 1} →`;
      nextBtnAction = 'jump';
    } else {
      nextBtnText = 'Следующий →';
      nextBtnAction = 'none';
    }
  } else {
    nextBtnText = 'Следующий →';
    nextBtnAction = 'next';
  }

  // ── Build hero zone based on image count ──
  let heroZoneHTML = '';

  if (imgCount === 0) {
    // ── EMPTY STATE ──
    heroZoneHTML = `
      <div class="sel-empty-state">
        <div class="sel-empty-icon">
          <svg viewBox="0 0 24 24" width="48" height="48"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
        </div>
        <div class="sel-empty-title">Не сгенерировано</div>
        <div class="sel-empty-hint">Этот промпт ещё не был обработан.<br>Пропустите или вернитесь после генерации.</div>
      </div>`;

  } else if (imgCount === 1) {
    // ── SINGLE IMAGE: hero + explicit select button ──
    heroZoneHTML = `
      <div class="hero-image" id="hero-img">
        ${heroSrc ? `<img src="${heroSrc}" class="hero-img-el" draggable="false" />` : ''}
        <span class="hero-label">Единственный вариант${wasBackfilled ? ' <span class="backfill-badge">⟳ backfill</span>' : ''}</span>
        ${selected === 0 ? '<span class="hero-selected-badge">✓ Выбрано</span>' : ''}
      </div>
      ${selected === undefined ? `
        <button id="btn-select-single" class="btn btn-primary sel-select-single-btn">
          <svg viewBox="0 0 24 24" width="15" height="15" style="fill:none;stroke:currentColor;stroke-width:2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Выбрать этот вариант
        </button>
      ` : ''}`;

  } else if (imgCount === 2) {
    heroZoneHTML = `
      <div class="hero-image" id="hero-img">
        ${heroSrc ? `<img src="${heroSrc}" class="hero-img-el" draggable="false" />` : ''}
        <span class="hero-label">Вариант ${viewingVariant + 1} из 2${wasBackfilled ? ' <span class="backfill-badge">⟳ backfill</span>' : ''}</span>
        ${selected === viewingVariant ? '<span class="hero-selected-badge">✓ Выбрано</span>' : ''}
      </div>
      <div class="filmstrip filmstrip-duo">
        ${images.map((img, i) => {
          const src = img.dataUrl || '';
          const isViewing = i === viewingVariant;
          const isSelected = selected === i;
          const classes = ['film-thumb'];
          if (isViewing) classes.push('viewing');
          if (isSelected) classes.push('selected');
          return `<div class="${classes.join(' ')}" data-idx="${i}">
            ${src ? `<img src="${src}" class="film-thumb-img" draggable="false" />` : ''}
            <span class="film-num">${i + 1}</span>
            ${isSelected ? '<span class="film-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
          </div>`;
        }).join('')}
      </div>`;

  } else {
    // ── GALLERY: hero + compact filmstrip (3-4 images) ──
    heroZoneHTML = `
      <div class="hero-image" id="hero-img">
        ${heroSrc ? `<img src="${heroSrc}" class="hero-img-el" draggable="false" />` : ''}
        <span class="hero-label">Вариант ${viewingVariant + 1} из ${imgCount}${wasBackfilled ? ' <span class="backfill-badge">⟳ backfill</span>' : ''}</span>
        ${selected === viewingVariant ? '<span class="hero-selected-badge">✓ Выбрано</span>' : ''}
      </div>
      <div class="filmstrip">
        ${images.map((img, i) => {
          const src = img.dataUrl || '';
          const isViewing = i === viewingVariant;
          const isSelected = selected === i;
          const classes = ['film-thumb'];
          if (isViewing) classes.push('viewing');
          if (isSelected) classes.push('selected');
          return `<div class="${classes.join(' ')}" data-idx="${i}">
            ${src ? `<img src="${src}" class="film-thumb-img" draggable="false" />` : ''}
            <span class="film-num">${i + 1}</span>
            ${isSelected ? '<span class="film-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
          </div>`;
        }).join('')}
      </div>`;
  }

  // Prompt text handling: truncate for preview
  const rawPromptText = prompt?.prompt || prompt?.text || '—';
  const isLongPrompt = rawPromptText.length > 120;

  // Preserve queue scroll position before DOM rebuild
  const queueEl = container.querySelector('.decision-queue');
  const savedScrollTop = queueEl ? queueEl.scrollTop : 0;

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 280px;overflow:hidden;flex:1">
      <!-- Hero zone -->
      <div style="display:flex;flex-direction:column;overflow:hidden;padding:16px;gap:12px">
        ${heroZoneHTML}
      </div>
      <div class="decision-panel">
        <div class="decision-header">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:20px;font-weight:800;letter-spacing:-0.5px">${currentIndex + 1}</span>
            <small style="font-size:14px;color:var(--text-tertiary)">/ ${totalCount}</small>
          </div>
          <div class="decision-progress"><div class="decision-progress-fill" style="width:${pct}%"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:var(--text-tertiary)"><span>${doneCount} промпт. отобрано</span><span>${totalCount - doneCount} осталось</span></div>
        </div>
        <div class="decision-prompt">
          <div class="section-label" style="margin-bottom:4px;display:flex;align-items:center;justify-content:space-between">
            <span>Промпт #${currentIndex + 1}${wasBackfilled ? ' <span class="backfill-badge">⟳ дозаполнен</span>' : ''}</span>
            ${isLongPrompt ? `<button id="btn-prompt-read" class="prompt-toggle-btn">Читать полностью</button>` : ''}
          </div>
          <div style="position:relative">
            <div class="decision-prompt-text" style="font-size:13px;line-height:1.6;color:var(--text-secondary)">${rawPromptText}</div>
            ${isLongPrompt ? '<div class="prompt-fade-mask"></div>' : ''}
          </div>
        </div>
        <div class="decision-queue">
          <div class="section-label" style="margin-bottom:8px">Очередь</div>
          ${prompts.map((p, i) => {
            const isDone = selections[i] !== undefined;
            const isCurrent = i === currentIndex;
            const dotBg = isDone ? 'var(--green)' : isCurrent ? 'var(--accent)' : 'var(--bg-float)';
            const dotBorder = !isDone && !isCurrent ? 'border:1px solid var(--text-tertiary);' : '';
            const textColor = isCurrent ? 'var(--text-primary)' : isDone ? 'var(--text-secondary)' : 'var(--text-tertiary)';
            const numColor = isCurrent ? 'var(--accent)' : isDone ? 'var(--green)' : 'var(--text-tertiary)';
            const promptText = p.prompt || p.text || '';
            const truncated = promptText.length > 40 ? promptText.substring(0, 40) + '…' : promptText;
            const isBf = backfillMap[i] || false;
            return `<div class="queue-item ${isCurrent ? 'current' : ''}" data-prompt="${i}">
              <span class="queue-num" style="color:${numColor}">${i + 1}</span>
              <span class="queue-dot" style="background:${dotBg};${dotBorder}"></span>
              <span class="queue-text" style="color:${textColor}">${truncated}</span>
              ${isBf ? '<span class="queue-backfill-mark" title="Дозаполнен через backfill">⟳</span>' : ''}
            </div>`;
          }).join('')}
        </div>
        <div class="decision-footer">
          ${selected !== undefined
            ? `<div class="sel-clear-row">
                <span class="sel-selected-label"><span class="sel-selected-dot"></span>Выбран: Вариант ${selected + 1}</span>
                <button id="btn-clear-sel" class="sel-clear-btn" title="Снять выбор">✕ Снять</button>
              </div>`
            : imgCount > 0
              ? `<div style="font-size:12px;color:var(--text-tertiary)">${keyHint}</div>`
              : `<div style="font-size:12px;color:var(--text-tertiary)">Не сгенерировано — пропустите или вернитесь после генерации</div>`
          }
          <button id="btn-next" class="btn btn-primary" data-action="${nextBtnAction}" style="width:100%;justify-content:center">${nextBtnText}</button>
          ${!allDone && hasSelections ? `<button id="btn-finish" class="btn btn-secondary" style="width:100%;justify-content:center;font-size:12px">Завершить досрочно · ${doneCount}/${totalCount}</button>` : ''}
        </div>
      </div>
    </div>
  `;

  // ── Events ──

  // Filmstrip and duo: click to view, dblclick to toggle select
  container.querySelectorAll('.film-thumb').forEach(el => {
    el.addEventListener('click', () => {
      viewingVariant = parseInt(el.dataset.idx);
      render();
    });
    el.addEventListener('dblclick', () => {
      const idx = parseInt(el.dataset.idx);
      if (selections[currentIndex] === idx) {
        clearSelection();
      } else {
        selectVariant(idx);
      }
    });
  });

  // Clear selection button
  container.querySelector('#btn-clear-sel')?.addEventListener('click', clearSelection);

  // Full prompt modal
  container.querySelector('#btn-prompt-read')?.addEventListener('click', () => {
    openPromptModal(rawPromptText, currentIndex + 1);
  });

  // Single-image: explicit select button
  container.querySelector('#btn-select-single')?.addEventListener('click', () => {
    selectVariant(0);
  });

  // Queue: click to jump
  container.querySelectorAll('.queue-item').forEach(el => {
    el.addEventListener('click', async () => {
      currentIndex = parseInt(el.dataset.prompt);
      // navigation resets view
      await loadPromptImages(currentIndex);
      render();
    });
  });

  // Restore queue scroll position after DOM rebuild
  const newQueueEl = container.querySelector('.decision-queue');
  if (newQueueEl) {
    if (savedScrollTop > 0) {
      newQueueEl.scrollTop = savedScrollTop;
    }
    // Ensure current item is visible
    const currentItem = newQueueEl.querySelector('.queue-item.current');
    if (currentItem) {
      currentItem.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }

  // Main button: context-dependent
  container.querySelector('#btn-next')?.addEventListener('click', async () => {
    const action = container.querySelector('#btn-next')?.dataset.action;
    if (action === 'finish') {
      await doFinish();
    } else if (action === 'jump') {
      const nextUnfinished = findNextUnfinished(currentIndex);
      if (nextUnfinished !== null) {
        currentIndex = nextUnfinished;
        await loadPromptImages(currentIndex);
        render();
      }
    } else if (action === 'next') {
      if (currentIndex < prompts.length - 1) {
        currentIndex++;
        await loadPromptImages(currentIndex);
        render();
      }
    }
  });

  // Early finish button
  container.querySelector('#btn-finish')?.addEventListener('click', doFinish);

  // Hero image: always opens zoom for inspection (all image counts)
  if (imgCount >= 1) {
    const heroEl = container.querySelector('#hero-img');
    heroEl?.addEventListener('click', () => openZoom(heroSrc));
  }
}

function openZoom(src) {
  if (!src) return;
  let scale = 1;
  let panX = 0, panY = 0;
  let isDragging = false, dragStartX = 0, dragStartY = 0, startPanX = 0, startPanY = 0;

  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;cursor:default;`;

  const imgWrap = document.createElement('div');
  imgWrap.style.cssText = `position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;overflow:hidden;`;

  const img = document.createElement('img');
  img.src = src;
  img.draggable = false;
  img.style.cssText = `max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);transform-origin:center center;user-select:none;-webkit-user-select:none;will-change:transform;`;

  function applyTransform(smooth) {
    img.style.transition = smooth ? 'transform 0.2s cubic-bezier(0.25,0.1,0.25,1)' : 'none';
    // translate in screen-space THEN scale — pan feels natural at any zoom level
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    img.style.cursor = scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in';
  }

  function zoomTo(newScale, smooth = true) {
    scale = Math.max(1, Math.min(newScale, 8));
    if (scale === 1) { panX = 0; panY = 0; }
    applyTransform(smooth);
  }

  function zoomIn() { zoomTo(scale * 1.25); }
  function zoomOut() { zoomTo(scale / 1.25); }
  function resetZoom() { zoomTo(1); }

  // ── Toolbar ──
  const toolbar = document.createElement('div');
  toolbar.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:4px;background:rgba(30,30,30,0.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:4px;border-radius:10px;z-index:10000;border:1px solid rgba(255,255,255,0.1);`;

  const btnStyle = `display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:7px;border:none;background:transparent;color:rgba(255,255,255,0.8);font-size:16px;cursor:pointer;transition:background 0.12s;font-family:var(--font);`;

  const makeBtn = (text, title, fn) => {
    const b = document.createElement('button');
    b.style.cssText = btnStyle;
    b.innerHTML = text;
    b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.12)');
    b.addEventListener('mouseleave', () => b.style.background = 'transparent');
    return b;
  };

  toolbar.appendChild(makeBtn('＋', 'Увеличить (+)', zoomIn));
  toolbar.appendChild(makeBtn('−', 'Уменьшить (-)', zoomOut));
  toolbar.appendChild(makeBtn('1:1', 'Сбросить (0)', resetZoom));

  const selectBtn = makeBtn('✓', 'Выбрать этот вариант', () => { selectVariant(viewingVariant); close(); });
  selectBtn.style.color = '#30D158';
  toolbar.appendChild(selectBtn);

  toolbar.appendChild(makeBtn('✕', 'Закрыть (Esc)', () => close()));

  // ── Close ──
  const close = () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s';
    setTimeout(() => overlay.remove(), 150);
    document.removeEventListener('keydown', keyHandler);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  // ── Zoom level indicator ──
  const zoomLabel = document.createElement('span');
  zoomLabel.style.cssText = `display:flex;align-items:center;padding:0 8px;font-size:11px;color:rgba(255,255,255,0.5);font-variant-numeric:tabular-nums;min-width:36px;justify-content:center;`;
  zoomLabel.textContent = '100%';
  toolbar.insertBefore(zoomLabel, toolbar.children[3]); // before select btn

  function updateZoomLabel() {
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  // Patch zoomTo to update label
  const _origZoomTo = zoomTo;
  zoomTo = function(s, sm) { _origZoomTo(s, sm); updateZoomLabel(); };

  // ── Wheel zoom (trackpad-aware) ──
  imgWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Normalize: mouse wheel gives large deltaY (~100), trackpad gives small (~1-10)
    const rawDelta = -e.deltaY;
    const normalized = Math.sign(rawDelta) * Math.min(Math.abs(rawDelta), 100);
    const factor = Math.pow(1.005, normalized); // ~1.005^100 ≈ 1.64x per full scroll tick
    zoomTo(scale * factor);
  }, { passive: false });

  // ── Pan (drag) ──
  img.addEventListener('mousedown', (e) => {
    if (scale <= 1) return;
    e.preventDefault();
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startPanX = panX;
    startPanY = panY;
    applyTransform(false); // no transition during drag start
  });

  const onMouseMove = (e) => {
    if (!isDragging) return;
    panX = startPanX + (e.clientX - dragStartX);
    panY = startPanY + (e.clientY - dragStartY);
    applyTransform(false); // no transition during drag
  };

  const onMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
    applyTransform(false);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // ── Click image when not zoomed = zoom in ──
  img.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isDragging && scale <= 1) zoomIn();
  });

  // ── Click background = close ──
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === imgWrap) close();
  });

  // ── Keyboard ──
  const keyHandler = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === '+' || e.key === '=') zoomIn();
    if (e.key === '-') zoomOut();
    if (e.key === '0') resetZoom();
  };
  document.addEventListener('keydown', keyHandler);

  imgWrap.appendChild(img);
  overlay.appendChild(imgWrap);
  overlay.appendChild(toolbar);
  document.body.appendChild(overlay);
}

function openPromptModal(text, promptNum) {
  promptModalOpen = true;
  const overlay = document.createElement('div');
  overlay.className = 'prompt-modal-overlay';
  overlay.innerHTML = `
    <div class="prompt-modal-card">
      <div class="prompt-modal-header">
        <span class="prompt-modal-title">Промпт #${promptNum}</span>
        <button class="prompt-modal-close" title="Закрыть (Esc)">✕</button>
      </div>
      <div class="prompt-modal-body">${text}</div>
    </div>
  `;
  const close = () => {
    promptModalOpen = false;
    activeModalCleanup = null;
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s';
    setTimeout(() => overlay.remove(), 150);
    document.removeEventListener('keydown', modalKeyHandler, true);
  };
  activeModalCleanup = close;
  const modalKeyHandler = (e) => {
    // Block ALL keys from reaching selection hotkeys while modal is open
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  overlay.querySelector('.prompt-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  // Capture phase ensures this fires BEFORE the selection keydown handler
  document.addEventListener('keydown', modalKeyHandler, true);
  document.body.appendChild(overlay);
}

async function doFinish() {
  const project = state.currentProject;
  if (project && Object.keys(selections).length > 0) {
    await api.projects.saveSelection(project.id, selections);
    persistSelections();
    navigate('results');
  }
}

function handleKeyboard(e) {
  if (!container) return;
  // Block all hotkeys while prompt modal is open
  if (promptModalOpen) return;
  const maxKey = images.length;

  // Number keys: select variant
  if (e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1;
    if (idx < maxKey) {
      selectVariant(idx);
    }
  }

  // Arrow keys: navigate prompts (with wrap-around)
  if (e.key === 'ArrowRight') {
    currentIndex = currentIndex < prompts.length - 1 ? currentIndex + 1 : 0;
    // navigation resets view
    loadPromptImages(currentIndex).then(render);
  }
  if (e.key === 'ArrowLeft') {
    currentIndex = currentIndex > 0 ? currentIndex - 1 : prompts.length - 1;
    // navigation resets view
    loadPromptImages(currentIndex).then(render);
  }

  // Key 0 or Backspace: clear selection for current prompt
  if (e.key === '0' || e.key === 'Backspace') {
    if (selections[currentIndex] !== undefined) {
      clearSelection();
    }
  }

  // Enter: confirm / next / finish
  if (e.key === 'Enter') {
    const action = container.querySelector('#btn-next')?.dataset.action;
    container.querySelector('#btn-next')?.click();
  }
}

export default {
  id: 'selection',
  async mount(c) {
    container = c;
    backfillMap = {};
    wasBackfilled = false;
    const project = state.currentProject;
    let result = null;
    if (project) {
      result = await api.projects.loadPrompts(project.id);
      prompts = result?.prompts || [];
    }

    // Restore selections from state (cross-screen) or active set (cross-restart)
    if (Object.keys(state.selections).length > 0) {
      selections = { ...state.selections };
      currentIndex = state.selectionCurrentPrompt || 0;
    } else if (result?.selections && Object.keys(result.selections).length > 0) {
      // Restore from active set persisted in project.json
      selections = { ...result.selections };
      currentIndex = result.selectionCurrentPrompt || 0;
      state.selections = { ...selections };
      state.selectionCurrentPrompt = currentIndex;
    } else {
      selections = {};
      currentIndex = 0;
    }

    await loadPromptImages(currentIndex);
    render();
    document.addEventListener('keydown', handleKeyboard);
  },
  unmount() {
    persistSelections();
    // Clean up modal if still open
    if (activeModalCleanup) {
      activeModalCleanup();
    }
    document.removeEventListener('keydown', handleKeyboard);
    container = null;
  },
};

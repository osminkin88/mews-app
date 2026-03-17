/* ── Selection Screen ── */
import { api, navigate, state, showToast } from '../app.js';

let container = null;
let prompts = [];
let currentIndex = 0;
let images = [];
let selections = {};
let viewingVariant = 0;

async function loadPromptImages(idx) {
  const project = state.currentProject;
  if (!project) return;
  const result = await api.projects.getImages(project.id, idx);
  images = result?.images || [];
  viewingVariant = selections[idx] !== undefined ? selections[idx] : 0;
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

  // Auto-advance after brief delay (legacy parity: 500ms to let user see their choice)
  const nextUnfinished = findNextUnfinished(currentIndex);
  if (nextUnfinished !== null) {
    setTimeout(async () => {
      currentIndex = nextUnfinished;
      await loadPromptImages(currentIndex);
      render();
    }, 500);
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
  const heroBg = heroSrc ? `url(${heroSrc})` : 'linear-gradient(135deg, #1a2a4a, #2a4a3a)';

  // Filmstrip: show exact number of images, cap width for 1-2 image case
  const filmCols = imgCount;
  const filmMaxW = imgCount <= 2 ? `max-width:${imgCount * 120}px` : '';

  // Keyboard hint based on real image count
  const keyHint = imgCount > 1 ? `1–${imgCount} выбрать · 0 снять · ←→ навигация` : imgCount === 1 ? 'Нажмите 1 или кликните · 0 снять' : '';

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

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 280px;overflow:hidden;flex:1">
      <!-- Hero zone -->
      <div style="display:flex;flex-direction:column;overflow:hidden;padding:16px;gap:12px">
        <div class="hero-image" id="hero-img" style="background-image:${heroBg}">
          ${imgCount > 1 ? `<span class="hero-label">Вариант ${viewingVariant + 1} из ${imgCount}</span>` : ''}
          ${imgCount === 1 ? '<span class="hero-label">Единственный вариант</span>' : ''}
          ${imgCount === 0 ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);font-size:14px;font-weight:600">Не сгенерировано</div>' : ''}
        </div>
        <!-- Filmstrip -->
        ${imgCount > 1 ? `
          <div class="filmstrip" style="grid-template-columns:repeat(${filmCols}, 1fr);${filmMaxW}">
            ${images.map((img, i) => {
              const bg = img.dataUrl ? `url(${img.dataUrl})` : '';
              const isViewing = i === viewingVariant;
              const isSelected = selected === i;
              const classes = ['film-thumb'];
              if (isViewing) classes.push('viewing');
              if (isSelected) classes.push('selected');
              return `<div class="${classes.join(' ')}" data-idx="${i}" style="${bg ? `background-image:${bg}` : ''}">
                <span class="film-num">${i + 1}</span>
                ${isSelected ? '<span class="film-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
              </div>`;
            }).join('')}
          </div>
        ` : ''}
      </div>
      <!-- Decision panel -->
      <div class="decision-panel">
        <div class="decision-header">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:20px;font-weight:800;letter-spacing:-0.5px">${currentIndex + 1}</span>
            <small style="font-size:14px;color:var(--text-tertiary)">/ ${totalCount}</small>
          </div>
          <div class="decision-progress"><div class="decision-progress-fill" style="width:${pct}%"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:var(--text-tertiary)"><span>${doneCount} отобрано</span><span>${totalCount - doneCount} осталось</span></div>
        </div>
        <div class="decision-prompt">
          <div class="section-label" style="margin-bottom:4px">Промпт #${currentIndex + 1}</div>
          <div style="font-size:13px;line-height:1.6;color:var(--text-secondary)">${prompt?.prompt || prompt?.text || '—'}</div>
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
            return `<div class="queue-item ${isCurrent ? 'current' : ''}" data-prompt="${i}">
              <span class="queue-num" style="color:${numColor}">${i + 1}</span>
              <span class="queue-dot" style="background:${dotBg};${dotBorder}"></span>
              <span class="queue-text" style="color:${textColor}">${truncated}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="decision-footer">
          ${selected !== undefined
            ? `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)"><span style="width:8px;height:8px;border-radius:50%;background:var(--green)"></span>Выбран: Вариант ${selected + 1} <span style="color:var(--text-tertiary);margin-left:4px;cursor:pointer" id="btn-clear-sel" title="Снять выбор">✕</span></div>`
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

  // Filmstrip: click to view, dblclick to toggle select
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

  // Queue: click to jump
  container.querySelectorAll('.queue-item').forEach(el => {
    el.addEventListener('click', async () => {
      currentIndex = parseInt(el.dataset.prompt);
      await loadPromptImages(currentIndex);
      render();
    });
  });

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

  // Hero image: zoom overlay on click (when image exists)
  if (imgCount > 0) {
    const heroEl = container.querySelector('#hero-img');
    heroEl?.addEventListener('click', (e) => {
      // One-image case: first click = auto-select, subsequent = zoom
      if (imgCount === 1 && selected === undefined) {
        selectVariant(0);
        return;
      }
      openZoom(heroSrc);
    });
  }
}

function openZoom(src) {
  if (!src) return;
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.8);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:zoom-out;animation:zoomIn 0.2s ease;`;

  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = `max-width:90vw;max-height:85vh;object-fit:contain;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.5);cursor:pointer;`;

  const hint = document.createElement('div');
  hint.style.cssText = `font-size:12px;color:rgba(255,255,255,0.6);`;
  hint.textContent = 'Клик на изображение = выбрать · Клик на фон = закрыть · Esc = закрыть';

  const close = () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 200); document.removeEventListener('keydown', escHandler); };

  // Click on image = select variant (legacy parity: lightbox click = select)
  img.addEventListener('click', (e) => {
    e.stopPropagation();
    selectVariant(viewingVariant);
    close();
  });

  // Click on background = close
  overlay.addEventListener('click', close);

  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler);

  overlay.appendChild(img);
  overlay.appendChild(hint);
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
    loadPromptImages(currentIndex).then(render);
  }
  if (e.key === 'ArrowLeft') {
    currentIndex = currentIndex > 0 ? currentIndex - 1 : prompts.length - 1;
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
    const project = state.currentProject;
    if (project) {
      const result = await api.projects.loadPrompts(project.id);
      prompts = result?.prompts || [];
    }

    // Restore selections from state (cross-screen) or project (cross-restart)
    if (Object.keys(state.selections).length > 0) {
      selections = { ...state.selections };
      currentIndex = state.selectionCurrentPrompt || 0;
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
    document.removeEventListener('keydown', handleKeyboard);
    container = null;
  },
};

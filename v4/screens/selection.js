/* ── Selection Screen ── */
import { api, navigate, state } from '../app.js';

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

function render() {
  const prompt = prompts[currentIndex];
  const selected = selections[currentIndex];
  const doneCount = Object.keys(selections).length;
  const totalCount = prompts.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const heroSrc = images[viewingVariant]?.dataUrl || '';
  const heroBg = heroSrc ? `url(${heroSrc})` : 'linear-gradient(135deg, #1a2a4a, #2a4a3a)';
  const filmCols = Math.max(images.length, 4);

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 280px;overflow:hidden;flex:1">
      <!-- Hero zone -->
      <div style="display:flex;flex-direction:column;overflow:hidden;padding:16px;gap:12px">
        <div class="hero-image" style="background-image:${heroBg}">
          <span class="hero-label">Вариант ${viewingVariant + 1} из ${images.length || '?'}</span>
        </div>
        <!-- Filmstrip -->
        <div class="filmstrip" style="grid-template-columns:repeat(${filmCols}, 1fr)">
          ${(images.length > 0 ? images : [{},{},{},{}]).map((img, i) => {
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
            return `<div class="queue-item ${isCurrent ? 'current' : ''}" data-prompt="${i}">
              <span class="queue-num" style="color:${numColor}">${i + 1}</span>
              <span class="queue-dot" style="background:${dotBg};${dotBorder}"></span>
              <span class="queue-text" style="color:${textColor}">${(p.prompt || p.text || '').substring(0, 40)}…</span>
            </div>`;
          }).join('')}
        </div>
        <div class="decision-footer">
          ${selected !== undefined ? `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)"><span style="width:8px;height:8px;border-radius:50%;background:var(--green)"></span>Выбран: Вариант ${selected + 1}</div>` : '<div style="font-size:12px;color:var(--text-tertiary)">Нажмите 1–4 для выбора</div>'}
          <button id="btn-next" class="btn btn-primary" style="width:100%;justify-content:center">Следующий промпт →</button>
          <button id="btn-finish" class="btn btn-secondary" style="width:100%;justify-content:center;font-size:12px">Завершить · ${doneCount}/${totalCount}</button>
        </div>
      </div>
    </div>
  `;

  // ── Events ──
  container.querySelectorAll('.film-thumb').forEach(el => {
    el.addEventListener('click', () => {
      viewingVariant = parseInt(el.dataset.idx);
      render();
    });
    el.addEventListener('dblclick', () => {
      selections[currentIndex] = parseInt(el.dataset.idx);
      render();
    });
  });

  container.querySelectorAll('.queue-item').forEach(el => {
    el.addEventListener('click', async () => {
      currentIndex = parseInt(el.dataset.prompt);
      await loadPromptImages(currentIndex);
      render();
    });
  });

  container.querySelector('#btn-next')?.addEventListener('click', async () => {
    if (currentIndex < prompts.length - 1) {
      currentIndex++;
      await loadPromptImages(currentIndex);
      render();
    }
  });

  container.querySelector('#btn-finish')?.addEventListener('click', async () => {
    const project = state.currentProject;
    if (project && Object.keys(selections).length > 0) {
      await api.projects.saveSelection(project.id, selections);
      navigate('results');
    }
  });
}

function handleKeyboard(e) {
  if (!container) return;
  if (e.key >= '1' && e.key <= '4') {
    const idx = parseInt(e.key) - 1;
    if (idx < images.length) {
      selections[currentIndex] = idx;
      render();
    }
  }
  if (e.key === 'ArrowRight' && currentIndex < prompts.length - 1) {
    currentIndex++;
    loadPromptImages(currentIndex).then(render);
  }
  if (e.key === 'ArrowLeft' && currentIndex > 0) {
    currentIndex--;
    loadPromptImages(currentIndex).then(render);
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
    currentIndex = 0;
    selections = {};
    await loadPromptImages(0);
    render();
    document.addEventListener('keydown', handleKeyboard);
  },
  unmount() {
    document.removeEventListener('keydown', handleKeyboard);
    container = null;
  },
};

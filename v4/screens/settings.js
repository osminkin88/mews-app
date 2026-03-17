/* ── Settings Screen ── */
import { api, navigate, state, showToast } from '../app.js';

let container = null;

async function render() {
  const project = state.currentProject;
  const cfg = await api.config.getAll() || {};
  const prompts = project ? (await api.projects.loadPrompts(project.id))?.prompts || [] : [];
  const promptCount = prompts.length || project?.promptCount || 0;

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

  container.innerHTML = `
    <div style="overflow-y:auto;padding:16px 24px 40px;flex:1">
      <div class="settings-card">
        <div class="settings-header">
          <div style="font-size:18px;font-weight:800;letter-spacing:-0.3px">Подготовка к запуску</div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:3px">${project ? project.name : 'Выберите проект'}</div>
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
                  <div class="source-name">${project?.sourceMeta?.originalFileName || 'prompts.csv'}</div>
                  <div class="source-meta">${promptCount} промптов</div>
                </div>
                <button id="btn-replace-file" class="source-replace">Заменить</button>
              </div>
            ` : `
              <div id="drop-zone" class="drop-zone">
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div style="font-size:13px;font-weight:600">Загрузить промпты</div>
                <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">CSV или XLSX</div>
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
          <button id="btn-launch" class="btn-launch" ${promptCount === 0 ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Запустить генерацию
          </button>
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
    // file-importer.js returns { success, rows, count } — use .rows
    const importedPrompts = result.rows || result.prompts;
    if (result.success && importedPrompts && project) {
      await api.projects.savePrompts(project.id, importedPrompts, filePath);
      state.currentProject = { ...project, promptCount: importedPrompts.length, sourceMeta: { originalFileName: filePath.split('/').pop() } };
      render();
    }
  };
  dropZone?.addEventListener('click', importFile);
  replaceBtn?.addEventListener('click', importFile);

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

  container.querySelector('#btn-launch')?.addEventListener('click', async () => {
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

    // ── New cycle: clear old selection state ──
    state.selections = {};
    state.selectionCurrentPrompt = 0;
    if (project) {
      api.projects.update(project.id, {
        selections: {},
        selectionCurrentPrompt: 0,
      });
    }

    state.generationRequested = true;
    navigate('progress');
  });
}

export default {
  id: 'settings',
  async mount(c) { container = c; await render(); },
  unmount() { container = null; },
};

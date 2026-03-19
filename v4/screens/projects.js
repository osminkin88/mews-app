/* ── Projects Screen ── */
import { api, navigate, state, showToast, updateStatusbar } from '../app.js';

let container = null;
let projects = [];

const PIPELINE_STEPS = ['Промпты', 'Настройки', 'Генерация', 'Отбор', 'Результат'];

// ── Icon palette: key = emoji stored in project.json, value = SVG ──
const ICON_MAP = {
  '🎬': { svg: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>', label: 'Кино' },
  '📷': { svg: '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>', label: 'Фото' },
  '🎨': { svg: '<svg viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r="2"/><circle cx="19" cy="11.5" r="2"/><circle cx="6" cy="12.5" r="2"/><circle cx="17" cy="17.5" r="2"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.3-.3-.4-.7-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-10-10-10z"/></svg>', label: 'Арт' },
  '🌸': { svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>', label: 'Лицо' },
  '🏠': { svg: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>', label: 'Дом' },
  '⭐': { svg: '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>', label: 'Звезда' },
  '🌿': { svg: '<svg viewBox="0 0 24 24"><path d="M2 22c1.25-1.25 2.5-3.57 2.5-5.5 0-2.08.92-3.96 2.37-5.25C8.5 9.5 10.92 8.5 13.5 8.5c2.08 0 3.96.92 5.25 2.37"/><path d="M22 2s-5 2-10 7c-3 3-5 7-5 10"/></svg>', label: 'Природа' },
  '🔬': { svg: '<svg viewBox="0 0 24 24"><path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/></svg>', label: 'Наука' },
};
const ICON_KEYS = Object.keys(ICON_MAP);

function getIconSvg(emoji) {
  return ICON_MAP[emoji]?.svg || ICON_MAP['🎬'].svg;
}

function getProjectStep(p) {
  if (p.status === 'completed') return 5;
  if (p.status === 'in_progress') return 3;
  const activeSet = (p.promptSets || []).find(s => s.id === p.activePromptSetId);
  const pc = activeSet?.promptCount || p.promptCount || 0;
  if (pc > 0) return 1;
  return 0;
}

function renderPipeline(step) {
  return PIPELINE_STEPS.map((name, i) => {
    const cls = i < step ? 'done' : i === step ? 'current' : 'pending';
    return `<span class="pc-pip-step ${cls}">${i === step && step < 5 ? '● ' : ''}${name}${i < step ? ' ✓' : ''}</span>`;
  }).join('<span class="pc-pip-arrow">›</span>');
}

function renderBadge(status) {
  const map = {
    draft: ['Черновик', 'badge-draft'],
    in_progress: ['Активен', 'badge-active'],
    completed: ['Завершён', 'badge-done'],
  };
  const [text, cls] = map[status] || map.draft;
  const pulseHtml = status === 'in_progress' ? '<span class="status-pulse"></span>' : '';
  return `<span class="pc-badge ${cls}">${pulseHtml}${text}</span>`;
}

// ════════════════════════════════════════════════
// Main render
// ════════════════════════════════════════════════
async function render() {
  projects = await api.projects.list();

  container.innerHTML = `
    <div style="overflow-y:auto;padding:24px 32px 80px;flex:1">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
        <span class="section-label">Проекты</span>
        <span style="font-size:11px;color:var(--text-tertiary)">${projects.length}</span>
        <div style="flex:1"></div>
        <button id="btn-new-project" class="btn btn-primary" style="padding:6px 14px;font-size:12px">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Новый проект
        </button>
      </div>
      <div id="project-list">${projects.length === 0
        ? '<div class="empty-state">Нет проектов. Создайте первый →</div>'
        : projects.map(p => renderProjectCard(p)).join('')
      }</div>
    </div>
    <div class="ctx-menu" id="ctx-menu" style="display:none">
      <button class="ctx-item" data-action="open-folder">
        <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        Открыть папку
      </button>
      <button class="ctx-item" data-action="open-generated">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        Открыть generated
      </button>
      <button class="ctx-item" data-action="open-selected">
        <svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Открыть selected
      </button>
      <div class="ctx-divider"></div>
      <button class="ctx-item" data-action="rename">
        <svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        Переименовать
      </button>
      <button class="ctx-item" data-action="duplicate">
        <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Дублировать
      </button>
      <div class="ctx-divider"></div>
      <button class="ctx-item ctx-danger" data-action="delete" id="ctx-item-delete">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        Удалить проект
      </button>
    </div>
  `;

  bindEvents();
}

function renderProjectCard(p) {
  const date = p.createdAt ? new Date(p.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const activeSet = (p.promptSets || []).find(s => s.id === p.activePromptSetId);
  const pc = activeSet?.promptCount || p.promptCount || 0;
  const setsCount = (p.promptSets || []).length;
  
  const stats = p.stats || { generated: 0, selected: 0 };
  
  const coverHtml = p.coverUrl 
    ? `<div class="pc-cover" style="background-image: url('${p.coverUrl}')"></div>`
    : `<div class="pc-icon">${getIconSvg(p.icon)}</div>`;

  const activeSetHtml = setsCount > 1 && activeSet ? `<div class="pc-active-set">Сет: ${activeSet.name}</div>` : '';

  const primaryAction = (() => {
    if (p.status === 'draft') return { label: 'Настроить', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>', action: 'primary-settings' };
    if (p.status === 'in_progress') return { label: 'Смотреть', icon: '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>', action: 'primary-progress' };
    return { label: 'К результатам', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>', action: 'primary-results' };
  })();

  const qaHtml = `
    <div class="pc-quick-actions">
      <button class="pc-qa-btn pc-qa-icon" data-action="folder" data-id="${p.id}" title="Открыть папку">
        <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </button>
      <button class="pc-qa-btn pc-qa-icon" data-action="settings" data-id="${p.id}" title="Настройки">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="pc-qa-btn pc-qa-primary" data-action="${primaryAction.action}" data-id="${p.id}" title="${primaryAction.label}">
        ${primaryAction.icon}
        <span>${primaryAction.label}</span>
      </button>
      <div class="pc-qa-sep"></div>
      <button class="pc-more" data-id="${p.id}" title="Действия" aria-label="Действия с проектом">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
    </div>
  `;

  return `
    <div class="project-card" data-id="${p.id}">
      <div class="pc-cover-wrap">${coverHtml}</div>
      <div class="pc-info">
        <div class="pc-title" data-id="${p.id}">${p.name}</div>
        ${activeSetHtml}
        <div class="pc-stats-row">
          <span class="pc-stat" title="Промпты">📝 ${pc}</span>
          <span class="pc-stat-sep">·</span>
          <span class="pc-stat" title="Сгенерировано">🔄 ${stats.generated}</span>
          <span class="pc-stat-sep">·</span>
          <span class="pc-stat" title="Отобрано">✅ ${stats.selected}</span>
        </div>
      </div>
      <div class="pc-right">
        <div class="pc-status-wrap">
          ${renderBadge(p.status)}
          <span class="pc-date">${date}</span>
        </div>
        ${qaHtml}
      </div>
    </div>
  `;
}

// ════════════════════════════════════════════════
// Create Project Modal
// ════════════════════════════════════════════════
function showCreateModal() {
  // Overlay + modal
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" style="width:380px">
      <div class="modal-header">Новый проект</div>
      <div class="modal-body">
        <!-- Name -->
        <label class="modal-label" for="new-name">Название</label>
        <input id="new-name" type="text" class="modal-input" placeholder="Мой проект" autofocus />

        <!-- Icon picker -->
        <label class="modal-label" style="margin-top:14px">Иконка</label>
        <div class="icon-grid" id="icon-grid">
          ${ICON_KEYS.map((key, i) => `
            <button class="icon-pick ${i === 0 ? 'on' : ''}" data-icon="${key}" title="${ICON_MAP[key].label}" aria-label="${ICON_MAP[key].label}">
              ${ICON_MAP[key].svg}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button id="modal-cancel" class="btn btn-secondary">Отмена</button>
        <button id="modal-create" class="btn btn-primary">Создать</button>
      </div>
    </div>
  `;

  container.appendChild(overlay);

  // Focus the name input
  const nameInput = overlay.querySelector('#new-name');
  requestAnimationFrame(() => nameInput?.focus());

  let selectedIcon = ICON_KEYS[0]; // default: 🎬

  // Icon selection
  overlay.querySelector('#icon-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-pick');
    if (!btn) return;
    overlay.querySelectorAll('.icon-pick').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    selectedIcon = btn.dataset.icon;
  });

  // Create
  const doCreate = async () => {
    const name = nameInput.value.trim() || 'Новый проект';
    overlay.remove();
    const project = await api.projects.create(name, selectedIcon);
    if (project && project.id) {
      state.currentProject = project;
      updateStatusbar();
      navigate('settings');
    }
  };

  overlay.querySelector('#modal-create').addEventListener('click', doCreate);
  overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());

  // Keyboard: Enter = create, Escape = cancel
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doCreate();
    if (e.key === 'Escape') overlay.remove();
  });

  // Click outside = cancel
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ════════════════════════════════════════════════
// Events
// ════════════════════════════════════════════════
function bindEvents() {
  // New project → open modal instead of instant create
  container.querySelector('#btn-new-project').addEventListener('click', () => {
    showCreateModal();
  });

  // Click to open project
  container.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.pc-more')) return;
      const id = card.dataset.id;
      const project = projects.find(p => p.id === id);
      if (project) {
        state.currentProject = project;
        updateStatusbar();
        if (project.status === 'completed') navigate('results');
        else navigate('settings');
      }
    });
  });

  // ⋮ More button → context menu
  container.querySelectorAll('.pc-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showContextMenu(btn.dataset.id, btn);
    });
  });

  // Quick Actions binding
  container.querySelectorAll('.pc-qa-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const project = projects.find(p => p.id === id);
      if (!project) return;

      if (action === 'folder') {
        const res = await api.projects.getProjectPath(project.id);
        if (res?.success && res.path) {
          const ok = await api.fs.openFolder(res.path);
          if (!ok) showToast('Папка проекта не найдена');
        }
        return;
      }

      state.currentProject = project;
      updateStatusbar();
      
      if (['primary-settings', 'settings'].includes(action)) {
        navigate('settings');
      } else if (action === 'primary-progress') {
        navigate('progress');
      } else if (action === 'primary-results') {
        navigate('results');
      }
    });
  });

  // Right-click → context menu
  container.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(card.dataset.id, null, e.clientX, e.clientY);
    });
  });

  document.addEventListener('click', hideContextMenu);
}

// ════════════════════════════════════════════════
// Context menu
// ════════════════════════════════════════════════
let activeProjectId = null;

function showContextMenu(projectId, anchorEl, x, y) {
  activeProjectId = projectId;
  const menu = container.querySelector('#ctx-menu');
  if (!menu) return;

  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.right - 160}px`;
  } else if (x !== undefined) {
    menu.style.top = `${y}px`;
    menu.style.left = `${x}px`;
  }

  menu.style.display = 'block';

  // Update delete button state based on in_progress status
  const project = projects.find(p => p.id === projectId);
  const deleteBtn = menu.querySelector('#ctx-item-delete');
  if (deleteBtn && project) {
    const hasInProgress = (project.promptSets || []).some(s => s.status === 'in_progress');
    deleteBtn.disabled = hasInProgress;
    deleteBtn.title = hasInProgress ? 'Генерация активна — остановите перед удалением' : '';
    deleteBtn.style.opacity = hasInProgress ? '0.4' : '';
    deleteBtn.style.cursor = hasInProgress ? 'not-allowed' : '';
  }

  menu.querySelectorAll('.ctx-item').forEach(item => {
    const clone = item.cloneNode(true);
    item.replaceWith(clone);
    clone.addEventListener('click', (e) => {
      e.stopPropagation();
      if (clone.disabled) return;
      handleAction(clone.dataset.action, projectId);
      hideContextMenu();
    });
  });
}

function hideContextMenu() {
  const menu = container?.querySelector('#ctx-menu');
  if (menu) menu.style.display = 'none';
}

async function handleAction(action, projectId) {
  const project = projects.find(p => p.id === projectId);
  if (!project) return;

  switch (action) {
    case 'open-folder': {
      const res = await api.projects.getProjectPath(project.id);
      if (res?.success && res.path) {
        const ok = await api.fs.openFolder(res.path);
        if (!ok) showToast('Папка проекта не найдена');
      }
      break;
    }
    case 'open-generated': {
      const res = await api.projects.getProjectPath(project.id);
      if (res?.success && res.path) {
        const ok = await api.fs.openFolder(res.path + '/generated');
        if (!ok) showToast('Папка generated/ ещё не создана');
      }
      break;
    }
    case 'open-selected': {
      const res = await api.projects.getProjectPath(project.id);
      if (res?.success && res.path) {
        const ok = await api.fs.openFolder(res.path + '/selected');
        if (!ok) showToast('Папка selected/ ещё не создана');
      }
      break;
    }
    case 'rename': {
      const titleEl = container.querySelector(`.pc-title[data-id="${projectId}"]`);
      if (!titleEl) return;

      const currentName = project.name;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentName;
      input.style.cssText = 'font-size:13px;font-weight:700;background:var(--bg);border:1px solid var(--accent);border-radius:6px;padding:4px 8px;color:var(--text-primary);outline:none;width:200px;';

      titleEl.replaceWith(input);
      input.focus();
      input.select();

      const commitRename = async () => {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
          await api.projects.update(projectId, { name: newName });
        }
        render();
      };

      input.addEventListener('blur', commitRename);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = currentName; input.blur(); }
      });
      break;
    }

    case 'duplicate': {
      const newProject = await api.projects.create(project.name + ' (копия)', project.icon || '🎬');
      if (newProject && newProject.id) {
        const result = await api.projects.loadPrompts(project.id);
        if (result?.prompts?.length > 0) {
          await api.projects.savePrompts(newProject.id, result.prompts);
        }
      }
      render();
      break;
    }

    case 'delete': {
      showDeleteProjectModal(project);
      break;
    }
  }
}

// ════════════════════════════════════════════════
// Delete Project Modal (Фаза 2)
// ════════════════════════════════════════════════
function showDeleteProjectModal(project) {
  const setsCount = (project.promptSets || []).length;
  const hasInProgress = (project.promptSets || []).some(s => s.status === 'in_progress');

  // Backend guard kicks in too, but show clear UI message
  if (hasInProgress) {
    showToast('⛔ Остановите генерацию перед удалением проекта');
    return;
  }

  const setsLabel = setsCount === 0
    ? 'Пустой проект'
    : setsCount === 1
      ? '1 набор промптов'
      : `${setsCount} набора промптов`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card delete-confirm-modal" style="width:420px">
      <div class="delete-modal-icon">
        <svg viewBox="0 0 24 24" style="width:28px;height:28px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </div>
      <div class="modal-header" style="padding-top:0">Удалить проект?</div>
      <div class="delete-modal-body">
        <div class="delete-modal-target">«${project.name}»</div>
        <div class="delete-modal-meta">${setsLabel} · все файлы</div>
        <div class="delete-modal-note">
          <svg viewBox="0 0 24 24" style="width:13px;height:13px;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Данные будут перемещены в корзину Mews.<br>Вы сможете восстановить их в течение 30 дней.
        </div>
      </div>
      <div class="modal-footer">
        <button id="del-proj-cancel" class="btn btn-secondary">Отмена</button>
        <button id="del-proj-confirm" class="btn btn-danger">Удалить проект</button>
      </div>
    </div>
  `;

  container.appendChild(overlay);

  const doDelete = async () => {
    overlay.remove();
    const result = await api.projects.delete(project.id);
    if (!result?.success) {
      showToast(`⛔ ${result?.error || 'Не удалось удалить проект'}`);
      return;
    }
    if (state.currentProject?.id === project.id) {
      state.currentProject = null;
      updateStatusbar();
    }
    showToast(`🗑 Проект «${project.name}» перемещён в корзину`);
    render();
  };

  overlay.querySelector('#del-proj-confirm').addEventListener('click', doDelete);
  overlay.querySelector('#del-proj-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  requestAnimationFrame(() => overlay.querySelector('#del-proj-confirm')?.focus());
}

// ════════════════════════════════════════════════
// Delete Set Modal (Фаза 2)
// Вызывается из settings.js через showDeleteSetConfirm()
// ════════════════════════════════════════════════
export function showDeleteSetConfirm(project, setToDelete, onSuccess) {
  if (!project || !setToDelete) return;

  const isActive = project.activePromptSetId === setToDelete.id;
  const isLastSet = (project.promptSets || []).length === 1;

  // UI guard
  if (setToDelete.status === 'in_progress') {
    showToast('⛔ Остановите генерацию перед удалением набора');
    return;
  }

  // Determine which set will become active
  const remainingSets = (project.promptSets || []).filter(s => s.id !== setToDelete.id);
  const nextSet = remainingSets.length > 0 ? remainingSets[remainingSets.length - 1] : null;

  const nextSetHtml = isActive
    ? nextSet
      ? `<div class="delete-modal-note" style="margin-top:8px">
           <svg viewBox="0 0 24 24" style="width:13px;height:13px;flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
           После удаления активным станет: <strong>«${nextSet.name}»</strong>
         </div>`
      : `<div class="delete-modal-note delete-modal-note--warn" style="margin-top:8px">
           <svg viewBox="0 0 24 24" style="width:13px;height:13px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
           Это последний набор — проект станет пустым
         </div>`
    : '';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card delete-confirm-modal" style="width:420px">
      <div class="delete-modal-icon">
        <svg viewBox="0 0 24 24" style="width:28px;height:28px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </div>
      <div class="modal-header" style="padding-top:0">Удалить набор промптов?</div>
      <div class="delete-modal-body">
        <div class="delete-modal-target">«${setToDelete.name}»</div>
        <div class="delete-modal-meta">${setToDelete.promptCount || 0} промптов · все изображения${isActive ? ' · <span style="color:var(--accent)">активный</span>' : ''}</div>
            <div class="delete-modal-note">
              <svg viewBox="0 0 24 24" style="width:13px;height:13px;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Набор будет перемещён в корзину Mews.<br>Вы сможете восстановить его в течение 30 дней.
            </div>
        ${nextSetHtml}
      </div>
      <div class="modal-footer">
        <button id="del-set-cancel" class="btn btn-secondary">Отмена</button>
        <button id="del-set-confirm" class="btn btn-danger">Удалить набор</button>
      </div>
    </div>
  `;

  // Append to body so it works from any screen
  document.body.appendChild(overlay);

  const doDelete = async () => {
    overlay.remove();
    const result = await api.projects.deleteSet(project.id, setToDelete.id);
    if (!result?.success) {
      showToast(`⛔ ${result?.error || 'Не удалось удалить набор'}`);
      return;
    }
    const toastMsg = result.nextActiveSet
      ? `🗑 Набор удалён. Активный: «${result.nextActiveSet.name}»`
      : '🗑 Набор удалён';
    showToast(toastMsg);
    if (onSuccess) onSuccess(result);
  };

  overlay.querySelector('#del-set-confirm').addEventListener('click', doDelete);
  overlay.querySelector('#del-set-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  requestAnimationFrame(() => overlay.querySelector('#del-set-confirm')?.focus());
}

export default {
  id: 'projects',
  async mount(c) { container = c; await render(); },
  unmount() {
    document.removeEventListener('click', hideContextMenu);
    container = null;
  },
};

/* ── Projects Screen ── */
import { api, navigate, state } from '../app.js';

let container = null;

const PIPELINE_STEPS = ['Промпты', 'Настройки', 'Генерация', 'Отбор', 'Результат'];

const PROJECT_ICONS = {
  '🎬': '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>',
  '🏠': '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  '🌸': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2a4 4 0 0 1 0 8 4 4 0 0 1 0-8z"/><path d="M21 12a4 4 0 0 1-8 0 4 4 0 0 1 8 0z"/><path d="M12 14a4 4 0 0 1 0 8 4 4 0 0 1 0-8z"/><path d="M3 12a4 4 0 0 1 8 0 4 4 0 0 1-8 0z"/></svg>',
  '✅': '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  default: '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
};

function getIconSvg(emoji) {
  return PROJECT_ICONS[emoji] || PROJECT_ICONS.default;
}

function getProjectStep(p) {
  if (p.status === 'completed') return 5;
  if (p.status === 'in_progress') return 3;
  if (p.promptCount > 0) return 1;
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
  return `<span class="pc-badge ${cls}">${text}</span>`;
}

async function render() {
  const projects = await api.projects.list();

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
  `;

  // Events
  container.querySelector('#btn-new-project').addEventListener('click', async () => {
    const project = await api.projects.create('Новый проект', '🎬');
    if (project && project.id) {
      state.currentProject = project;
      navigate('settings');
    }
  });

  container.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const project = projects.find(p => p.id === id);
      if (project) {
        state.currentProject = project;
        if (project.status === 'completed') navigate('results');
        else navigate('settings');
      }
    });
  });
}

function renderProjectCard(p) {
  const step = getProjectStep(p);
  const date = p.createdAt ? new Date(p.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  return `
    <div class="project-card" data-id="${p.id}">
      <div class="pc-icon">${getIconSvg(p.icon)}</div>
      <div>
        <div class="pc-title">${p.name}</div>
        <div class="pc-sub">${p.promptCount || 0} промптов</div>
        <div class="pc-pipeline">${renderPipeline(step)}</div>
      </div>
      <div class="pc-right">
        ${renderBadge(p.status)}
        <span class="pc-date">${date}</span>
      </div>
    </div>
  `;
}

export default {
  id: 'projects',
  async mount(c) { container = c; await render(); },
  unmount() { container = null; },
};

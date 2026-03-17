/* ============================================================
   V4 APP — SPA Bootstrap, Router, Screen Lifecycle
   ============================================================ */

import api, { isElectron } from './api.js';

// ── Screen registry ──
const screenModules = {};
const SCREENS = ['connection', 'projects', 'settings', 'progress', 'selection', 'results'];
const DEFAULT_SCREEN = 'projects';

const SCREEN_META = {
  connection: {
    label: 'Связь',
    icon: `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  },
  projects: {
    label: 'Проекты',
    icon: `<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  },
  settings: {
    label: 'Настройки',
    icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  },
  progress: {
    label: 'Генерация',
    icon: `<svg viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`,
  },
  selection: {
    label: 'Отбор',
    icon: `<svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  },
  results: {
    label: 'Результат',
    icon: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  },
};

let currentScreen = null;
let appRoot = null;

// ── State ──
const state = {
  currentProject: null,
  connectionStatus: 'unknown',
  selections: {},
  selectionCurrentPrompt: 0,
  generationRequested: false, // Set by settings launch, consumed by progress mount
};

// ── Event Bus ──
const bus = new EventTarget();
export function emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on(name, fn) { bus.addEventListener(name, (e) => fn(e.detail)); }

// ── Router ──
function getScreenFromHash() {
  const hash = location.hash.replace('#', '').split('?')[0];
  return SCREENS.includes(hash) ? hash : DEFAULT_SCREEN;
}

async function navigate(screenId) {
  if (!SCREENS.includes(screenId)) screenId = DEFAULT_SCREEN;

  // Unmount current
  if (currentScreen && screenModules[currentScreen]) {
    try { screenModules[currentScreen].unmount(); } catch (e) { console.warn('[v4] unmount error:', e); }
  }

  // Update hash
  if (location.hash !== '#' + screenId) {
    history.replaceState(null, '', '#' + screenId);
  }

  currentScreen = screenId;

  // Persist session for restore flow
  try {
    api.config.set('lastScreen', screenId);
    if (state.currentProject?.id) {
      api.config.set('lastActiveProjectId', state.currentProject.id);
    }
  } catch {}

  // Update sidebar active state
  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.classList.toggle('active', el.dataset.screen === screenId);
  });

  // Update topbar
  updateTopbar(screenId);

  // Mount screen
  const container = document.getElementById('screen-content');
  container.innerHTML = '';

  if (screenModules[screenId]) {
    try {
      await screenModules[screenId].mount(container);
    } catch (e) {
      console.error(`[v4] mount error for ${screenId}:`, e);
      container.innerHTML = `<div style="padding:40px;color:var(--text-tertiary)">Ошибка загрузки экрана: ${e.message}</div>`;
    }
  } else {
    container.innerHTML = `<div style="padding:40px;color:var(--text-tertiary)">Загрузка ${screenId}…</div>`;
  }
}

// ── Sidebar ──
function buildSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Hub: only Projects. Connection accessed via statusbar.
  const hubScreens = ['projects'];
  const pipelineScreens = ['settings', 'progress', 'selection', 'results'];

  let html = '';

  // Hub group
  hubScreens.forEach(id => {
    const meta = SCREEN_META[id];
    html += `<a class="sidebar-item" data-screen="${id}" title="${meta.label}">
      <span class="sidebar-icon">${meta.icon}</span>
      <span class="sidebar-label">${meta.label}</span>
    </a>`;
  });

  // Divider
  html += `<div class="sidebar-divider"></div>`;

  // Pipeline group
  pipelineScreens.forEach(id => {
    const meta = SCREEN_META[id];
    html += `<a class="sidebar-item" data-screen="${id}" title="${meta.label}">
      <span class="sidebar-icon">${meta.icon}</span>
      <span class="sidebar-label">${meta.label}</span>
    </a>`;
  });

  sidebar.innerHTML = html;

  // Bind clicks
  sidebar.querySelectorAll('.sidebar-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.screen);
    });
  });
}

// ── Topbar ──
const STEP_MAP = {
  connection: { step: null, color: 'blue' },
  projects:   { step: null, color: 'blue' },
  settings:   { step: '2 / 5', color: 'blue' },
  progress:   { step: '3 / 5', color: 'orange' },
  selection:  { step: '4 / 5', color: 'blue' },
  results:    { step: '5 / 5', color: 'green' },
};

function updateTopbar(screenId) {
  const info = STEP_MAP[screenId] || {};
  const projectName = state.currentProject?.name || '';

  // Breadcrumb nav in topbar (contextual, not primary)
  const navEl = document.getElementById('topbar-nav');
  if (navEl) {
    const crumbs = [];
    const label = SCREEN_META[screenId]?.label || screenId;

    if (projectName && SCREENS.indexOf(screenId) > 1) {
      crumbs.push(`<span class="topbar-crumb-current">${projectName}</span>`);
      crumbs.push(`<span class="topbar-crumb-sep">·</span>`);
      crumbs.push(`<span class="topbar-crumb-active">${label}</span>`);
    } else {
      crumbs.push(`<span class="topbar-crumb-active">${label}</span>`);
    }

    navEl.innerHTML = crumbs.join('');
  }

  // Step badge
  const stepEl = document.getElementById('topbar-step');
  if (stepEl) {
    if (info.step) {
      stepEl.textContent = info.step;
      stepEl.className = `topbar-step topbar-step-${info.color}`;
      stepEl.style.display = '';
    } else {
      stepEl.style.display = 'none';
    }
  }
}

// ── Statusbar + Topbar connection pill ──
function updateStatusbar() {
  const dotEl = document.getElementById('sb-status-dot');
  const textEl = document.getElementById('sb-status-text');
  const isOnline = state.connectionStatus === 'online';

  // Bottom statusbar
  if (dotEl && textEl) {
    dotEl.style.background = isOnline ? 'var(--green)' : 'var(--text-tertiary)';
    textEl.textContent = isOnline ? 'Higgsfield · Подключено' : 'Не подключено';
  }

  // Topbar connection pill
  let pill = document.getElementById('topbar-conn-pill');
  const actionsEl = document.getElementById('topbar-actions');
  if (actionsEl && !pill) {
    pill = document.createElement('button');
    pill.id = 'topbar-conn-pill';
    pill.style.cssText = `display:flex;align-items:center;gap:5px;background:var(--bg-float);border:1px solid var(--border);border-radius:6px;padding:3px 10px 3px 8px;cursor:pointer;font-size:11px;font-family:var(--font);color:var(--text-secondary);transition:all 0.15s;`;
    pill.addEventListener('click', () => navigate('connection'));
    pill.addEventListener('mouseenter', () => pill.style.borderColor = 'var(--text-tertiary)');
    pill.addEventListener('mouseleave', () => pill.style.borderColor = 'var(--border)');
    actionsEl.prepend(pill);
  }
  if (pill) {
    pill.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${isOnline ? 'var(--green)' : 'var(--red)'};flex-shrink:0;"></span>${isOnline ? 'Подключено' : 'Не подключено'}`;
  }
}

function bindStatusbar() {
  const sbBtn = document.getElementById('sb-conn-btn');
  if (sbBtn) {
    sbBtn.addEventListener('click', () => navigate('connection'));
  }
}

// ── Screen loading ──
async function loadScreens() {
  for (const id of SCREENS) {
    try {
      const mod = await import(`./screens/${id}.js`);
      screenModules[id] = mod.default || mod;
    } catch (e) {
      console.warn(`[v4] Failed to load screen: ${id}`, e);
      screenModules[id] = {
        mount(c) { c.innerHTML = `<div style="padding:40px;color:var(--text-tertiary)">${id} — экран ещё не реализован</div>`; },
        unmount() {},
      };
    }
  }
}

// ── Init ──
async function init() {
  appRoot = document.getElementById('app');
  if (!appRoot) return console.error('[v4] #app root not found');

  console.log(`[v4] Init — Electron: ${isElectron}`);

  // Build sidebar + statusbar
  buildSidebar();
  bindStatusbar();

  // Load screen modules
  await loadScreens();

  // Listen for hash changes
  window.addEventListener('hashchange', () => navigate(getScreenFromHash()));

  // ── Restore flow: last project, last screen, saved selections ──
  let initialScreen = getScreenFromHash();
  try {
    const cfg = await api.config.getAll() || {};
    const lastProjectId = cfg.lastActiveProjectId;
    if (lastProjectId && initialScreen === DEFAULT_SCREEN) {
      // Try to restore last active project
      const projectsList = await api.projects.list();
      const lastProject = projectsList.find(p => p.id === lastProjectId);
      if (lastProject) {
        state.currentProject = lastProject;
        // Restore selections from project.json
        if (lastProject.selections) {
          state.selections = lastProject.selections;
          state.selectionCurrentPrompt = lastProject.selectionCurrentPrompt || 0;
        }
        // Navigate to last screen if it makes sense
        const lastScreen = cfg.lastScreen;
        if (lastScreen && SCREENS.includes(lastScreen) && lastScreen !== 'connection' && lastScreen !== 'progress') {
          initialScreen = lastScreen;
        }
      }
    }
  } catch (e) {
    console.warn('[v4] Restore flow error:', e);
  }

  // Initial navigation
  navigate(initialScreen);

  // Check connection status
  try {
    const status = await api.chrome.status();
    state.connectionStatus = status.cdpConnected ? 'online' : 'offline';
  } catch {
    state.connectionStatus = 'offline';
  }
  updateStatusbar();
}

// ── Boot ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── Toast notifications ──
function showToast(message, duration = 3000) {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Public exports for screens ──
export { api, state, navigate, updateStatusbar, showToast };

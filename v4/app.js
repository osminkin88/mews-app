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
  connectionStatus: 'unknown',  // 'connected' | 'chrome_running' | 'disconnected' | 'unknown'
  connectionDetail: null,        // Full chrome:status object {chromeRunning, cdpConnected, hasSession, sessionAge, cookieCount}
  selections: {},
  selectionCurrentPrompt: 0,
  generationRequested: false, // Set by settings launch, consumed by progress mount
};

// ── Event Bus ──
const bus = new EventTarget();
export function emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on(name, fn) {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(name, handler);
  // Return cleanup function for proper unsubscription
  return () => bus.removeEventListener(name, handler);
}

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

  // Spacer to push utility items to bottom
  html += `<div style="flex:1"></div>`;

  // ── Bottom utility zone ──
  // Connection entry — always visible, shows live status dot
  html += `<a class="sidebar-item sidebar-util" data-screen="connection" title="Подключение">
    <span class="sidebar-icon">
      ${SCREEN_META.connection.icon}
      <span id="sidebar-conn-dot" class="sidebar-conn-dot"></span>
    </span>
    <span class="sidebar-label">Связь</span>
  </a>`;

  // Quit button
  html += `<a class="sidebar-item sidebar-util" id="sidebar-quit" title="Завершить Mews">
    <span class="sidebar-icon">
      <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
    </span>
    <span class="sidebar-label">Выход</span>
  </a>`;

  sidebar.innerHTML = html;

  // Bind navigation clicks
  sidebar.querySelectorAll('.sidebar-item[data-screen]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.screen);
    });
  });

  // Bind quit
  document.getElementById('sidebar-quit')?.addEventListener('click', () => {
    api.app.quit();
  });
}

// Update sidebar connection dot color
function updateSidebarConnDot() {
  const dot = document.getElementById('sidebar-conn-dot');
  if (!dot) return;
  const s = state.connectionStatus;
  dot.style.background = s === 'connected' ? 'var(--green)' : s === 'chrome_running' ? 'var(--orange)' : 'var(--red)';
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

  // Breadcrumb nav in topbar (macOS Finder-like path)
  const navEl = document.getElementById('topbar-nav');
  if (navEl) {
    const crumbs = [];
    const label = SCREEN_META[screenId]?.label || screenId;

    if (projectName && SCREENS.indexOf(screenId) > 1) {
      crumbs.push(`<span class="topbar-crumb-current">${projectName}</span>`);
      crumbs.push(`<span class="topbar-crumb-sep">/</span>`);
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

// ── Canonical Connection State ──
// Single function to update connection status everywhere.
// Derives a richer status string from chrome:status detail.
function deriveConnectionStatus(detail) {
  if (!detail) return 'unknown';
  if (detail.cdpConnected) return 'connected';
  if (detail.chromeRunning) return 'chrome_running';
  return 'disconnected';
}

function setConnectionStatus(newStatus, detail = null) {
  const changed = state.connectionStatus !== newStatus;
  state.connectionStatus = newStatus;
  if (detail) state.connectionDetail = detail;
  if (changed || detail) {
    updateStatusbar();
    updateSidebarConnDot();
    emit('connection-changed', { status: newStatus, detail: state.connectionDetail });
  }
}

// ── Statusbar + Topbar connection pill ──
function updateStatusbar() {
  const status = state.connectionStatus;
  const isOnline = status === 'connected';
  const isWarning = status === 'chrome_running';

  // Bottom statusbar — show project context, NOT connection status (avoid duplication)
  const textEl = document.getElementById('sb-status-text');
  const dotEl = document.getElementById('sb-status-dot');
  if (textEl && dotEl) {
    if (state.currentProject) {
      dotEl.style.background = 'var(--accent)';
      textEl.textContent = state.currentProject.name;
    } else {
      dotEl.style.background = 'var(--text-tertiary)';
      textEl.textContent = 'Нет проекта';
    }
  }

  // Topbar connection pill — single canonical connection indicator
  let pill = document.getElementById('topbar-conn-pill');
  const actionsEl = document.getElementById('topbar-actions');
  if (actionsEl && !pill) {
    pill = document.createElement('button');
    pill.id = 'topbar-conn-pill';
    pill.className = 'topbar-conn-pill';
    pill.addEventListener('click', () => navigate('connection'));
    actionsEl.prepend(pill);
  }
  if (pill) {
    const dotColor = isOnline ? 'var(--green)' : isWarning ? 'var(--orange)' : 'var(--red)';
    const label = isOnline ? 'Подключено' : isWarning ? 'Chrome запущен' : 'Не подключено';
    const title = isOnline ? 'Higgsfield — подключено' : isWarning ? 'Chrome запущен, но нет связи' : 'Нет соединения с Higgsfield';
    pill.innerHTML = `<span class="topbar-pill-dot" style="background:${dotColor}"></span>${label}`;
    pill.title = title;
  }
}

function bindStatusbar() {
  const sbBtn = document.getElementById('sb-conn-btn');
  if (sbBtn) {
    // Bottom-left click navigates to projects/settings
    sbBtn.addEventListener('click', () => {
      if (state.currentProject) {
        navigate('settings');
      } else {
        navigate('projects');
      }
    });
  }
}

// ── Background connection poller ──
// Single source of truth for connection state.
// Stores FULL detail object + derived status string.
let _connPollTimer = null;
async function pollConnectionNow() {
  try {
    const detail = await api.chrome.status();
    const newStatus = deriveConnectionStatus(detail);
    setConnectionStatus(newStatus, detail);
  } catch {
    setConnectionStatus('disconnected', { chromeRunning: false, cdpConnected: false, hasSession: false, sessionAge: null, cookieCount: 0 });
  }
}

function startConnectionPoller() {
  if (_connPollTimer) clearInterval(_connPollTimer);
  pollConnectionNow(); // immediate first check
  _connPollTimer = setInterval(pollConnectionNow, 15000);
}

// Exposed for screens that need to force an immediate re-check (e.g. after connect/launch)
async function refreshConnectionNow() {
  await pollConnectionNow();
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
        // Restore selections from active prompt set (not project root)
        try {
          const loadResult = await api.projects.loadPrompts(lastProject.id);
          if (loadResult?.selections && Object.keys(loadResult.selections).length > 0) {
            state.selections = loadResult.selections;
            state.selectionCurrentPrompt = loadResult.selectionCurrentPrompt || 0;
          }
        } catch (_) {}
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

  // Check connection status via canonical poller
  startConnectionPoller();
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
export { api, state, navigate, updateStatusbar, setConnectionStatus, refreshConnectionNow, showToast };

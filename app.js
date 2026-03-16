/* ============================================================
   HIGGSFIELD STUDIO — App Logic (v2 · Unlimited Models)
   ============================================================ */

// ── Models — derived from model-capabilities.js (loaded before app.js via index.html) ──
// MODEL_REGISTRY, MODEL_ORDER, ALL_ASPECTS, resolveCompatibleSettings, getModelCapabilities
// are globals from model-capabilities.js
const MODELS = getUnlimitedModelList();

// ── Aspect ratio definitions (visual sizing for UI boxes) ──
const ASPECT_RATIO_VISUALS = {
  'Auto': { w: 28, h: 28, round: true },
  '1:1':  { w: 28, h: 28 },
  '3:4':  { w: 24, h: 32 },
  '4:3':  { w: 32, h: 24 },
  '2:3':  { w: 22, h: 34 },
  '3:2':  { w: 34, h: 22 },
  '9:16': { w: 20, h: 36 },
  '16:9': { w: 36, h: 20 },
  '5:4':  { w: 30, h: 24 },
  '4:5':  { w: 24, h: 30 },
  '21:9': { w: 40, h: 18 },
};

// ── Mock Data ──
const MOCK_PROMPTS = [
  { id: 1, text: 'A dreamy watercolor landscape with cherry blossoms and a small cottage by the river' },
  { id: 2, text: 'Minimalist abstract art with soft gradients in pastel pink and gold tones' },
  { id: 3, text: 'A cozy autumn cafe interior with warm lighting and vintage furniture' },
  { id: 4, text: 'Ethereal portrait of a woman with flowers in her hair, soft focus bokeh' },
  { id: 5, text: 'Modern architectural visualization of a glass house surrounded by nature' },
  { id: 6, text: 'Magical forest with bioluminescent mushrooms and fairy lights at twilight' },
  { id: 7, text: 'Elegant still life with ceramic vases, dried flowers, and morning light' },
  { id: 8, text: 'Futuristic cityscape at sunset with flying vehicles and neon accents' },
  { id: 9, text: 'Serene Japanese zen garden with raked sand patterns and stone lanterns' },
  { id: 10, text: 'Whimsical illustration of a cat reading books in a tiny library' },
  { id: 11, text: 'Ocean waves crashing against dramatic coastal cliffs at golden hour' },
  { id: 12, text: 'Vintage botanical illustration of rare tropical flowers and butterflies' },
];

// Placeholder image colors for demo
const IMAGE_COLORS = [
  ['#E8D5C4', '#D4A574', '#C49070', '#BFA084'],
  ['#F0D4E0', '#E8C0D0', '#DDA8C0', '#D090B0'],
  ['#D4C4A0', '#C8B898', '#BCA880', '#B09870'],
  ['#C4D8E0', '#B0CCE0', '#98BCD0', '#80ACC0'],
  ['#D0E0C4', '#B8D4A8', '#A0C890', '#88BC78'],
  ['#C8C0E0', '#B8B0D8', '#A8A0D0', '#9890C0'],
  ['#E0D4C0', '#D8C8B0', '#D0BCA0', '#C8B090'],
  ['#C4D4E8', '#A8C4E0', '#90B4D8', '#78A4D0'],
  ['#D8E0C4', '#C8D8A8', '#B8D090', '#A8C878'],
  ['#E8D8E0', '#E0C8D8', '#D8B8D0', '#D0A8C8'],
  ['#C0D8E4', '#A0C8E0', '#88BCD8', '#70B0D0'],
  ['#E4D0C0', '#DCC0A8', '#D4B090', '#CCA078'],
];

// Original progress controls HTML (to restore after generation)
const PROGRESS_CONTROLS_HTML = `
  <button class="btn btn-secondary btn-sm" id="btn-pause" onclick="togglePause()">
    ⏸ Пауза
  </button>
  <button class="btn btn-danger btn-sm" onclick="stopGeneration()">
    ⏹ Стоп
  </button>
  <div style="flex: 1;"></div>
  <span class="text-secondary" id="eta-text">—</span>
`;

// ── Meow Sound (preload for instant playback) ──
const meowSound = new Audio('meow.m4a');
meowSound.volume = 0.4;

// ── Splash Screen ──
function dismissSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  splash.classList.add('fade-out');
  setTimeout(() => { splash.style.display = 'none'; }, 700);
}

// FIX L5: Removed dead theme toggle code (dark mode was removed from UI)

// ── Cat Mascot State Machine ──
let mascotTimer = null;
function setMascotState(newState) {
  const mascot = document.getElementById('mascot');
  const cat = document.getElementById('mascot-cat');
  const status = document.getElementById('mascot-status');
  if (!mascot || !cat || !status) return;

  if (mascotTimer) { clearTimeout(mascotTimer); mascotTimer = null; }

  mascot.className = 'mascot ' + newState;

  const states = {
    sleeping: { img: 'cat-sleeping.png', text: 'Дремлет...' },
    working: { img: 'cat-working.png', text: 'Генерирует...' },
    happy: { img: 'cat-happy.png', text: 'Мур! Готово!' },
  };

  const s = states[newState] || states.sleeping;
  cat.src = s.img;
  status.textContent = s.text;

  // Auto-return to sleeping after happy
  if (newState === 'happy') {
    mascotTimer = setTimeout(() => setMascotState('sleeping'), 8000);
  }
}

// ── App State ──
const state = {
  currentScreen: 'projects',
  currentStep: 0,
  hasProjects: true,
  isConnected: false,
  fileImported: false,
  selectedModel: 'nano_banana_pro',
  selectedQuality: '2K',
  selectedRatio: '1:1',
  promptCount: 0,

  // Generation
  isGenerating: false,
  isPaused: false,
  generationProgress: 0,
  promptStatuses: [],
  currentPromptIndex: 0,
  currentImageIndex: 0,
  generationFinished: false,
  generationStartTime: null,

  // Selection
  selectionCurrentPrompt: 0,
  selectionInitialized: false,
  selections: {},

  // Timer for generation simulation
  generationTimer: null,

  // Real data (from Electron backend)
  importedPrompts: [],       // [{id, prompt}] from CSV/XLSX
  importedFilePath: null,
  progressCleanup: null,     // cleanup function for progress listener

  imagesPerPrompt: 4,        // Dynamic image quantity
};

// ── Persistence: Auto-Save (debounced) ──────────────────────
let _saveSessionTimer = null;
function saveSession() {
  if (_saveSessionTimer) clearTimeout(_saveSessionTimer);
  _saveSessionTimer = setTimeout(async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      await api.config.set('lastActiveProjectId', activeProjectId);
      await api.config.set('lastScreen', state.currentScreen);
      await api.config.set('lastImagesPerPrompt', state.imagesPerPrompt);
    } catch (e) { console.warn('[persist] saveSession error:', e); }
  }, 300);
}

let _saveProjectTimer = null;
function saveProjectState() {
  if (_saveProjectTimer) clearTimeout(_saveProjectTimer);
  _saveProjectTimer = setTimeout(async () => {
    const api = window.electronAPI;
    if (!api || !activeProjectId) return;
    try {
      await api.projects.update(activeProjectId, {
        selections: state.selections,
        selectionCurrentPrompt: state.selectionCurrentPrompt,
        selectedModel: state.selectedModel,
        selectedQuality: state.selectedQuality,
        selectedRatio: state.selectedRatio,
        imagesPerPrompt: state.imagesPerPrompt,
        lastScreen: state.currentScreen,
      });
    } catch (e) { console.warn('[persist] saveProjectState error:', e); }
  }, 500);
}

// ── Navigation ──
function navigateTo(screenId) {
  // Stop any active generation timer when navigating away from progress
  // (but don't stop the generation state itself)

  const screens = document.querySelectorAll('.screen');
  const navItems = document.querySelectorAll('.nav-item');
  const stepMap = {
    'projects': 0, 'connection': 1, 'settings': 2,
    'progress': 3, 'selection': 4, 'results': 5
  };

  screens.forEach(s => s.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));

  const target = document.getElementById(`screen-${screenId}`);
  if (target) target.classList.add('active');

  const navTarget = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
  if (navTarget) navTarget.classList.add('active');

  state.currentScreen = screenId;
  state.currentStep = stepMap[screenId] ?? 0;

  // FIX: Scroll main content to top on navigation
  const mainEl = document.querySelector('.main');
  if (mainEl) mainEl.scrollTop = 0;

  // FIX: Initialize selection screen if navigating to it from sidebar
  if (screenId === 'selection' && !state.selectionInitialized) {
    initSelection();
  }

  // FIX: Restore connection state when revisiting connection screen
  if (screenId === 'connection') {
    updateConnectionUI();
  }

  // Render dynamic controls when visiting settings
  if (screenId === 'settings') {
    renderModelSelect();
    renderQualityOptions();
    renderAspectOptions();
    updateSettingsSummary();
    renderProjectPrompts();
    // FIX S4: Show warning if generation is active
    _renderSettingsGenerationLock();
  }

  updateStepIndicator();
  updateNavStatuses();
  saveSession();
}

function updateStepIndicator() {
  const card = document.getElementById('step-indicator');
  const iconEl = document.getElementById('step-status-icon');
  const projectEl = document.getElementById('step-status-project');
  const labelEl = document.getElementById('step-status-label');
  const dots = card ? card.querySelectorAll('.step-dot') : [];
  if (!card) return;

  // ── Determine project context ──
  const project = activeProjectId ? projectsList.find(p => p.id === activeProjectId) : null;
  const hasPrompts = state.importedPrompts && state.importedPrompts.length > 0;
  const selCount = Object.keys(state.selections || {}).length;

  // ── Compute phase: setup (0), generate (1), select (2), done (3) ──
  let phase, icon, label, cardState;

  if (!project) {
    // No project selected
    phase = -1;
    icon = '📁';
    label = 'Начало';
    cardState = '';
    if (projectEl) projectEl.textContent = 'Выберите проект';
  } else {
    if (projectEl) projectEl.textContent = (project.icon || '🎬') + '  ' + project.name;

    if (state.isGenerating) {
      // Active generation
      phase = 1;
      icon = '⚡';
      const pct = state.generationProgress || 0;
      label = `Генерация ${pct}%`;
      cardState = 'generating';
    } else if (project.status === 'completed' || selCount > 0) {
      // Selection/review phase
      const totalPrompts = hasPrompts ? state.importedPrompts.length : 0;
      if (selCount >= totalPrompts && totalPrompts > 0) {
        phase = 3;
        icon = '✅';
        label = 'Завершён';
        cardState = 'completed';
      } else {
        phase = 2;
        icon = '🎯';
        label = `Отбор ${selCount}/${totalPrompts}`;
        cardState = 'selecting';
      }
    } else if (hasPrompts) {
      // Has prompts, ready to generate
      if (!state.isConnected) {
        phase = 0;
        icon = '🔗';
        label = 'Подключитесь';
        cardState = 'setup';
      } else {
        phase = 1;
        icon = '🚀';
        label = 'Готов к запуску';
        cardState = 'ready';
      }
    } else {
      // Draft — no prompts yet
      phase = 0;
      icon = '📝';
      label = 'Загрузите промпты';
      cardState = 'setup';
    }
  }

  card.setAttribute('data-state', cardState);
  if (iconEl) iconEl.textContent = icon;
  if (labelEl) labelEl.textContent = label;

  // ── Update 4 phase dots ──
  dots.forEach((dot, i) => {
    dot.classList.remove('active', 'completed', 'generating');
    if (i < phase) {
      dot.classList.add('completed');
    } else if (i === phase && phase >= 0) {
      dot.classList.add('active');
      if (state.isGenerating) dot.classList.add('generating');
    }
  });
}

function updateNavStatuses() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    const step = parseInt(item.dataset.step);
    const statusEl = item.querySelector('.nav-status');

    if (step < state.currentStep) {
      statusEl.textContent = '🐾';
    } else if (step === state.currentStep) {
      statusEl.textContent = '';
    } else {
      statusEl.textContent = '';
    }
  });
}

// ── Projects ──
let projectsList = [];
let activeProjectId = null;

async function loadProjectsList() {
  const api = window.electronAPI;
  if (!api) return;
  try {
    projectsList = await api.projects.list();
  } catch (err) {
    console.error('[app] Failed to load projects:', err);
    projectsList = [];
  }
  renderProjects();
}

function renderProjects() {
  const emptyEl = document.getElementById('projects-empty');
  const listEl = document.getElementById('projects-list');
  const container = document.getElementById('projects-container');
  if (!container) return;

  if (projectsList.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    if (listEl) listEl.style.display = 'none';
    const counterEl = document.getElementById('projects-counter');
    if (counterEl) counterEl.textContent = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (listEl) listEl.style.display = 'block';

  // Update counter
  const counterEl = document.getElementById('projects-counter');
  if (counterEl) counterEl.textContent = `(${projectsList.length})`;

  const statusConfig = {
    draft: { label: 'Черновик', badge: 'badge-neutral', icon: '📝' },
    in_progress: { label: 'В процессе', badge: 'badge-warning', icon: '⚡' },
    completed: { label: 'Завершён', badge: 'badge-success', icon: '✅' },
  };

  container.innerHTML = projectsList.map((p, i) => {
    const cfg = statusConfig[p.status] || statusConfig.draft;
    const icon = p.icon || pickProjectIcon(p.name);
    const date = new Date(p.createdAt).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    const prompts = p.promptCount || 0;
    const promptText = prompts === 0 ? 'нет промптов' : `${prompts} промпт${pluralRu(prompts)}`;
    return `
      <div class="card project-card ${i > 0 ? 'mt-sm' : ''}" data-project-id="${p.id}">
        <div class="project-icon" onclick="openProject('${p.id}')">${icon}</div>
        <div class="project-info" onclick="openProject('${p.id}')">
          <div class="project-name" id="project-name-${p.id}">${escapeHtml(p.name)}</div>
          <div class="project-meta">${promptText} · ${date}</div>
        </div>
        <span class="badge ${cfg.badge}">${cfg.label}</span>
        <button class="project-menu-btn" onclick="event.stopPropagation(); toggleProjectMenu('${p.id}', this)">⋯</button>
      </div>
    `;
  }).join('');
}

// ── Project Menu ──

const FALLBACK_ICONS = ['🎬', '📺', '🖼️', '🎞️', '🎨', '🎵', '📚', '🧪', '🐱', '😺'];

function pickProjectIcon(name) {
  if (!name) return '🎬';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_ICONS[Math.abs(hash) % FALLBACK_ICONS.length];
}

// ── Change Icon (inline in dropdown) ──
function openChangeIconMenu(id) {
  const menu = document.getElementById('project-context-menu');
  if (!menu) return;

  const icons = FALLBACK_ICONS;
  const project = projectsList.find(p => p.id === id);
  const currentIcon = project?.icon || '🎬';

  menu.innerHTML = `
    <div style="padding: 8px 12px; font-size: 12px; color: var(--text-secondary); font-weight: 600;">Выберите иконку</div>
    <div class="icon-picker" style="padding: 4px 12px 12px;" id="icon-change-grid"></div>
  `;

  const grid = document.getElementById('icon-change-grid');
  icons.forEach((ic, idx) => {
    const btn = document.createElement('button');
    btn.className = 'icon-pick' + (ic === currentIcon ? ' selected' : '');
    btn.textContent = ic;
    btn.style.cssText = 'width:36px; height:36px; font-size:18px; padding:0;';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      changeProjectIcon(id, icons[idx]);
    });
    grid.appendChild(btn);
  });
}

async function changeProjectIcon(id, icon) {
  closeAllMenus();
  // Restore original menu HTML
  restoreContextMenu();

  const api = window.electronAPI;
  if (api) {
    try {
      await api.projects.update(id, { icon });
    } catch (err) {
      console.error('[app] Change icon error:', err);
    }
  }
  await loadProjectsList();
}

function restoreContextMenu() {
  const menu = document.getElementById('project-context-menu');
  if (!menu) return;
  menu.innerHTML = `
    <button class="project-dropdown-item" id="ctx-icon" onclick="openChangeIconMenu(activeMenuProjectId)">🎨 Сменить иконку</button>
    <button class="project-dropdown-item" id="ctx-rename" onclick="startRenameProject(activeMenuProjectId)">✏️ Переименовать</button>
    <button class="project-dropdown-item" id="ctx-duplicate" onclick="duplicateProject(activeMenuProjectId)">📋 Дублировать</button>
    <button class="project-dropdown-item" id="ctx-folder" onclick="openProjectFolder(activeMenuProjectId)">📂 Открыть папку</button>
    <div class="project-dropdown-sep"></div>
    <button class="project-dropdown-item danger" id="ctx-delete" onclick="deleteProject(activeMenuProjectId)">🗑 Удалить</button>
  `;
}

let activeMenuId = null;
let activeMenuProjectId = null;

function toggleProjectMenu(id, btnEl) {
  const wasOpen = activeMenuId === id;
  closeAllMenus();
  if (wasOpen) return;

  const menu = document.getElementById('project-context-menu');
  if (!menu || !btnEl) return;

  // Position dropdown near the button
  const rect = btnEl.getBoundingClientRect();
  const menuHeight = 180; // approximate
  const spaceBelow = window.innerHeight - rect.bottom;

  menu.style.left = `${rect.right - 200}px`; // align right edge
  if (spaceBelow < menuHeight) {
    // Open upward
    menu.style.top = `${rect.top - menuHeight}px`;
  } else {
    // Open downward
    menu.style.top = `${rect.bottom + 4}px`;
  }

  menu.style.display = 'block';
  activeMenuId = id;
  activeMenuProjectId = id;

  const card = document.querySelector(`[data-project-id="${id}"]`);
  if (card) card.classList.add('menu-open');
}

function closeAllMenus() {
  const menu = document.getElementById('project-context-menu');
  if (menu) menu.style.display = 'none';
  document.querySelectorAll('.project-card.menu-open').forEach(c => c.classList.remove('menu-open'));
  activeMenuId = null;
  // Restore original menu structure (in case icon picker was shown)
  restoreContextMenu();
}

// Close menus on outside click
document.addEventListener('click', (e) => {
  // If the target was detached from DOM (e.g. innerHTML replaced), don't close
  if (!document.body.contains(e.target)) return;
  if (!e.target.closest('.project-menu-btn') && !e.target.closest('.project-dropdown')) {
    closeAllMenus();
  }
});

// ── Rename ──
function startRenameProject(id) {
  closeAllMenus();
  const nameEl = document.getElementById(`project-name-${id}`);
  if (!nameEl) return;

  const project = projectsList.find(p => p.id === id);
  if (!project) return;

  const currentName = project.name;
  nameEl.innerHTML = `<input class="project-name-input" id="rename-input-${id}" 
    value="${escapeHtml(currentName)}" 
    onblur="finishRename('${id}')"
    onkeydown="if(event.key==='Enter'){finishRename('${id}')}if(event.key==='Escape'){cancelRename('${id}','${escapeHtml(currentName)}')}">`;

  const input = document.getElementById(`rename-input-${id}`);
  if (input) { input.focus(); input.select(); }
}

async function finishRename(id) {
  const input = document.getElementById(`rename-input-${id}`);
  if (!input) return;

  const newName = input.value.trim();
  if (!newName) {
    cancelRename(id);
    return;
  }

  const api = window.electronAPI;
  if (api) {
    try {
      await api.projects.update(id, { name: newName });
    } catch (err) {
      console.error('[app] Rename error:', err);
    }
  }
  await loadProjectsList();
}

function cancelRename(id, oldName) {
  const nameEl = document.getElementById(`project-name-${id}`);
  if (nameEl && oldName) nameEl.textContent = oldName;
  else loadProjectsList(); // re-render
}

// ── Delete ──
let deleteConfirmId = null;

async function deleteProject(id) {
  const project = projectsList.find(p => p.id === id);
  if (!project) return;

  const deleteBtn = document.getElementById('ctx-delete');

  // Two-click confirm
  if (deleteConfirmId !== id) {
    deleteConfirmId = id;
    if (deleteBtn) {
      deleteBtn.textContent = '⚠️ Удалить проект и все файлы';
      deleteBtn.classList.add('confirm');
    }
    setTimeout(() => {
      if (deleteConfirmId === id) {
        deleteConfirmId = null;
        if (deleteBtn) {
          deleteBtn.textContent = '🗑 Удалить';
          deleteBtn.classList.remove('confirm');
        }
      }
    }, 3000);
    return;
  }

  // Confirmed delete
  closeAllMenus();
  deleteConfirmId = null;
  const api = window.electronAPI;
  if (api) {
    try {
      await api.projects.delete(id);
    } catch (err) {
      console.error('[app] Delete error:', err);
    }
  }
  await loadProjectsList();
}

// ── Duplicate ──
async function duplicateProject(id) {
  closeAllMenus();
  const project = projectsList.find(p => p.id === id);
  if (!project) return;

  const api = window.electronAPI;
  if (api) {
    try {
      await api.projects.create(`${project.name} (копия)`, project.icon || '🎬');
      await loadProjectsList();
    } catch (err) {
      console.error('[app] Duplicate error:', err);
    }
  }
}

// ── Open Folder ──
async function openProjectFolder(id) {
  closeAllMenus();
  const api = window.electronAPI;
  if (!api) return;
  try {
    const project = projectsList.find(p => p.id === id);
    const folder = project?.folderName || id;
    const dir = await api.config.get('outputDir');
    await api.fs.openFolder(`${dir}/${folder}`);
  } catch (err) {
    console.error('[app] Open folder error:', err);
  }
}

function pluralRu(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return '';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'а';
  return 'ов';
}

function pluralRuGen(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'я';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'и';
  return 'й';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let selectedIcon = '🎬';

function selectProjectIcon(btn) {
  document.querySelectorAll('.icon-pick.selected').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedIcon = btn.dataset.icon;
}

async function createProject() {
  // Open the new project modal
  const modal = document.getElementById('modal-new-project');
  if (!modal) return;
  modal.style.display = 'flex';

  // Reset input
  const input = document.getElementById('new-project-name');
  if (input) {
    input.value = '';
    updateProjectPreview();
    setTimeout(() => input.focus(), 100);
  }

  // Reset icon picker — select first icon
  selectedIcon = '🎬';
  document.querySelectorAll('.icon-pick.selected').forEach(b => b.classList.remove('selected'));
  const firstIcon = document.querySelector('.icon-pick[data-icon="🎬"]');
  if (firstIcon) firstIcon.classList.add('selected');

  // Show output dir path
  const api = window.electronAPI;
  if (api) {
    try {
      const dir = await api.config.get('outputDir');
      const dirEl = document.getElementById('project-output-dir');
      if (dirEl) dirEl.textContent = shortenPath(dir);
    } catch { }
  }
}

function closeNewProjectModal() {
  const modal = document.getElementById('modal-new-project');
  if (modal) modal.style.display = 'none';
}

function updateProjectPreview() {
  const input = document.getElementById('new-project-name');
  const nameEl = document.getElementById('project-folder-name');
  const val = (input ? input.value : '').trim() || 'Новый проект';
  if (nameEl) nameEl.textContent = val;
}

async function confirmCreateProject() {
  const input = document.getElementById('new-project-name');
  const name = (input ? input.value : '').trim() || 'Новый проект';

  const api = window.electronAPI;
  if (api) {
    try {
      const project = await api.projects.create(name, selectedIcon);
      activeProjectId = project.id;
      console.log(`[app] Created project: ${project.name} (${project.id}) icon: ${selectedIcon}`);
      await loadProjectsList();
    } catch (err) {
      console.error('[app] Create project error:', err);
    }
  }

  closeNewProjectModal();
  // FIX S5: Removed stale state.hasProjects = true (use projectsList.length directly)
  // Stay on projects screen so user can see the new project
}

// Handle Enter in project name input
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const modal = document.getElementById('modal-new-project');
    if (modal && modal.style.display !== 'none') {
      e.preventDefault();
      confirmCreateProject();
    }
  }
  if (e.key === 'Escape') {
    closeNewProjectModal();
  }
});

function openProject(id) {
  activeProjectId = id;
  const project = projectsList.find(p => p.id === id);
  if (!project) return;

  // ── Restore persisted project state ──
  if (project.selections && Object.keys(project.selections).length > 0) {
    state.selections = { ...project.selections };
  }
  if (typeof project.selectionCurrentPrompt === 'number') {
    state.selectionCurrentPrompt = project.selectionCurrentPrompt;
  }
  if (project.imagesPerPrompt) state.imagesPerPrompt = project.imagesPerPrompt;
  if (project.selectedRatio) state.selectedRatio = project.selectedRatio;
  if (project.selectedQuality) state.selectedQuality = project.selectedQuality;

  console.log(`[app] Opening project: ${project.name} (${id})`);

  // FIX: Reset file-imported state for new project context
  state.fileImported = false;

  // Load state from project DB
  state.importedPrompts = project.prompts || [];
  state.promptCount = state.importedPrompts.length;

  // FIX: Mark as imported if project has prompts
  if (state.importedPrompts.length > 0) {
    state.fileImported = true;
  }

  if (project.model) {
    state.selectedModel = project.model;
    const modelSelect = document.getElementById('model-select');
    if (modelSelect) modelSelect.value = project.model;
  }

  // Update summaries
  updatePromptSummary(state.promptCount);
  updateSettingsSummary();

  // Smart Navigation
  if (!state.isConnected) {
    navigateTo('connection');
    return;
  }

  if (project.status === 'in_progress') {
    navigateTo('progress');
  } else if (project.status === 'completed') {
    navigateTo('selection');
  } else {
    navigateTo('settings'); // Settings acts as the prompt import/management screen
  }
}
// ── Connection ──
let _connectCancelled = false;

async function connectAccount() {
  const api = window.electronAPI;
  if (!api) {
    // Mock mode (browser)
    state.isConnected = true;
    updateConnectionUI();
    return;
  }

  // Switch to connecting state
  _connectCancelled = false;
  _showConnectionState('connecting');

  // Reset check badges
  _setCheckBadge('chrome', '⏳', '');
  _setCheckBadge('auth', '⏳', '');
  _setCheckBadge('session', '⏳', '');

  const hintEl = document.getElementById('conn-checking-hint');

  try {
    // 1. Launch Chrome
    if (hintEl) hintEl.textContent = 'Запускаю Chrome...';
    const launchResult = await api.chrome.launch();

    if (_connectCancelled) return;

    if (!launchResult.success) {
      _setCheckBadge('chrome', '✗', 'neutral');
      if (hintEl) hintEl.textContent = `Ошибка: ${launchResult.error}`;
      setTimeout(() => _showConnectionState('disconnected'), 3000);
      return;
    }

    _setCheckBadge('chrome', '✓', 'ok');
    if (hintEl) hintEl.textContent = 'Войдите в Higgsfield через Google...';

    // 2. Poll for connection (every 3s, up to 3 min)
    for (let i = 0; i < 60; i++) {
      if (_connectCancelled) return;
      await new Promise(r => setTimeout(r, 3000));
      if (_connectCancelled) return;

      try {
        const connectResult = await api.chrome.connect();
        if (connectResult.success) {
          const auth = await api.chrome.checkAuth();
          if (auth.authenticated) {
            await api.chrome.saveSession();

            _setCheckBadge('auth', '✓', 'ok');
            _setCheckBadge('session', '✓', 'ok');

            state.isConnected = true;
            updateConnectionUI();
            return;
          }
        }
      } catch {}

      // Update hint with poll counter
      if (hintEl) hintEl.textContent = `Жду авторизации... (${i + 1}/60)`;
    }

    // Timeout
    if (hintEl) hintEl.textContent = 'Время ожидания истекло. Попробуйте снова.';
    _setCheckBadge('auth', '✗', 'neutral');
    setTimeout(() => _showConnectionState('disconnected'), 3000);

  } catch (err) {
    if (hintEl) hintEl.textContent = `Ошибка: ${err.message}`;
    setTimeout(() => _showConnectionState('disconnected'), 3000);
  }
}

function cancelConnect() {
  _connectCancelled = true;
  _showConnectionState('disconnected');
}

function reconnectAccount() {
  state.isConnected = false;
  _showConnectionState('disconnected');
}

// Helper: show one of 3 connection states
function _showConnectionState(stateName) {
  const disconnected = document.getElementById('connection-disconnected');
  const connecting = document.getElementById('connection-connecting');
  const connected = document.getElementById('connection-connected');

  if (disconnected) disconnected.style.display = stateName === 'disconnected' ? 'block' : 'none';
  if (connecting) connecting.style.display = stateName === 'connecting' ? 'block' : 'none';
  if (connected) connected.style.display = stateName === 'connected' ? 'block' : 'none';
}

// Helper: update a check badge in the connecting state
function _setCheckBadge(check, text, cls) {
  const badge = document.getElementById(`check-${check}-badge`);
  const icon = document.getElementById(`check-${check}-icon`);
  if (badge) {
    badge.textContent = text;
    badge.className = cls ? `conn-check-badge ${cls}` : 'conn-check-badge';
  }
  if (icon && cls) {
    icon.className = cls ? `conn-check-icon ${cls}` : 'conn-check-icon';
  }
}

// Sync UI with connection state (called on startup + after connect)
function updateConnectionUI() {
  _showConnectionState(state.isConnected ? 'connected' : 'disconnected');

  // Update sidebar nav status for connection
  const connNav = document.querySelector('.nav-item[data-screen="connection"] .nav-status');
  if (connNav) connNav.textContent = state.isConnected ? '✓' : '';

  // FIX V2: Update footer connection status via dedicated element to prevent stacking
  const footer = document.querySelector('.sidebar-footer-text');
  if (footer) {
    // Remove old connection prefix if present, then re-add cleanly
    const baseText = footer.textContent.replace(/^● Подключено  ·  /, '');
    footer.textContent = state.isConnected ? '● Подключено  ·  ' + baseText : baseText;
  }
}

// FIX U5: Removed dead showPawConfetti() — container doesn't exist in index.html


// ── Settings ──
async function downloadTemplate() {
  const api = window.electronAPI;
  if (!api) {
    _showToast('📄', 'Шаблон доступен в папке приложения', 'info');
    return;
  }
  try {
    const result = await api.file.downloadTemplate();
    if (result.canceled) return; // user cancelled Save-As dialog
    if (result.success) {
      const shortName = result.path.split(/[/\\]/).pop();
      _showToast('✅', `Шаблон сохранён: ${shortName}`, 'success');
    } else {
      _showToast('⚠️', result.error || 'Не удалось сохранить шаблон', 'error');
    }
  } catch (err) {
    _showToast('⚠️', `Ошибка: ${err.message}`, 'error');
  }
}

/**
 * Apple-style toast notification — slides in from top, auto-dismisses.
 * @param {string} icon - Emoji icon
 * @param {string} text - Message text
 * @param {'success'|'error'|'info'} type - Toast color variant
 */
function _showToast(icon, text, type = 'info') {
  // Remove any existing toast
  const existing = document.getElementById('app-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'app-toast';
  toast.className = `app-toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-text">${text}</span>
  `;
  document.body.appendChild(toast);

  // Trigger entrance animation
  requestAnimationFrame(() => toast.classList.add('show'));

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

async function simulateImport() {
  // Note: the drop-zone is hidden by renderProjectPrompts() when prompts exist,
  // so this function only gets called when the drop-zone is visible (no prompts loaded).

  const api = window.electronAPI;
  if (!api) {
    // Mock mode (browser)
    state.fileImported = true;
    state.importedPrompts = MOCK_PROMPTS.map(p => ({ id: String(p.id), prompt: p.text }));
    state.promptCount = state.importedPrompts.length;
    document.getElementById('drop-zone').style.display = 'none';
    document.getElementById('file-info').style.display = 'flex';
    const countEl = document.getElementById('file-prompt-count');
    if (countEl) countEl.textContent = `${state.promptCount} промптов`;
    updatePromptSummary(state.promptCount);
    return;
  }

  try {
    // 1. Open native file dialog
    const filePath = await api.file.select();
    if (!filePath) return; // Cancelled

    // 2. Parse file
    const result = await api.file.import(filePath);
    if (!result.success) {
      _showToast('⚠️', result.error || 'Ошибка импорта', 'error');
      return;
    }

    // 3. Update state
    state.fileImported = true;
    state.importedPrompts = result.rows.map(p => ({ ...p, status: 'pending' }));
    state.importedFilePath = filePath;
    state.promptCount = result.count;

    // 4. Save prompts to active project folder
    if (activeProjectId) {
      try {
        await api.projects.savePrompts(activeProjectId, state.importedPrompts, filePath);
        console.log(`[app] Saved ${result.count} prompts to project ${activeProjectId}`);
      } catch (e) {
        console.error('[app] Failed to save prompts to project:', e);
      }
    }

    // 5. Update UI
    updatePromptSummary(state.promptCount);
    updateSettingsSummary();
    // renderProjectPrompts handles hiding dropzone and showing the list
    renderProjectPrompts();

  } catch (err) {
    _showToast('⚠️', `Ошибка импорта: ${err.message}`, 'error');
  }
}

function selectModel(modelId) {
  state.selectedModel = modelId;
  const caps = getModelCapabilities(modelId);
  if (caps) {
    // Resolve all settings against new model capabilities
    const resolved = resolveCompatibleSettings({
      model: modelId,
      quality: state.selectedQuality,
      aspect: state.selectedRatio,
      imagesPerPrompt: state.imagesPerPrompt,
    });

    // Apply effective settings
    state.selectedQuality = resolved.effective.quality;
    state.selectedRatio = resolved.effective.aspect;
    state.imagesPerPrompt = resolved.effective.imagesPerPrompt;

    // Show auto-correction warnings as a toast
    if (resolved.warnings.length > 0) {
      const msgs = resolved.warnings.map(w => w.message);
      showCompatibilityToast(msgs);
      console.log(`[app] ⚠️ Auto-corrected settings for ${caps.name}:`, msgs);
    }
  }
  // Re-render all dynamic controls
  renderModelSelect();
  renderQualityOptions();
  renderAspectOptions();
  updateSettingsSummary();
  saveProjectState();
}

function selectQuality(el, quality) {
  document.querySelectorAll('.quality-option').forEach(q => q.classList.remove('active'));
  el.classList.add('active');
  state.selectedQuality = quality;
  updateSettingsSummary();
  saveProjectState();
}

function selectImagesCount(optionEl, count) {
  const container = document.getElementById('images-count-buttons');
  if (!container) return;
  const opts = container.querySelectorAll('.ratio-option');
  opts.forEach(o => o.classList.remove('active'));
  optionEl.classList.add('active');

  state.imagesPerPrompt = count;

  const hintEl = document.getElementById('images-count-hint');
  if (hintEl) {
    const genWord = count === 1 ? 'генерация' : (count >= 2 && count <= 4 ? 'генерации' : 'генераций');
    hintEl.textContent = `${count} ${genWord} × 1 картинка (Unlimited)`;
  }

  // Sync banner
  const bannerCount = document.getElementById('banner-images-count');
  if (bannerCount) bannerCount.textContent = count;

  updateSettingsSummary();
  saveProjectState();
}

function selectRatio(el, ratio) {
  // FIX: Scope to the aspect-ratio container only, avoid images-count buttons
  const container = el.closest('.ratio-options');
  if (container) {
    container.querySelectorAll('.ratio-option').forEach(r => r.classList.remove('active'));
  }
  el.classList.add('active');
  state.selectedRatio = ratio;
  saveProjectState();
}

function renderQualityOptions() {
  const card = document.getElementById('quality-card');
  if (!card) return;

  const caps = getModelCapabilities(state.selectedModel);
  if (!caps || caps.qualities.length === 0) {
    // No quality options for this model — hide card
    card.style.display = 'none';
    return;
  }

  card.style.display = '';
  const container = document.getElementById('quality-buttons');
  const hint = document.getElementById('quality-hint');
  if (!container) return;

  container.innerHTML = caps.qualities.map(q => {
    const isActive = q === state.selectedQuality ? 'active' : '';
    return `<div class="quality-option ${isActive}" onclick="selectQuality(this, '${q}')">
      <span class="quality-label">${q}</span>
    </div>`;
  }).join('');

  if (hint) {
    if (caps.qualities.length === 1) {
      hint.textContent = `${caps.qualities[0]} — Unlimited`;
    } else {
      hint.textContent = caps.qualities.join(' / ') + ' — Unlimited';
    }
  }
}

/**
 * Dynamically render aspect ratio options based on the selected model's capabilities.
 * Non-supported aspects are hidden (not just disabled).
 */
function renderAspectOptions() {
  const container = document.querySelector('#screen-settings .ratio-options');
  if (!container) return;

  // Don't touch the images-count-buttons container
  if (container.id === 'images-count-buttons') return;

  const caps = getModelCapabilities(state.selectedModel);
  const allowedAspects = caps ? caps.aspects : ALL_ASPECTS;

  container.innerHTML = allowedAspects.map(ratio => {
    const vis = ASPECT_RATIO_VISUALS[ratio] || { w: 28, h: 28 };
    const isActive = ratio === state.selectedRatio ? 'active' : '';
    const borderRadius = vis.round ? 'border-radius: 50%;' : '';
    return `<div class="ratio-option ${isActive}" onclick="selectRatio(this, '${ratio}')">
      <div class="ratio-box" style="width: ${vis.w}px; height: ${vis.h}px; ${borderRadius}"></div>
      <span class="ratio-label">${ratio}</span>
    </div>`;
  }).join('');
}

/**
 * Render the model <select> dropdown with only Unlimited models.
 */
function renderModelSelect() {
  const select = document.getElementById('model-select');
  if (!select) return;

  select.innerHTML = MODELS.map(m => {
    const selected = m.id === state.selectedModel ? 'selected' : '';
    return `<option value="${m.id}" ${selected}>${m.name}</option>`;
  }).join('');
}

/**
 * Show a brief toast notification for auto-corrected settings.
 */
function showCompatibilityToast(messages) {
  // Remove existing toast
  const existing = document.getElementById('compatibility-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'compatibility-toast';
  toast.className = 'compatibility-toast';
  toast.innerHTML = `<span class="toast-icon">⚠️</span><div class="toast-messages">${messages.map(m => `<div>${m}</div>`).join('')}</div>`;
  document.body.appendChild(toast);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function updateSettingsSummary() {
  const caps = getModelCapabilities(state.selectedModel);
  const modelInfoEl = document.getElementById('settings-model-info');
  if (modelInfoEl && caps) {
    const qualityStr = state.selectedQuality ? ` · ${state.selectedQuality}` : '';
    const aspectStr = state.selectedRatio ? ` · ${state.selectedRatio}` : '';
    modelInfoEl.textContent = `${caps.name}${qualityStr}${aspectStr}`;
  }

  const promptCountEl = document.getElementById('prompt-count');
  if (promptCountEl) {
    promptCountEl.textContent = state.promptCount > 0 ? state.promptCount : '—';
  }

  // Dynamic ready card title for Variant A
  const titleEl = document.getElementById('settings-ready-title');
  if (titleEl) {
    if (state.promptCount > 0) {
      const totalImages = state.promptCount * state.imagesPerPrompt;
      titleEl.textContent = `${state.promptCount} промпт${pluralRu(state.promptCount)} × ${state.imagesPerPrompt} = ${totalImages} генераци${pluralRuGen(totalImages)}`;
    } else {
      titleEl.textContent = 'Загрузите промпты для начала генерации';
    }
  }

  // Start button: disabled if no prompts or no connection
  const startBtn = document.getElementById('btn-start-generation');
  if (startBtn) {
    startBtn.disabled = state.promptCount === 0;
  }

  if (state.promptCount > 0) {
    updatePromptSummary();
  }
}

function updatePromptSummary() {
  // Render prompt preview list and manage visibility
  renderProjectPrompts();
}

function renderProjectPrompts() {
  const dropZone = document.getElementById('drop-zone');
  const fileInfo = document.getElementById('file-info');
  const listContainer = document.getElementById('prompts-preview-container');
  const listEl = document.getElementById('prompts-preview-list');

  if (state.promptCount === 0 || state.importedPrompts.length === 0) {
    if (dropZone) dropZone.style.display = 'flex';
    if (fileInfo) fileInfo.style.display = 'none';
    if (listContainer) listContainer.style.display = 'none';
    return;
  }

  // We have prompts -> Hide dropzone, show info & list
  if (dropZone) dropZone.style.display = 'none';
  if (fileInfo) {
    fileInfo.style.display = 'flex';
    const nameEl = document.getElementById('file-name');
    const metaEl = document.getElementById('file-prompt-count');

    // Attempt to get file name from project source meta
    const project = activeProjectId ? projectsList.find(p => p.id === activeProjectId) : null;
    const fName = project?.sourceMeta?.originalFileName || state.importedFilePath?.split(/[/\\]/).pop() || 'Проектные промпты';

    if (nameEl) nameEl.textContent = fName;
    if (metaEl) metaEl.textContent = `В проекте ${state.promptCount} промпт${pluralRu(state.promptCount)}`;
  }

  if (listContainer && listEl) {
    listContainer.style.display = 'block';

    // Define status styling mapping
    const statusMap = {
      completed: { icon: '✅', color: 'var(--success)' },
      generating: { icon: '⚡', color: 'var(--warning)' },
      error: { icon: '❌', color: 'var(--danger)' },
      pending: { icon: '⏳', color: 'var(--text-secondary)' },
    };

    listEl.innerHTML = state.importedPrompts.map(p => {
      const s = statusMap[p.status] || statusMap.pending;
      const displayText = p.comment || p.prompt;
      return `
        <div class="prompts-preview-item">
          <span class="prompts-preview-id" style="color: ${s.color};" title="ID">${p.id}</span>
          <span class="prompts-preview-icon">${s.icon}</span>
          <span class="prompts-preview-text" title="${escapeHtml(p.prompt)}">${escapeHtml(displayText)}</span>
        </div>
      `;
    }).join('');
  }
}

// ── Update / Replace Prompts actions (Step 3) ──
async function appUpdatePrompts() {
  const api = window.electronAPI;
  if (!api || !activeProjectId) return;

  const filePath = await api.file.select();
  if (!filePath) return;

  const result = await api.file.import(filePath);
  if (!result.success) return _showToast('⚠️', result.error, 'error');

  const newPrompts = result.rows;
  const oldPrompts = state.importedPrompts;

  let updatedCount = 0;
  let addedCount = 0;

  const oldMap = new Map();
  oldPrompts.forEach(p => oldMap.set(String(p.id), p));

  const merged = [];

  for (const n of newPrompts) {
    const id = String(n.id);
    if (oldMap.has(id)) {
      const old = oldMap.get(id);
      if (old.prompt !== n.prompt) {
        old.prompt = n.prompt;
        updatedCount++;
      }
      merged.push(old);
      oldMap.delete(id);
    } else {
      merged.push({ ...n, status: 'pending' });
      addedCount++;
    }
  }

  const removedCount = oldMap.size;
  let msg = `Сверка с проектом завершена:\n✅ Без изменений текстов: ${merged.length - updatedCount - addedCount}\n🔄 Обновлены тексты: ${updatedCount}\n➕ Новых промптов: ${addedCount}\n❌ Отсутствуют в новом файле: ${removedCount}\n\nПрименить изменения?`;

  if (!confirm(msg)) return;

  if (removedCount > 0) {
    if (confirm(`В старом проекте осталось ${removedCount} промптов, которых нет в новом файле.\n[ОК] - Оставить их в проекте\n[Отмена] - Удалить их из проекта`)) {
      for (const old of oldMap.values()) merged.push(old);
    }
  }

  merged.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  state.importedPrompts = merged;
  state.promptCount = merged.length;
  state.importedFilePath = filePath;

  await api.projects.savePrompts(activeProjectId, merged, filePath);
  updatePromptSummary(state.promptCount);
  updateSettingsSummary();
  renderProjectPrompts();
}

async function appReplacePrompts() {
  if (!confirm('Внимание! Это полностью удалит текущие промпты из проекта (но не сгенерированные файлы на диске) и позволит загрузить новый файл. Продолжить?')) return;

  const api = window.electronAPI;
  if (!api || !activeProjectId) return;

  const filePath = await api.file.select();
  if (!filePath) return; // User cancelled select

  const result = await api.file.import(filePath);
  if (!result.success) return _showToast('⚠️', result.error, 'error');

  state.importedPrompts = result.rows.map(p => ({ ...p, status: 'pending' }));
  state.promptCount = result.count;
  state.importedFilePath = filePath;

  await api.projects.savePrompts(activeProjectId, state.importedPrompts, filePath);
  updatePromptSummary(state.promptCount);
  updateSettingsSummary();
  renderProjectPrompts();
}

// ── Retry Failed Slots ──
/**
 * Retry only prompts that didn't fully succeed (partial, error, stopped).
 * Each retried prompt keeps its originalIndex so it writes to the correct folder.
 * Done prompts are never retried.
 * FIX L2: Uses activeProjectId + importedPrompts instead of non-existent state.currentProject.
 */
async function retryFailedSlots() {
  if (!activeProjectId) {
    console.warn('[app] retryFailedSlots: no active project');
    return;
  }

  // Collect non-done prompts
  const failedPromptIds = new Set(
    (state.lastBackendResults || [])
      .filter(r => r.status !== 'done')
      .map(r => String(r.id))
  );

  if (failedPromptIds.size === 0) {
    console.log('[app] retryFailedSlots: nothing to retry');
    return;
  }

  // FIX L2: Use state.importedPrompts (the actual loaded prompts) instead of state.currentProject.prompts
  const allPrompts = state.importedPrompts || [];
  const promptsToRetry = allPrompts
    .map((p, idx) => ({
      ...p,
      originalIndex: p.originalIndex !== undefined ? p.originalIndex : idx,
    }))
    .filter(p => failedPromptIds.has(String(p.id)));

  if (promptsToRetry.length === 0) {
    console.log('[app] retryFailedSlots: no matching prompts found');
    return;
  }

  console.log(`[app] retryFailedSlots: ${promptsToRetry.length} prompts to retry`);

  // Reset generation state for a fresh run with only the failed prompts
  state.generationFinished = false;
  state.isGenerating = false;
  state.promptStatuses = promptsToRetry.map(p => ({
    id: p.id,
    text: p.prompt,
    comment: p.comment || '',
    status: 'pending',
    imagesGenerated: 0,
    savedCount: 0,
    failedCount: 0,
    totalSlots: state.imagesPerPrompt || 4,
    slots: [],
    originalIndex: p.originalIndex,
  }));

  // Store for the generation start
  state._retryPrompts = promptsToRetry;

  // Kick off generation
  await startGeneration(promptsToRetry);
}

// ── Generation ──
async function startGeneration(promptOverride) {

  // FIX: Clear any existing timer first
  if (state.generationTimer) {
    clearInterval(state.generationTimer);
    state.generationTimer = null;
  }

  state.isGenerating = true;
  setMascotState('working');
  state.generationStartTime = Date.now();
  state.isPaused = false;
  state.generationProgress = 0;
  state.currentPromptIndex = 0;
  state.currentImageIndex = 0;
  state.generationFinished = false;
  state.selectionInitialized = false; // Reset selection for new generation

  // FIX L1: Set project status to 'in_progress' when generation starts
  if (activeProjectId && window.electronAPI) {
    window.electronAPI.projects.update(activeProjectId, { status: 'in_progress' }).catch(console.error);
    // Update local list too
    const proj = projectsList.find(p => p.id === activeProjectId);
    if (proj) proj.status = 'in_progress';
  }

  // ── Engine Overwrite Protection (Step 4) ──
  let promptsToGenerate;

  if (promptOverride && promptOverride.length > 0) {
    // ── Retry mode: use the provided list directly (originalIndex already set) ──
    promptsToGenerate = promptOverride;
    console.log(`[app] 🔄 Retry mode: ${promptsToGenerate.length} prompts to retry`);
  } else {
    // ── Normal mode: build from importedPrompts ──
    // FIX L6: Only fall back to MOCK_PROMPTS in browser dev mode
    if (state.importedPrompts.length > 0) {
      promptsToGenerate = [...state.importedPrompts];
    } else if (!window.electronAPI) {
      promptsToGenerate = MOCK_PROMPTS.map(p => ({ id: String(p.id), prompt: p.text, status: 'pending' }));
    } else {
      _showToast('📄', 'Загрузите промпты перед началом генерации.', 'info');
      state.isGenerating = false;
      return;
    }

    // ── FIX: Tag every prompt with its ABSOLUTE index BEFORE any filtering ──
    // This ensures partial reruns write to the correct folder (e.g. prompt #3 → 003/)
    promptsToGenerate.forEach((p, i) => {
      p.originalIndex = i;
    });

    const completedPrompts = promptsToGenerate.filter(p => p.status === 'completed');
    if (completedPrompts.length > 0) {
      const skipOld = confirm(`Внимание: ${completedPrompts.length} промптов уже успешно сгенерированы.\n\n[ОК] - Пропустить готовые и генерировать только новые/ожидающие\n[Отмена] - Перегенерировать ВСЁ заново (старые результаты будут удалены)`);
      if (skipOld) {
        promptsToGenerate = promptsToGenerate.filter(p => p.status !== 'completed');
        if (promptsToGenerate.length === 0) {
          _showToast('✅', 'Все промпты уже сгенерированы! Переходите к отбору.', 'success');
          return;
        }
      } else {
        // Force rewrite — mark locally as pending
        promptsToGenerate.forEach(p => p.status = 'pending');
      }
    }
  }



  // ── DIAGNOSTIC: Log what prompts we're sending ──
  console.log(`[app] ═══ GENERATION START ═══`);
  console.log(`[app] Prompt source: ${state.importedPrompts.length > 0 ? 'IMPORTED FILE' : 'MOCK DATA'}`);
  console.log(`[app] Total prompts to run: ${promptsToGenerate.length}`);
  console.log(`[app] activeProjectId: ${activeProjectId || 'NONE'}`);
  promptsToGenerate.forEach((p, i) => {
    console.log(`[app] Prompt ${i + 1}: id=${p.id}, text="${(p.prompt || '').substring(0, 80)}..."`);
  });

  // ── CREATE IMMUTABLE GENERATION SNAPSHOT ──
  // Freeze batch parameters so Progress screen is immune to Settings changes
  state.generationSnapshot = Object.freeze({
    model: state.selectedModel,
    quality: state.selectedQuality,
    aspect: state.selectedRatio,
    imagesPerPrompt: state.imagesPerPrompt || 4,
    promptCount: promptsToGenerate.length,
    projectId: activeProjectId,
    startedAt: Date.now(),
  });

  // Init prompt statuses (Only for the ones we actually sent to Engine!)
  state.promptStatuses = promptsToGenerate.map((p, i) => ({
    id: p.id,
    text: p.prompt,
    comment: p.comment || '',
    status: i === 0 ? 'in-progress' : 'pending',
    imagesGenerated: 0,
  }));

  // FIX: Restore progress controls HTML (they may have been replaced by completion banner)
  const controls = document.querySelector('.progress-controls-compact');
  if (controls) {
    controls.innerHTML = PROGRESS_CONTROLS_HTML;
  }

  // FIX: Reset progress UI to 0% immediately
  document.getElementById('progress-percent').textContent = '0%';
  document.getElementById('progress-bar-fill').style.width = '0%';
  const cntEl = document.getElementById('progress-counter');
  if (cntEl) cntEl.textContent = `0/${state.promptStatuses.length}`;
  const dChip = document.getElementById('stat-done-chip');
  if (dChip) dChip.textContent = '✓ 0';
  const numEl = document.getElementById('progress-current-num');
  if (numEl) numEl.textContent = '#1';
  const ptEl = document.getElementById('current-prompt-text');
  if (ptEl) ptEl.textContent = state.promptStatuses[0]?.text || 'Ожидание…';

  navigateTo('progress');
  renderPromptStatusList();

  const api = window.electronAPI;
  if (!api) {
    // Mock mode — use simulation
    startGenerationSimulation();
    return;
  }

  // ── Real generation via Electron backend ──
  // Listen for progress events
  if (state.progressCleanup) state.progressCleanup();
  state.progressCleanup = api.generate.onProgress((data) => {
    handleGenerationProgress(data);
  });

  try {
    // ── Settings validation via capability matrix ──
    const resolved = resolveCompatibleSettings({
      model: state.selectedModel,
      quality: state.selectedQuality,
      aspect: state.selectedRatio,
      imagesPerPrompt: state.imagesPerPrompt,
    });

    // Block if model is incompatible
    if (resolved.blocked) {
      _showToast('⚠️', resolved.blockReason, 'error');
      state.isGenerating = false;
      return;
    }

    // Apply effective settings (auto-corrected if needed)
    const eff = resolved.effective;
    if (resolved.warnings.length > 0) {
      const msgs = resolved.warnings.map(w => w.message);
      console.log(`[app] ⚠️ Pre-generation auto-corrections:`, msgs);
    }

    // ── Log settings being sent to engine ──
    const caps = getModelCapabilities(eff.model);
    console.log(`[app] ┌── SETTINGS BEING SENT TO ENGINE ─────────────`);
    console.log(`[app] │ model     : ${eff.model} (${caps?.name || '?'})`);
    console.log(`[app] │ quality   : ${eff.quality || 'N/A (no quality for this model)'}`);
    console.log(`[app] │ aspect    : ${eff.aspect}`);
    console.log(`[app] │ images    : ${eff.imagesPerPrompt} (app-level iterations, site batch always 1)`);
    console.log(`[app] └──────────────────────────────────────────────`);

    const result = await api.generate.start(promptsToGenerate, {
      model: eff.model,
      aspect: eff.aspect,
      quality: eff.quality,
      imagesCount: eff.imagesPerPrompt,
    }, activeProjectId);

    if (!result.success) {
      _showToast('⚠️', result.error, 'error');
      state.isGenerating = false;
    }
  } catch (err) {
    _showToast('⚠️', `Ошибка генерации: ${err.message}`, 'error');
    state.isGenerating = false;
  }
}

// Handle real-time progress events from backend
function handleGenerationProgress(data) {
  // ── FORENSIC: Log every incoming event ──
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const stateSnap = `idx=${state.currentPromptIndex} statuses=[${state.promptStatuses.map(p => `${p.status}:${p.imagesGenerated}`).join(',')}]`;
  console.log(`[app] 📨 PROGRESS[${ts}]: status=${data.status || '?'} step=${data.step || '?'} current=${data.current || '?'}/${data.total || '?'} ${stateSnap}`);
  if (data.step === 'saved' || data.status === 'complete' || data.current) {
    console.log(`[app]    data: ${JSON.stringify(data).substring(0, 200)}`);
  }

  if (data.status === 'complete') {
    // ── FIX: Pass backend results to finishGeneration for honest completion ──
    console.log(`[app] ✅ COMPLETE received, results.length=${(data.results || []).length}`);
    finishGeneration(data.results || []);
    return;
  }

  if (data.status === 'auth_error') {
    _showToast('🔒', data.message, 'info');
    state.isGenerating = false;
    return;
  }

  // FIX RC-5: Честный счётчик картинок — только из реального step:'saved'
  if (data.step === 'saved') {
    const cp = state.promptStatuses[state.currentPromptIndex];
    if (cp) {
      const before = cp.imagesGenerated;
      cp.imagesGenerated = (cp.imagesGenerated || 0) + 1;
      console.log(`[app] 💾 SAVED: promptIdx=${state.currentPromptIndex} imagesGenerated: ${before}→${cp.imagesGenerated}`);
    } else {
      console.log(`[app] ⚠️ SAVED event but no currentPrompt at idx=${state.currentPromptIndex}!`);
    }

    // RC-4 FIX: Compute live hybrid progress after each saved slot
    _updateLiveProgress();
    updateProgressUI();
    renderPromptStatusList();
    return;
  }

  if (data.current && data.total) {
    const idx = data.current - 1;

    console.log(`[app] 📍 PROMPT ADVANCE: current=${data.current} → idx=${idx} (was ${state.currentPromptIndex})`);

    // FIX: Reset previous prompt from 'in-progress' to 'awaiting-result'
    // so only ONE prompt is ever shown as actively generating.
    // 'awaiting-result' = backend done with this prompt, waiting for final status from finishGeneration().
    for (const p of state.promptStatuses) {
      if (p.status === 'in-progress') {
        // FIX: Mark as done immediately if all images saved
        const target = _snap().imagesPerPrompt;
        p.status = (p.imagesGenerated >= target) ? 'done' : 'awaiting-result';
      }
    }

    // Mark only the current prompt as in-progress
    if (idx >= 0 && idx < state.promptStatuses.length) {
      state.promptStatuses[idx].status = 'in-progress';
    }

    state.currentPromptIndex = idx;

    // RC-4 FIX: Compute live hybrid progress on prompt advance
    _updateLiveProgress();

    // Обновляем текст текущего промпта
    const promptTextEl = document.getElementById('current-prompt-text');
    if (promptTextEl && data.prompt) promptTextEl.textContent = data.prompt;
    // Update current number
    const numEl2 = document.getElementById('progress-current-num');
    if (numEl2) numEl2.textContent = `${idx + 1}`;

    updateProgressUI();
    renderPromptStatusList();
  }
}

/**
 * Helper: access generation snapshot values with safe fallback.
 * Progress code should always use _snap() instead of live state settings.
 */
function _snap() {
  return state.generationSnapshot || { imagesPerPrompt: state.imagesPerPrompt || 4 };
}

/**
 * RC-4 FIX: Compute live hybrid progress during generation.
 * Uses snapshot for target images per prompt.
 */
function _updateLiveProgress() {
  const total = state.promptStatuses.length;
  if (total === 0) { state.generationProgress = 0; return; }

  const target = _snap().imagesPerPrompt;
  let progress = 0;

  for (const p of state.promptStatuses) {
    if (p.status === 'done' || p.status === 'error' || p.status === 'partial' || p.status === 'stopped') {
      progress += 1; // Fully processed prompt
    } else if (p.status === 'awaiting-result') {
      progress += 1; // Backend finished, awaiting final status
    } else if (p.status === 'in-progress') {
      // Fractional credit based on saved images so far
      const saved = p.imagesGenerated || 0;
      progress += saved / target;
    }
    // 'pending' contributes 0
  }

  state.generationProgress = Math.min(99, Math.round((progress / total) * 100)); // Cap at 99% until finishGeneration
}


function startGenerationSimulation() {
  if (state.generationTimer) clearInterval(state.generationTimer);

  state.generationTimer = setInterval(() => {
    if (state.isPaused) return;
    if (state.generationFinished) return; // FIX: Guard against stale timers

    const current = state.promptStatuses[state.currentPromptIndex];
    if (!current) {
      finishGeneration();
      return;
    }

    current.imagesGenerated++;
    state.currentImageIndex = current.imagesGenerated;

    if (current.imagesGenerated >= _snap().imagesPerPrompt) {
      current.status = 'done';
      state.currentPromptIndex++;

      if (state.currentPromptIndex < state.promptStatuses.length) {
        state.promptStatuses[state.currentPromptIndex].status = 'in-progress';
        state.currentImageIndex = 0;
      }
    }

    // Calculate overall progress
    const totalImages = state.promptStatuses.length * _snap().imagesPerPrompt;
    const doneImages = state.promptStatuses.reduce((sum, p) => sum + p.imagesGenerated, 0);
    state.generationProgress = Math.round((doneImages / totalImages) * 100);

    updateProgressUI();
    renderPromptStatusList();

    if (state.currentPromptIndex >= state.promptStatuses.length) {
      finishGeneration();
    }
  }, 800);
}

function updateProgressUI() {
  const pctEl = document.getElementById('progress-percent');
  const fillEl = document.getElementById('progress-bar-fill');
  const counterEl = document.getElementById('progress-counter');
  const doneChip = document.getElementById('stat-done-chip');
  const errChip = document.getElementById('stat-errors-chip');

  if (!pctEl || !fillEl) return;

  const target = _snap().imagesPerPrompt;
  // FIX: Count awaiting-result with full images as done
  const donePr = state.promptStatuses.filter(p =>
    p.status === 'done' || (p.status === 'awaiting-result' && p.imagesGenerated >= target)
  ).length;
  const errPr = state.promptStatuses.filter(p => p.status === 'error' || p.status === 'partial').length;
  const totalPr = state.promptStatuses.length;

  // ── RING: current prompt image count ──
  const cp = state.currentPromptIndex < totalPr
    ? state.promptStatuses[state.currentPromptIndex]
    : null;
  const currentImages = cp ? (cp.imagesGenerated || 0) : 0;
  const ringPct = target > 0 ? Math.round((currentImages / target) * 100) : 0;

  const ringEl = document.getElementById('progress-ring-circle');
  if (ringEl) {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (ringPct / 100) * circumference;
    ringEl.style.strokeDasharray = `${circumference}`;
    ringEl.style.strokeDashoffset = `${offset}`;
  }
  const ringCurrentEl = document.getElementById('ring-current');
  const ringTotalEl = document.getElementById('ring-total');
  const ringPctEl = document.getElementById('ring-pct');
  if (ringCurrentEl) ringCurrentEl.textContent = currentImages;
  if (ringTotalEl) ringTotalEl.textContent = target;
  if (ringPctEl) ringPctEl.textContent = `${ringPct}%`;

  // ── BAR: overall batch progress ──
  const overallPct = totalPr > 0 ? Math.round((donePr / totalPr) * 100) : 0;
  // Use generationProgress if it's more accurate (accounts for partial image progress)
  const barPct = Math.max(overallPct, state.generationProgress || 0);
  if (fillEl) fillEl.style.width = `${barPct}%`;

  const barLabelEl = document.getElementById('progress-bar-label');
  if (barLabelEl) barLabelEl.textContent = `Промпт ${donePr + (cp && cp.status === 'in-progress' ? 1 : 0)} из ${totalPr} · ${barPct}%`;

  // Legacy elements
  if (pctEl) pctEl.textContent = `${barPct}%`;
  if (counterEl) counterEl.textContent = `${donePr}/${totalPr}`;
  if (errChip) errChip.textContent = `✗ ${errPr}`;
  if (doneChip) doneChip.textContent = `✓ ${donePr}`;

  // Current prompt in header — show COMMENT if available
  if (cp) {
    const promptTextEl = document.getElementById('current-prompt-text');
    if (promptTextEl) promptTextEl.textContent = cp.comment || cp.text;
  }

  // Smart ETA
  const etaEl = document.getElementById('eta-text');
  if (etaEl) {
    const remaining = totalPr - donePr;
    if (donePr > 0 && state.generationStartTime) {
      const elapsed = (Date.now() - state.generationStartTime) / 1000;
      const avgPerPrompt = elapsed / donePr;
      const etaSec = Math.round(remaining * avgPerPrompt);
      const etaMin = Math.ceil(etaSec / 60);
      etaEl.textContent = `≈ ${etaMin} мин`;
    } else {
      etaEl.textContent = `≈ ${remaining * 2} мин`;
    }
  }

  // Filter counts (hidden elements)
  const inProg = state.promptStatuses.filter(p => p.status === 'in-progress').length;
  const el = id => document.getElementById(id);
  if (el('filter-all')) el('filter-all').textContent = totalPr;
  if (el('filter-progress')) el('filter-progress').textContent = inProg;
  if (el('filter-done')) el('filter-done').textContent = donePr;
  if (el('filter-errors')) el('filter-errors').textContent = errPr;
}

let _currentFilter = 'all';

let _lastRenderedFilter = null;
let _lastRenderedCount = -1;

function renderPromptStatusList(forceFullRender) {
  const list = document.getElementById('prompt-status-list');
  if (!list) return;

  const filtered = _currentFilter === 'all'
    ? state.promptStatuses
    : state.promptStatuses.filter(p => {
      if (_currentFilter === 'error') return p.status === 'error' || p.status === 'partial';
      // FIX: Include completed awaiting-result in 'done' filter
      if (_currentFilter === 'done') {
        const tgt = _snap().imagesPerPrompt;
        return p.status === 'done' || (p.status === 'awaiting-result' && p.imagesGenerated >= tgt);
      }
      return p.status === _currentFilter;
    });

  const needsFullRender = forceFullRender
    || _lastRenderedFilter !== _currentFilter
    || _lastRenderedCount !== filtered.length
    || list.children.length !== filtered.length;

  if (needsFullRender) {
    // Full render — build all items
    _lastRenderedFilter = _currentFilter;
    _lastRenderedCount = filtered.length;

    const icons = {
      'pending': '<div class="status-icon pending">○</div>',
      'in-progress': '<div class="status-icon in-progress">◉</div>',
      'awaiting-result': '<div class="status-icon awaiting">◎</div>',
      'done': '<div class="status-icon done">🐾</div>',
      'partial': '<div class="status-icon error">◐</div>',
      'error': '<div class="status-icon error">✗</div>',
      'stopped': '<div class="status-icon stopped">■</div>',
    };

    const target = _snap().imagesPerPrompt;

    list.innerHTML = filtered.map((p) => {
      const origIdx = state.promptStatuses.indexOf(p);

      // Badge on the right side (matching mockup)
      let badge = '';
      if (p.status === 'done' || (p.status === 'awaiting-result' && p.imagesGenerated >= target)) {
        badge = `<span class="status-badge badge-done">${p.imagesGenerated || target}/${target} ✓</span>`;
      } else if (p.status === 'in-progress') {
        badge = `<span class="status-badge badge-progress">${p.imagesGenerated}/${target}</span>`;
      } else if (p.status === 'awaiting-result') {
        badge = `<span class="status-badge badge-awaiting">${p.imagesGenerated}/${target}</span>`;
      } else if (p.status === 'error') {
        badge = `<span class="status-badge badge-error">ошибка</span>`;
      } else if (p.status === 'partial') {
        badge = `<span class="status-badge badge-error">${p.imagesGenerated}/${target}</span>`;
      } else if (p.status === 'stopped') {
        badge = `<span class="status-badge badge-stopped">стоп</span>`;
      } else {
        badge = `<span class="status-badge badge-pending">в очереди</span>`;
      }

      return `
        <li class="status-item ${p.status === 'in-progress' ? 'current' : ''}" title="${p.text}" data-prompt-idx="${origIdx}">
          ${icons[p.status] || icons['pending']}
          <span class="status-item-num">${origIdx + 1}</span>
          <div class="status-text">
            <div class="status-text-title">${p.comment || p.text}</div>
          </div>
          ${badge}
        </li>
      `;
    }).join('');
  } else {
    // Incremental update — only patch changed items
    const target = _snap().imagesPerPrompt;

    const iconMap = {
      'pending': '○', 'in-progress': '◉', 'awaiting-result': '◎', 'done': '🐾',
      'partial': '◐', 'error': '✗', 'stopped': '■',
    };
    const iconClassMap = {
      'pending': 'status-icon pending', 'in-progress': 'status-icon in-progress',
      'awaiting-result': 'status-icon awaiting',
      'done': 'status-icon done', 'partial': 'status-icon error',
      'error': 'status-icon error', 'stopped': 'status-icon stopped',
    };

    const items = list.children;
    for (let i = 0; i < filtered.length && i < items.length; i++) {
      const p = filtered[i];
      const li = items[i];

      // Update current class
      const shouldBeCurrent = p.status === 'in-progress';
      if (shouldBeCurrent && !li.classList.contains('current')) {
        li.classList.add('current');
      } else if (!shouldBeCurrent && li.classList.contains('current')) {
        li.classList.remove('current');
      }

      // Update icon
      const iconEl = li.querySelector('.status-icon');
      if (iconEl) {
        const newClass = iconClassMap[p.status] || iconClassMap['pending'];
        if (iconEl.className !== newClass) {
          iconEl.className = newClass;
          iconEl.textContent = iconMap[p.status] || iconMap['pending'];
        }
      }

      // Update badge on the right
      const badgeEl = li.querySelector('.status-badge');
      if (badgeEl) {
        let newBadgeText = '';
        let newBadgeClass = 'status-badge';
        if (p.status === 'done' || (p.status === 'awaiting-result' && p.imagesGenerated >= target)) {
          newBadgeText = `${p.imagesGenerated || target}/${target} ✓`;
          newBadgeClass += ' badge-done';
        } else if (p.status === 'in-progress') {
          newBadgeText = `${p.imagesGenerated}/${target}`;
          newBadgeClass += ' badge-progress';
        } else if (p.status === 'awaiting-result') {
          newBadgeText = `${p.imagesGenerated}/${target}`;
          newBadgeClass += ' badge-awaiting';
        } else if (p.status === 'error') {
          newBadgeText = 'ошибка';
          newBadgeClass += ' badge-error';
        } else if (p.status === 'partial') {
          newBadgeText = `${p.imagesGenerated}/${target}`;
          newBadgeClass += ' badge-error';
        } else if (p.status === 'stopped') {
          newBadgeText = 'стоп';
          newBadgeClass += ' badge-stopped';
        } else {
          newBadgeText = 'в очереди';
          newBadgeClass += ' badge-pending';
        }
        if (badgeEl.textContent !== newBadgeText) badgeEl.textContent = newBadgeText;
        if (badgeEl.className !== newBadgeClass) badgeEl.className = newBadgeClass;
      }
    }
  }

  // Auto-scroll: smoothly reveal the current item without layout jumps
  const currentItem = list.querySelector('.status-item.current');
  if (currentItem) {
    currentItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function filterPrompts(status, btnEl) {
  _currentFilter = status;
  const tabs = document.querySelectorAll('#progress-filter-tabs .filter-tab');
  tabs.forEach(t => t.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  renderPromptStatusList();
}

function togglePause() {
  state.isPaused = !state.isPaused;
  const btn = document.getElementById('btn-pause');
  if (btn) btn.innerHTML = state.isPaused ? '▶ Продолжить' : '⏸ Пауза';
}

async function stopGeneration() {
  // FIX: Prevent double-call
  if (state.generationFinished) return;

  if (state.generationTimer) {
    clearInterval(state.generationTimer);
    state.generationTimer = null;
  }
  state.isGenerating = false;

  // Tell backend to stop
  const api = window.electronAPI;
  if (api) {
    try { await api.generate.stop(); } catch { }
  }

  // FIX: Mark ALL non-terminal prompts as stopped
  // This covers: pending, in-progress, and awaiting-result
  state.promptStatuses.forEach(p => {
    if (p.status === 'pending' || p.status === 'in-progress' || p.status === 'awaiting-result') {
      p.status = 'stopped';
    }
  });

  // FIX: Go directly to finishGeneration — no intermediate renders
  // that would show stale filter chips or progress
  finishGeneration();
}

function finishGeneration(backendResults) {
  // FIX: Prevent double finishing
  if (state.generationFinished) return;
  state.generationFinished = true;

  if (state.generationTimer) {
    clearInterval(state.generationTimer);
    state.generationTimer = null;
  }
  state.isGenerating = false;

  // ── Sync prompt statuses from REAL backend results ──
  if (backendResults && backendResults.length > 0) {
    const resultMap = new Map();
    for (const r of backendResults) {
      resultMap.set(String(r.id), r);
    }
    for (const ps of state.promptStatuses) {
      const br = resultMap.get(String(ps.id));
      if (br) {
        ps.status = br.status;
        ps.savedCount = br.savedCount || 0;
        ps.failedCount = br.failedCount || 0;
        ps.totalSlots = br.totalSlots || _snap().imagesPerPrompt;
        ps.slots = br.slots || [];
        ps.imagesGenerated = br.savedCount || 0;
      }
    }
    // Save backendResults for Retry failed
    state.lastBackendResults = backendResults;
  }

  // Clean up transient states — no in-progress or awaiting-result after generation ends
  for (const ps of state.promptStatuses) {
    if (ps.status === 'in-progress' || ps.status === 'awaiting-result') {
      ps.status = 'stopped';
    }
  }

  // ── Compute REAL slot-level counts ──
  // FIX: Use imagesGenerated as fallback for savedCount when no backend results
  // This ensures prompts that received 'saved' events during generation are counted
  // even when stop is pressed before backend reports final results.
  const totalSlots = state.promptStatuses.reduce((sum, p) => sum + (p.totalSlots || _snap().imagesPerPrompt), 0);
  const savedSlots = state.promptStatuses.reduce((sum, p) => {
    // savedCount (from backend) takes priority; fallback to imagesGenerated (from live events)
    return sum + (p.savedCount ?? p.imagesGenerated ?? 0);
  }, 0);
  const failedSlots = state.promptStatuses.reduce((sum, p) => sum + (p.failedCount || 0), 0);

  const doneCount = state.promptStatuses.filter(p => p.status === 'done').length;
  const partialCount = state.promptStatuses.filter(p => p.status === 'partial').length;
  const errorCount = state.promptStatuses.filter(p => p.status === 'error').length;
  const stoppedCount = state.promptStatuses.filter(p => p.status === 'stopped').length;
  const totalCount = state.promptStatuses.length;
  const processedCount = doneCount + partialCount + errorCount + stoppedCount;

  // ── RC-3 FIX: Honest progress = processed / total (not always 100%) ──
  state.generationProgress = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;

  // ── Determine batch outcome category ──
  const allPerfect = doneCount === totalCount && totalCount > 0;
  const hasProblems = errorCount > 0 || partialCount > 0;
  const wasStopped = stoppedCount > 0;
  const totalFailure = savedSlots === 0 && totalCount > 0;

  // ── RC-1 FIX: Conditional mascot + sound based on REAL outcome ──
  if (allPerfect) {
    setMascotState('happy');
    try { meowSound.currentTime = 0; meowSound.play().catch(() => {}); } catch {}
    if (document.hidden && Notification.permission === 'granted') {
      new Notification('Mews 🐱', { body: 'Мур! Все изображения сохранены!' });
    }
  } else if (savedSlots > 0) {
    // Partial success — no happy cat, but gentle notification
    setMascotState('sleeping');
    if (document.hidden && Notification.permission === 'granted') {
      new Notification('Mews 🐱', { body: `Генерация завершена: ${savedSlots}/${totalSlots} сохранено.` });
    }
  } else {
    // Total failure or stopped with 0 saved — no celebration
    setMascotState('sleeping');
    if (document.hidden && Notification.permission === 'granted') {
      new Notification('Mews 🐱', { body: wasStopped ? 'Генерация остановлена.' : 'Генерация завершена с ошибками.' });
    }
  }

  // ── Update progress UI elements ──
  const pctEl = document.getElementById('progress-percent');
  const fillEl = document.getElementById('progress-bar-fill');
  const etaEl = document.getElementById('eta-text');
  const doneEl = document.getElementById('stat-done-chip');
  const errEl = document.getElementById('stat-errors-chip');

  if (pctEl) pctEl.textContent = `${state.generationProgress}%`;
  if (fillEl) {
    fillEl.style.width = `${state.generationProgress}%`;
    // RC-7 FIX: Color-code progress bar by outcome
    fillEl.classList.remove('fill-success', 'fill-warning', 'fill-error');
    if (totalFailure) {
      fillEl.classList.add('fill-error');
    } else if (hasProblems || wasStopped) {
      fillEl.classList.add('fill-warning');
    } else {
      fillEl.classList.add('fill-success');
    }
  }

  if (etaEl) {
    if (totalFailure) {
      etaEl.textContent = 'Генерация завершилась с ошибками';
    } else if (wasStopped) {
      etaEl.textContent = 'Генерация остановлена';
    } else {
      etaEl.textContent = 'Генерация завершена!';
    }
  }
  if (doneEl) doneEl.textContent = `✓ ${savedSlots}`;
  if (errEl) { errEl.textContent = `✗ ${failedSlots}`; errEl.style.display = failedSlots > 0 ? 'inline' : 'none'; }

  // RC-3 FIX: Counter shows processedCount / totalCount (not total/total)
  const cntEl2 = document.getElementById('progress-counter');
  if (cntEl2) cntEl2.textContent = `${processedCount}/${totalCount}`;

  // ── RC-5, RC-6 FIX: Honest banner with guarded buttons ──
  const controls = document.querySelector('.progress-controls-compact');
  if (controls) {
    let bannerClass = 'banner-success';
    let bannerIcon = '🐾';
    let bannerText = '';

    if (allPerfect) {
      bannerText = `Мур! Все ${savedSlots}/${totalSlots} изображений сохранены!`;
    } else if (totalFailure && wasStopped) {
      bannerClass = 'banner-warning';
      bannerIcon = '⏹';
      bannerText = `Остановлено до сохранения. 0/${totalSlots} изображений.`;
    } else if (totalFailure) {
      bannerClass = 'banner-error';
      bannerIcon = '❌';
      bannerText = `Ошибка: ни одного изображения не сохранено (0/${totalSlots}).`;
    } else if (wasStopped && !hasProblems) {
      bannerClass = 'banner-warning';
      bannerIcon = '⏹';
      bannerText = `Остановлено: сохранено ${savedSlots}/${totalSlots} изображений.`;
    } else if (hasProblems) {
      bannerClass = 'banner-warning';
      bannerIcon = '⚠️';
      bannerText = `Сохранено ${savedSlots}/${totalSlots} изображений, не удалось: ${failedSlots}.`;
    } else {
      bannerText = `Готово: ${savedSlots}/${totalSlots} изображений.`;
    }

    // RC-6 FIX: Retry button shows retryable PROMPT count, not slot count
    const retryablePrompts = state.promptStatuses.filter(p =>
      p.status === 'error' || p.status === 'partial' || p.status === 'stopped'
    ).length;

    const retryBtn = retryablePrompts > 0
      ? `<button class="btn btn-secondary" onclick="retryFailedSlots()" style="margin-left:8px">🔄 Добить упавшие (${retryablePrompts})</button>`
      : '';

    // RC-5 FIX: "Перейти к отбору" only when there are saved images
    const selectionBtn = savedSlots > 0
      ? `<button class="btn btn-primary" onclick="goToSelection()">Перейти к отбору</button>`
      : `<button class="btn btn-secondary" onclick="navigateTo('settings')">← Назад к настройкам</button>`;

    controls.innerHTML = `
      <div class="banner ${bannerClass}" style="width: 100%; margin: 0; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span class="banner-icon">${bannerIcon}</span>
        <span class="banner-text" style="flex:1">${bannerText}</span>
        ${selectionBtn}
        ${retryBtn}
      </div>
    `;
  }

  renderPromptStatusList();

  // ── Sync finished statuses to project json — HONEST mapping ──
  const statusMap = new Map();
  state.promptStatuses.forEach(p => statusMap.set(String(p.id), p.status));

  let needsSave = false;
  state.importedPrompts.forEach(p => {
    const newStatus = statusMap.get(String(p.id));
    if (newStatus === 'done') {
      if (p.status !== 'completed') { p.status = 'completed'; needsSave = true; }
    } else if (newStatus === 'partial') {
      // FIX: partial ≠ completed — leave as 'pending' so re-run picks it up
      if (p.status !== 'pending') { p.status = 'pending'; needsSave = true; }
    } else if (newStatus === 'error') {
      if (p.status !== 'error') { p.status = 'error'; needsSave = true; }
    }
    // 'stopped' prompts stay as-is (pending)
  });

  if (needsSave && activeProjectId && window.electronAPI) {
    window.electronAPI.projects.savePrompts(activeProjectId, state.importedPrompts, state.importedFilePath).catch(console.error);
  }

  // FIX L1 (completion): Set project status based on generation outcome
  if (activeProjectId && window.electronAPI) {
    let newProjectStatus;
    if (allPerfect) {
      newProjectStatus = 'completed';
    } else if (savedSlots > 0) {
      newProjectStatus = 'in_progress'; // partial success, needs retry or selection
    } else {
      newProjectStatus = 'draft'; // total failure, back to square one
    }
    window.electronAPI.projects.update(activeProjectId, { status: newProjectStatus }).catch(console.error);
    const proj = projectsList.find(p => p.id === activeProjectId);
    if (proj) proj.status = newProjectStatus;
  }

  // Populate results screen counters
  updateResultsCounters();
}

// ── Selection ──
function goToSelection() {
  // RC-5 FIX: Guard — don't navigate to selection if no images were saved
  const savedSlots = state.promptStatuses.reduce((sum, p) => sum + (p.savedCount || p.imagesGenerated || 0), 0);
  if (savedSlots === 0) {
    _showToast('⚠️', 'Нет сохранённых изображений для отбора.', 'error');
    return;
  }
  initSelection();
  navigateTo('selection');
}

/**
 * FIX U3: Helper — returns only prompts that have successfully generated images.
 * Filters importedPrompts to those whose status in promptStatuses is 'done' or 'partial'
 * (i.e., at least some images exist on disk).
 * Falls back to all importedPrompts if no generation has been run yet.
 */
function _selectablePrompts() {
  // FIX L6: Only use MOCK_PROMPTS in browser dev mode
  const allPrompts = state.importedPrompts.length > 0
    ? state.importedPrompts
    : (!window.electronAPI ? MOCK_PROMPTS.map(p => ({ id: String(p.id), prompt: p.text })) : []);

  // If no generation results, return all prompts (pre-generation state)
  if (!state.promptStatuses || state.promptStatuses.length === 0) {
    return allPrompts.map((p, i) => ({ ...p, _origIdx: i }));
  }

  // Build a set of prompt IDs that have at least 1 saved image
  const successIds = new Set();
  for (const ps of state.promptStatuses) {
    const saved = ps.savedCount ?? ps.imagesGenerated ?? 0;
    if (saved > 0 || ps.status === 'done' || ps.status === 'partial') {
      successIds.add(String(ps.id));
    }
  }

  // If all prompts failed, fall back to all (so user can see something)
  if (successIds.size === 0) {
    return allPrompts.map((p, i) => ({ ...p, _origIdx: i }));
  }

  // Filter to successful ones, preserving original index for image loading
  return allPrompts
    .map((p, i) => ({ ...p, _origIdx: i }))
    .filter(p => successIds.has(String(p.id)));
}

function initSelection() {
  // ── Restore persisted selections if available ──
  const project = activeProjectId ? projectsList.find(p => p.id === activeProjectId) : null;
  if (project && project.selections && Object.keys(project.selections).length > 0) {
    state.selections = { ...project.selections };
    state.selectionCurrentPrompt = typeof project.selectionCurrentPrompt === 'number'
      ? project.selectionCurrentPrompt : 0;
    console.log(`[persist] Restored ${Object.keys(state.selections).length} selections, currentPrompt=${state.selectionCurrentPrompt}`);
  } else {
    state.selectionCurrentPrompt = 0;
    state.selections = {};
  }
  state.selectionInitialized = true;
  // FIX U3: Cache selectable prompts for this session
  state._selectablePromptsCache = _selectablePrompts();
  renderSelectionMinimap();
  renderSelectionContent();
  updateSelectionCounter();
}

function renderSelectionMinimap() {
  const minimap = document.getElementById('selection-minimap');
  if (!minimap) return;

  // FIX U3: Use only selectable (successful) prompts
  const prompts = state._selectablePromptsCache || _selectablePrompts();
  minimap.innerHTML = prompts.map((p, i) => {
    let cls = 'mini-map-dot';
    if (i === state.selectionCurrentPrompt) cls += ' current';
    else if (state.selections[i] !== undefined) cls += ' selected-done';
    else cls += ' unselected';
    return `<div class="${cls}" onclick="jumpToPrompt(${i})">${i + 1}</div>`;
  }).join('');
}

function renderSelectionContent() {
  const i = state.selectionCurrentPrompt;
  // FIX U3: Use only selectable (successful) prompts
  const prompts = state._selectablePromptsCache || _selectablePrompts();
  const promptData = prompts[i];
  if (!promptData) return;

  const selCurrentEl = document.getElementById('sel-current');
  const selTotalEl = document.getElementById('sel-total');
  const selPromptEl = document.getElementById('sel-prompt-text');

  if (selCurrentEl) selCurrentEl.textContent = i + 1;
  if (selTotalEl) selTotalEl.textContent = prompts.length;
  if (selPromptEl) selPromptEl.textContent = promptData.prompt || promptData.text || '';

  // Update prev/next buttons
  const prevBtn = document.getElementById('btn-prev-prompt');
  const nextBtn = document.getElementById('btn-next-prompt');
  if (prevBtn) prevBtn.disabled = i === 0;
  if (nextBtn) nextBtn.disabled = i === prompts.length - 1;

  // Render image grid — try loading real images first
  const grid = document.getElementById('selection-image-grid');
  if (!grid) return;

  // FIX: Adapt grid columns to images-per-prompt
  grid.className = 'image-grid';
  if (state.imagesPerPrompt === 1) grid.classList.add('cols-1');
  else if (state.imagesPerPrompt === 2) grid.classList.add('cols-2');

  // FIX U3: Use _origIdx for image loading (maps to folder index on disk)
  const diskIdx = promptData._origIdx !== undefined ? promptData._origIdx : i;

  const api = window.electronAPI;
  if (api && activeProjectId) {
    // Load real images from project
    api.projects.getImages(activeProjectId, diskIdx).then(result => {
      if (result.success && result.images.length > 0) {
        renderRealImages(grid, i, result.images);
      } else {
        renderPlaceholderImages(grid, i);
      }
    }).catch(() => renderPlaceholderImages(grid, i));
  } else {
    renderPlaceholderImages(grid, i);
  }
}

function renderRealImages(grid, promptIdx, images) {
  const selectedImg = state.selections[promptIdx];
  grid.innerHTML = images.map((img, imgIdx) => {
    const isSelected = selectedImg === imgIdx;
    return `
      <div class="image-card ${isSelected ? 'selected' : ''}" onclick="selectImage(${promptIdx}, ${imgIdx})">
        <img src="${img.dataUrl}" alt="Вариант ${imgIdx + 1}" style="width:100%; height:100%; object-fit:cover; border-radius: inherit;">
        <div class="image-card-number">Вариант ${imgIdx + 1}</div>
      </div>
    `;
  }).join('');
}

function renderPlaceholderImages(grid, promptIdx) {
  const colors = IMAGE_COLORS[promptIdx] || IMAGE_COLORS[0];
  const selectedImg = state.selections[promptIdx];
  const renderCount = state.imagesPerPrompt || 4;
  grid.innerHTML = colors.slice(0, renderCount).map((color, imgIdx) => {
    const isSelected = selectedImg === imgIdx;
    return `
      <div class="image-card ${isSelected ? 'selected' : ''}" onclick="selectImage(${promptIdx}, ${imgIdx})" style="background: linear-gradient(135deg, ${color}, ${lightenColor(color, 30)});">
        <div class="image-card-number">Вариант ${imgIdx + 1}</div>
      </div>
    `;
  }).join('');
}

function selectImage(promptIdx, imageIdx) {
  state.selections[promptIdx] = imageIdx;
  renderSelectionContent();
  renderSelectionMinimap();
  updateSelectionCounter();
  saveProjectState();

  // FIX U3: Use selectable prompts for auto-advance
  const selectablePrompts = state._selectablePromptsCache || _selectablePrompts();
  const totalPrompts = selectablePrompts.length;
  // Auto-advance to next prompt after a short delay
  if (promptIdx < totalPrompts - 1) {
    setTimeout(() => {
      // FIX: Only auto-advance if still on the same prompt (user might have clicked minimap)
      if (state.selectionCurrentPrompt === promptIdx) {
        nextPrompt();
      }
    }, 500);
  }
}

function updateSelectionCounter() {
  const count = Object.keys(state.selections).length;
  const selCountEl = document.getElementById('sel-count');
  const selCountTotalEl = document.getElementById('sel-count-total');
  const btn = document.getElementById('btn-finish-selection');

  if (selCountEl) selCountEl.textContent = count;
  // FIX U3: Total is based on selectable prompts (only those with images)
  const selectablePrompts = state._selectablePromptsCache || _selectablePrompts();
  const totalPrompts = selectablePrompts.length;
  if (selCountTotalEl) selCountTotalEl.textContent = totalPrompts;
  // FIX U2: Allow finishing with partial selections (at least 1 selected)
  if (btn) btn.disabled = count === 0;
}

function prevPrompt() {
  if (state.selectionCurrentPrompt > 0) {
    state.selectionCurrentPrompt--;
    renderSelectionContent();
    renderSelectionMinimap();
    saveProjectState();
  }
}

function nextPrompt() {
  // FIX U3: Navigate within selectable prompts only
  const selectablePrompts = state._selectablePromptsCache || _selectablePrompts();
  const totalPrompts = selectablePrompts.length;
  if (state.selectionCurrentPrompt < totalPrompts - 1) {
    state.selectionCurrentPrompt++;
    renderSelectionContent();
    renderSelectionMinimap();
    saveProjectState();
  }
}

function jumpToPrompt(index) {
  // FIX U3: Navigate within selectable prompts only
  const selectablePrompts = state._selectablePromptsCache || _selectablePrompts();
  const totalPrompts = selectablePrompts.length;
  if (index >= 0 && index < totalPrompts) {
    state.selectionCurrentPrompt = index;
    renderSelectionContent();
    renderSelectionMinimap();
    saveProjectState();
  }
}

async function finishSelection() {
  // Save selections to project folder
  const api = window.electronAPI;
  if (api && activeProjectId && Object.keys(state.selections).length > 0) {
    try {
      const result = await api.projects.saveSelection(activeProjectId, state.selections);
      console.log(`[app] Saved ${result.copied} selected images`);
    } catch (err) {
      console.error('[app] Save selection error:', err);
    }
  }
  updateResultsCounters();
  navigateTo('results');
}

// ── Results Counters ──
function updateResultsCounters() {
  // FIX L6: Only use MOCK_PROMPTS in browser dev mode
  const prompts = state.importedPrompts.length > 0
    ? state.importedPrompts
    : (!window.electronAPI ? MOCK_PROMPTS : []);
  const promptCount = prompts.length;
  const doneCount = state.promptStatuses.filter(p => p.status === 'done').length;
  const totalImages = state.promptStatuses.reduce((sum, p) => sum + p.imagesGenerated, 0);
  const selectedCount = Object.keys(state.selections).length;

  const resPrompts = document.getElementById('res-prompts');
  const resGenerated = document.getElementById('res-generated');
  const resSelected = document.getElementById('res-selected');

  if (resPrompts) resPrompts.textContent = promptCount;
  if (resGenerated) resGenerated.textContent = totalImages;
  if (resSelected) resSelected.textContent = selectedCount;
}

/**
 * FIX S4: Show a warning banner on Settings screen if generation is active.
 * Prevents user from changing settings mid-generation without realizing it.
 */
function _renderSettingsGenerationLock() {
  const screen = document.getElementById('screen-settings');
  if (!screen) return;

  // Remove existing lock banner if present
  const existing = document.getElementById('settings-gen-lock');
  if (existing) existing.remove();

  if (!state.isGenerating) return;

  const banner = document.createElement('div');
  banner.id = 'settings-gen-lock';
  banner.className = 'banner banner-warning';
  banner.style.cssText = 'margin-bottom: 16px; display:flex; align-items:center; gap:8px;';
  banner.innerHTML = `
    <span class="banner-icon">⚠️</span>
    <span class="banner-text" style="flex:1">Генерация в процессе. Изменения настроек применятся только к следующей генерации.</span>
    <button class="btn btn-secondary btn-sm" onclick="navigateTo('progress')">← К прогрессу</button>
  `;
  // Insert at top of settings screen
  const header = screen.querySelector('.screen-header');
  if (header) {
    header.parentNode.insertBefore(banner, header.nextSibling);
  } else {
    screen.prepend(banner);
  }
}

// ── Results ──
async function openResultsFolder() {
  const api = window.electronAPI;
  if (api && activeProjectId) {
    // FIX L3: Open the active project's folder (not root output dir)
    const project = projectsList.find(p => p.id === activeProjectId);
    if (project && project.folderName) {
      const info = await api.app.info();
      const projectPath = info.outputDir + '/' + project.folderName;
      await api.fs.openFolder(projectPath);
      return;
    }
  }
  if (api) {
    // Fallback: open root output dir
    const info = await api.app.info();
    await api.fs.openFolder(info.outputDir);
  } else {
    _showToast('📁', 'В реальном приложении здесь бы открылась папка', 'info');
  }
}

// ── Helper ──
function lightenColor(hex, percent) {
  if (!hex || typeof hex !== 'string') return 'rgb(200, 200, 200)'; // FIX: Guard
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return 'rgb(200, 200, 200)'; // FIX: Guard
  const num = parseInt(cleaned, 16);
  if (isNaN(num)) return 'rgb(200, 200, 200)'; // FIX: Guard
  const r = Math.min(255, (num >> 16) + percent);
  const g = Math.min(255, ((num >> 8) & 0x00FF) + percent);
  const b = Math.min(255, (num & 0x0000FF) + percent);
  return `rgb(${r}, ${g}, ${b})`;
}

// ══════════════════════════════════════════════════════════════
// FIRST LAUNCH WIZARD
// ══════════════════════════════════════════════════════════════

let wizardStep = 0;
let wizardChromeConnected = false;
let wizardOutputDir = '';

function wizardGoToStep(step) {
  wizardStep = step;
  // Update dots
  document.querySelectorAll('.wizard-dot').forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i < step) dot.classList.add('done');
    if (i === step) dot.classList.add('active');
  });
  // Update steps
  document.querySelectorAll('.wizard-step').forEach((s, i) => {
    s.classList.toggle('active', i === step);
  });
  // Step-specific init
  if (step === 1) wizardInitFolder();
  if (step === 2) wizardCheckChrome();
  if (step === 3) wizardInitSummary();
}

function wizardNext() { wizardGoToStep(wizardStep + 1); }
function wizardBack() { wizardGoToStep(wizardStep - 1); }

async function wizardInitFolder() {
  const api = window.electronAPI;
  if (api) {
    try {
      const dir = await api.config.get('outputDir');
      wizardOutputDir = dir || '~/Documents/Mews';
    } catch {
      wizardOutputDir = '~/Documents/Mews';
    }
  } else {
    wizardOutputDir = '~/Documents/Mews';
  }
  const pathEl = document.getElementById('wizard-folder-path');
  if (pathEl) pathEl.textContent = shortenPath(wizardOutputDir);
}

async function wizardSelectFolder() {
  const api = window.electronAPI;
  if (!api) return;
  try {
    const newDir = await api.config.selectOutputDir();
    if (newDir) {
      wizardOutputDir = newDir;
      const pathEl = document.getElementById('wizard-folder-path');
      if (pathEl) pathEl.textContent = shortenPath(newDir);
    }
  } catch (err) {
    console.error('[wizard] Folder selection error:', err);
  }
}

function shortenPath(p) {
  if (!p) return '—';
  const home = p.replace(/^\/Users\/[^/]+/, '~');
  return home;
}

async function wizardCheckChrome() {
  const api = window.electronAPI;
  const dot = document.getElementById('wizard-chrome-dot');
  const label = document.getElementById('wizard-chrome-label');
  const hint = document.getElementById('wizard-chrome-hint');
  const btn = document.getElementById('wizard-chrome-btn');
  const instructions = document.getElementById('wizard-instructions');
  const skipBtn = document.getElementById('wizard-skip-btn');
  const nextBtn = document.getElementById('wizard-next-chrome');

  if (!api) {
    dot.className = 'wizard-chrome-dot not-found';
    label.textContent = 'Electron не доступен';
    hint.textContent = 'Wizard работает только в приложении';
    return;
  }

  // Check if Chrome is installed
  dot.className = 'wizard-chrome-dot checking';
  label.textContent = 'Проверяю Chrome...';
  hint.textContent = '';

  try {
    const result = await api.chrome.checkInstalled();
    if (result.installed) {
      dot.className = 'wizard-chrome-dot found';
      label.textContent = 'Chrome найден';
      hint.textContent = 'Готов к подключению';
      btn.style.display = '';
      instructions.style.display = '';
    } else {
      dot.className = 'wizard-chrome-dot not-found';
      label.textContent = 'Chrome не найден';
      hint.textContent = 'Установите Google Chrome и попробуйте снова';
      btn.style.display = 'none';
    }
  } catch (err) {
    dot.className = 'wizard-chrome-dot not-found';
    label.textContent = 'Ошибка проверки';
    hint.textContent = err.message;
  }

  // Check if already connected (from phase 0 auto-connect)
  try {
    const status = await api.chrome.status();
    if (status.connected) {
      wizardChromeConnected = true;
      dot.className = 'wizard-chrome-dot connected';
      label.textContent = 'Chrome подключён ✓';
      hint.textContent = 'Сессия Higgsfield активна';
      btn.style.display = 'none';
      skipBtn.style.display = 'none';
      nextBtn.style.display = '';
    }
  } catch { }
}

async function wizardConnectChrome() {
  const api = window.electronAPI;
  if (!api) return;

  const dot = document.getElementById('wizard-chrome-dot');
  const label = document.getElementById('wizard-chrome-label');
  const hint = document.getElementById('wizard-chrome-hint');
  const btn = document.getElementById('wizard-chrome-btn');
  const skipBtn = document.getElementById('wizard-skip-btn');
  const nextBtn = document.getElementById('wizard-next-chrome');

  btn.disabled = true;
  dot.className = 'wizard-chrome-dot checking';
  label.textContent = 'Запускаю Chrome...';
  hint.textContent = 'Войдите в Higgsfield через Google';

  try {
    await api.chrome.launch();
    label.textContent = 'Жду авторизации...';
    hint.textContent = 'Войдите на higgsfield.ai, затем вернитесь сюда';

    // Poll for connection
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));

      try {
        const connectResult = await api.chrome.connect();
        if (connectResult.success) {
          await api.chrome.saveSession();
          const auth = await api.chrome.checkAuth();
          if (auth.authenticated) {
            wizardChromeConnected = true;
            dot.className = 'wizard-chrome-dot connected';
            label.textContent = 'Подключено! ✓';
            hint.textContent = 'Авторизация прошла успешно';
            btn.style.display = 'none';
            skipBtn.style.display = 'none';
            nextBtn.style.display = '';
            return;
          }
        }
      } catch { }

      label.textContent = `Жду авторизации... (${i + 1}/60)`;
    }

    // Timeout
    dot.className = 'wizard-chrome-dot not-found';
    label.textContent = 'Время ожидания истекло';
    hint.textContent = 'Попробуйте ещё раз или пропустите этот шаг';
    btn.disabled = false;
  } catch (err) {
    dot.className = 'wizard-chrome-dot not-found';
    label.textContent = 'Ошибка подключения';
    hint.textContent = err.message;
    btn.disabled = false;
  }
}

function wizardInitSummary() {
  const folderEl = document.getElementById('wizard-summary-folder');
  const chromeEl = document.getElementById('wizard-summary-chrome');
  if (folderEl) folderEl.textContent = shortenPath(wizardOutputDir);
  if (chromeEl) {
    chromeEl.textContent = wizardChromeConnected ? '✅ Подключён' : '⏭ Пропущено';
  }
}

async function wizardFinish() {
  const api = window.electronAPI;
  if (api) {
    try {
      await api.config.set('isFirstLaunch', false);
    } catch { }
  }
  // Hide wizard
  const overlay = document.getElementById('wizard-overlay');
  if (overlay) overlay.style.display = 'none';
  // Navigate to projects
  navigateTo('projects');
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {

  // ── First Launch Check ──
  const api = window.electronAPI;
  if (api) {
    try {
      const isFirstLaunch = await api.config.get('isFirstLaunch');
      if (isFirstLaunch === true || isFirstLaunch === undefined || isFirstLaunch === null) {
        const overlay = document.getElementById('wizard-overlay');
        if (overlay) overlay.style.display = 'flex';
        // Don't show app behind wizard
      }
    } catch (err) {
      console.warn('[app] Config check failed:', err);
    }
  }

  // Nav click handlers
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.screen);
    });
  });

  // Load real projects from disk
  await loadProjectsList();

  // ── Restore last session ─────────────────────────────────
  if (api) {
    try {
      const lastProjectId = await api.config.get('lastActiveProjectId');
      const lastImagesPerPrompt = await api.config.get('lastImagesPerPrompt');

      if (lastImagesPerPrompt && lastImagesPerPrompt !== 4) {
        state.imagesPerPrompt = lastImagesPerPrompt;
      }

      if (lastProjectId) {
        const project = projectsList.find(p => p.id === lastProjectId);
        if (project) {
          console.log(`[persist] Restoring session: project="${project.name}", id=${lastProjectId}`);
          // FIX S1: Fully restore project state including prompts by calling openProject-like logic
          activeProjectId = lastProjectId;
          if (project.selections) state.selections = { ...project.selections };
          if (typeof project.selectionCurrentPrompt === 'number') {
            state.selectionCurrentPrompt = project.selectionCurrentPrompt;
          }
          if (project.selectedModel) state.selectedModel = project.selectedModel;
          if (project.selectedQuality) state.selectedQuality = project.selectedQuality;
          if (project.selectedRatio) state.selectedRatio = project.selectedRatio;
          if (project.imagesPerPrompt) state.imagesPerPrompt = project.imagesPerPrompt;

          // FIX S1: Load prompts from project (was missing — Settings showed dropzone on restart)
          state.importedPrompts = project.prompts || [];
          state.promptCount = state.importedPrompts.length;
          if (state.importedPrompts.length > 0) {
            state.fileImported = true;
          }
          console.log(`[persist] Restored ${state.promptCount} prompts from project`);
        }
      }
    } catch (e) {
      console.warn('[persist] Session restore error:', e);
    }
  }

  // Init step indicator
  updateStepIndicator();
  updateNavStatuses();

  // FIX: Reset hardcoded progress values to clean state
  const pctEl = document.getElementById('progress-percent');
  const fillEl = document.getElementById('progress-bar-fill');
  const doneEl2 = document.getElementById('stat-done-chip');
  if (pctEl) pctEl.textContent = '0%';
  if (fillEl) fillEl.style.width = '0%';
  if (doneEl2) doneEl2.textContent = '✓ 0';

  // ── Electron: Check existing connection on startup ──
  // (api is already declared above in first-launch check)
  if (api) {
    try {
      const status = await api.chrome.status();
      console.log('[app] Chrome status:', JSON.stringify(status));

      if (status.chromeRunning) {
        // Chrome is running — try to connect CDP
        const connectResult = await api.chrome.connect();
        console.log('[app] CDP connect result:', JSON.stringify(connectResult));

        if (connectResult.success) {
          // Проверяем реальную авторизацию на Higgsfield
          const auth = await api.chrome.checkAuth();
          console.log('[app] Auth check on startup:', JSON.stringify(auth));

          if (auth.authenticated) {
            await api.chrome.saveSession();
            state.isConnected = true;
            updateConnectionUI();
            console.log('[app] ✅ Auto-connected and authenticated!');
          } else {
            console.log('[app] Chrome подключён, но пользователь НЕ авторизован на Higgsfield');
            // state.isConnected остаётся false — UI покажет «Не подключено»
          }
        }
      } else if (status.hasSession) {
        // Has saved session but Chrome not running — show hint
        console.log('[app] Session exists but Chrome not running');
      }
    } catch (err) {
      console.error('[app] Auto-connect error:', err);
    }

    // Show app version
    try {
      const info = await api.app.info();
      const versionEl = document.querySelector('.sidebar-footer-text');
      if (versionEl) versionEl.textContent = `Mews v${info.version}`;
    } catch { }
  }

  // ── Dismiss splash screen ──
  setTimeout(dismissSplash, 2500);

  // ── Request notification permission ──
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
});

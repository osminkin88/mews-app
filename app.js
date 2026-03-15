/* ============================================================
   HIGGSFIELD STUDIO — App Logic (v2 · Unlimited Models)
   ============================================================ */

// ── Higgsfield Models (Unlimited text-to-image only) ──
const MODELS = [
  { id: 'nano_banana_pro', name: 'Nano Banana Pro', desc: 'Google — flagship generation model', badge: 'Unlimited', quality: ['1K', '2K'], defaultQuality: '2K' },
  { id: 'gpt_image', name: 'GPT Image', desc: 'Versatile text-to-image AI', badge: 'Unlimited', quality: ['High'], defaultQuality: 'High' },
  { id: 'seedream_5_lite', name: 'Seedream 5.0 lite', desc: 'Intelligent visual reasoning', badge: 'Unlimited', quality: ['2K'], defaultQuality: '2K' },
  { id: 'seedream_4_5', name: 'Seedream 4.5', desc: 'ByteDance — next-gen 4K image model', badge: 'Unlimited', quality: ['2K'], defaultQuality: '2K' },
  { id: 'flux_2_pro', name: 'FLUX.2 Pro', desc: 'Speed-optimized detail', badge: 'Unlimited', quality: ['1K'], defaultQuality: '1K' },
  { id: 'kling_o1', name: 'Kling O1', desc: 'Kling\'s Photorealistic Image Model', badge: 'Unlimited', quality: ['1K'], defaultQuality: '1K' },
  { id: 'z_image', name: 'Z-Image', desc: 'Instant lifelike portraits', badge: 'Unlimited', quality: [], defaultQuality: null },
  { id: 'nano_banana', name: 'Nano Banana', desc: 'Google — standard generation model', badge: 'Unlimited', quality: [], defaultQuality: null },
  { id: 'higgsfield_soul', name: 'Higgsfield Soul', desc: 'Ultra-realistic fashion visuals', badge: 'Unlimited', quality: ['2K'], defaultQuality: '2K' },
];

// ── Aspect Ratios ──
const ASPECT_RATIOS = [
  { id: 'auto', label: 'Auto', w: 28, h: 28 },
  { id: '1:1', label: '1:1', w: 28, h: 28 },
  { id: '3:4', label: '3:4', w: 24, h: 32 },
  { id: '4:3', label: '4:3', w: 32, h: 24 },
  { id: '2:3', label: '2:3', w: 22, h: 34 },
  { id: '3:2', label: '3:2', w: 34, h: 22 },
  { id: '9:16', label: '9:16', w: 20, h: 36 },
  { id: '16:9', label: '16:9', w: 36, h: 20 },
  { id: '5:4', label: '5:4', w: 30, h: 24 },
  { id: '4:5', label: '4:5', w: 24, h: 30 },
  { id: '21:9', label: '21:9', w: 40, h: 18 },
];

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
  <button class="btn btn-secondary" id="btn-pause" onclick="togglePause()">
    ⏸ Пауза
  </button>
  <button class="btn btn-danger" onclick="stopGeneration()">
    ⏹ Остановить
  </button>
  <div style="flex: 1;"></div>
  <span class="text-secondary" id="eta-text">≈ 0 мин. осталось</span>
`;

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
  promptCount: 12,

  // Generation
  isGenerating: false,
  isPaused: false,
  generationProgress: 0,
  promptStatuses: [],
  currentPromptIndex: 0,
  currentImageIndex: 0,
  generationFinished: false,

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
};

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

  // Render dynamic quality options when visiting settings
  if (screenId === 'settings') {
    renderQualityOptions();
  }

  updateStepIndicator();
  updateNavStatuses();
}

function updateStepIndicator() {
  const dots = document.querySelectorAll('.step-dot');
  const label = document.querySelector('.step-label');

  dots.forEach((dot, i) => {
    dot.classList.remove('active', 'completed');
    if (i < state.currentStep) dot.classList.add('completed');
    if (i === state.currentStep) dot.classList.add('active');
  });

  label.textContent = `Шаг ${state.currentStep + 1} из 6`;
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
function createProject() {
  state.hasProjects = true;
  showProjectsList();
  navigateTo('connection');
}

function openProject(index) {
  navigateTo('connection');
}

function showProjectsList() {
  const emptyEl = document.getElementById('projects-empty');
  const listEl = document.getElementById('projects-list');
  if (emptyEl) emptyEl.style.display = 'none';
  if (listEl) listEl.style.display = 'block';
}

// ── Connection ──
async function connectAccount() {
  const api = window.electronAPI;
  if (!api) {
    // Mock mode (browser)
    state.isConnected = true;
    updateConnectionUI();
    setTimeout(() => navigateTo('settings'), 1200);
    return;
  }

  // Show connecting state
  const btn = document.querySelector('#connection-disconnected .btn-primary');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Запуск Chrome...';
  }

  try {
    // 1. Launch Chrome
    const launchResult = await api.chrome.launch();
    if (!launchResult.success) {
      alert(`❌ ${launchResult.error}`);
      if (btn) { btn.disabled = false; btn.innerHTML = '🔗 Подключиться к Higgsfield'; }
      return;
    }

    if (btn) btn.innerHTML = '<span class="spinner"></span> Залогиньтесь в Chrome...';

    // 2. Wait for user to login (poll every 3s for up to 3 min)
    let connected = false;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const connectResult = await api.chrome.connect();
      if (connectResult.success) {
        const auth = await api.chrome.checkAuth();
        if (auth.authenticated) {
          // Save session
          await api.chrome.saveSession();
          connected = true;
          break;
        }
      }
    }

    if (connected) {
      state.isConnected = true;
      updateConnectionUI();
      setTimeout(() => navigateTo('settings'), 800);
    } else {
      alert('⚠️ Таймаут подключения. Попробуйте снова.');
      if (btn) { btn.disabled = false; btn.innerHTML = '🔗 Подключиться к Higgsfield'; }
    }

  } catch (err) {
    alert(`❌ Ошибка: ${err.message}`);
    if (btn) { btn.disabled = false; btn.innerHTML = '🔗 Подключиться к Higgsfield'; }
  }
}

// FIX: Separate function to sync UI with connection state
function updateConnectionUI() {
  const disconnectedEl = document.getElementById('connection-disconnected');
  const connectedEl = document.getElementById('connection-connected');

  if (state.isConnected) {
    if (disconnectedEl) disconnectedEl.style.display = 'none';
    if (connectedEl) connectedEl.style.display = 'block';
    // Update sidebar nav status for connection
    const connNav = document.querySelector('.nav-item[data-screen="connection"] .nav-status');
    if (connNav) connNav.textContent = '✓';
    // Update footer to show connected state
    const footer = document.querySelector('.sidebar-footer-text');
    if (footer && !footer.textContent.includes('●')) {
      footer.textContent = '● Подключено  ·  ' + footer.textContent;
    }
  } else {
    if (disconnectedEl) disconnectedEl.style.display = 'block';
    if (connectedEl) connectedEl.style.display = 'none';
  }
}

// ── Settings ──
async function simulateImport() {
  if (state.fileImported) return; // FIX: Prevent double-import

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
    return;
  }

  try {
    // 1. Open native file dialog
    const filePath = await api.file.select();
    if (!filePath) return; // Cancelled

    // 2. Parse file
    const result = await api.file.import(filePath);
    if (!result.success) {
      alert(`❌ ${result.error}`);
      return;
    }

    // 3. Update state
    state.fileImported = true;
    state.importedPrompts = result.rows;
    state.importedFilePath = filePath;
    state.promptCount = result.count;

    // 4. Update UI
    document.getElementById('drop-zone').style.display = 'none';
    document.getElementById('file-info').style.display = 'flex';
    const countEl = document.getElementById('file-prompt-count');
    if (countEl) countEl.textContent = `${result.count} промптов`;
    const nameEl = document.getElementById('file-name');
    if (nameEl) nameEl.textContent = filePath.split('/').pop();

  } catch (err) {
    alert(`❌ Ошибка импорта: ${err.message}`);
  }
}

function selectModel(modelId) {
  state.selectedModel = modelId;
  const model = MODELS.find(m => m.id === modelId);
  if (model) {
    state.selectedQuality = model.defaultQuality;
  }
  renderQualityOptions();
  updateSettingsSummary();
}

function selectQuality(el, quality) {
  document.querySelectorAll('.quality-option').forEach(q => q.classList.remove('active'));
  el.classList.add('active');
  state.selectedQuality = quality;
  updateSettingsSummary();
}

function selectRatio(el, ratio) {
  document.querySelectorAll('.ratio-option').forEach(r => r.classList.remove('active'));
  el.classList.add('active');
  state.selectedRatio = ratio;
}

function renderQualityOptions() {
  const card = document.getElementById('quality-card');
  if (!card) return;

  const model = MODELS.find(m => m.id === state.selectedModel);
  if (!model || model.quality.length === 0) {
    // No quality options — hide card
    card.style.display = 'none';
    return;
  }

  card.style.display = '';
  const container = document.getElementById('quality-buttons');
  const hint = document.getElementById('quality-hint');
  if (!container) return;

  container.innerHTML = model.quality.map(q => {
    const isActive = q === state.selectedQuality ? 'active' : '';
    return `<div class="quality-option ${isActive}" onclick="selectQuality(this, '${q}')">
      <span class="quality-label">${q}</span>
    </div>`;
  }).join('');

  if (hint) {
    if (model.quality.length === 1) {
      hint.textContent = `${model.quality[0]} — Unlimited`;
    } else {
      hint.textContent = model.quality.map(q => q).join(' и ') + ' — без ограничений';
    }
  }
}

function updateSettingsSummary() {
  const model = MODELS.find(m => m.id === state.selectedModel);
  const modelInfoEl = document.getElementById('settings-model-info');
  if (modelInfoEl && model) {
    const qualityStr = state.selectedQuality ? ` · ${state.selectedQuality}` : '';
    modelInfoEl.textContent = `${model.name}${qualityStr} · Unlimited \ud83c\udd93`;
  }
}

// ── Generation ──
async function startGeneration() {
  // FIX: Clear any existing timer first
  if (state.generationTimer) {
    clearInterval(state.generationTimer);
    state.generationTimer = null;
  }

  state.isGenerating = true;
  state.isPaused = false;
  state.generationProgress = 0;
  state.currentPromptIndex = 0;
  state.currentImageIndex = 0;
  state.generationFinished = false;
  state.selectionInitialized = false; // Reset selection for new generation

  // Use real prompts if available, else mock
  const prompts = state.importedPrompts.length > 0
    ? state.importedPrompts
    : MOCK_PROMPTS.map(p => ({ id: String(p.id), prompt: p.text }));

  // Init prompt statuses
  state.promptStatuses = prompts.map((p, i) => ({
    id: p.id,
    text: p.prompt,
    status: i === 0 ? 'in-progress' : 'pending',
    imagesGenerated: 0,
  }));

  // FIX: Restore progress controls HTML (they may have been replaced by completion banner)
  const controls = document.querySelector('.progress-controls');
  if (controls) {
    controls.innerHTML = PROGRESS_CONTROLS_HTML;
  }

  // FIX: Reset progress UI to 0% immediately
  document.getElementById('progress-percent').textContent = '0%';
  document.getElementById('progress-bar-fill').style.width = '0%';
  document.getElementById('stat-done').textContent = '0';
  document.getElementById('stat-total').textContent = state.promptStatuses.length;
  document.getElementById('stat-images').textContent = '0';
  document.getElementById('stat-errors').textContent = '0';
  document.getElementById('current-prompt-text').textContent = state.promptStatuses[0].text;
  document.getElementById('current-image-sub').textContent = 'Изображение 1 из 4';

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
    const result = await api.generate.start(prompts, {
      model: state.selectedModel,
      aspect: state.selectedRatio,
      quality: state.selectedQuality,
    });

    if (!result.success) {
      alert(`❌ ${result.error}`);
      state.isGenerating = false;
    }
  } catch (err) {
    alert(`❌ Ошибка генерации: ${err.message}`);
    state.isGenerating = false;
  }
}

// Handle real-time progress events from backend
function handleGenerationProgress(data) {
  if (data.status === 'complete') {
    finishGeneration();
    return;
  }

  if (data.status === 'auth_error') {
    alert(`🔒 ${data.message}`);
    state.isGenerating = false;
    return;
  }

  if (data.current && data.total) {
    const idx = data.current - 1;

    // Update prompt statuses
    for (let i = 0; i < state.promptStatuses.length; i++) {
      if (i < idx) {
        state.promptStatuses[i].status = 'done';
        state.promptStatuses[i].imagesGenerated = 4;
      } else if (i === idx) {
        state.promptStatuses[i].status = 'in-progress';
        if (data.status === 'downloading') {
          state.promptStatuses[i].imagesGenerated = 3;
        }
      }
    }

    state.currentPromptIndex = idx;

    // Calculate progress
    const doneCount = state.promptStatuses.filter(p => p.status === 'done').length;
    state.generationProgress = Math.round((doneCount / data.total) * 100);

    // Update current prompt text
    const promptTextEl = document.getElementById('current-prompt-text');
    const imageSubEl = document.getElementById('current-image-sub');
    if (promptTextEl && data.prompt) promptTextEl.textContent = data.prompt;
    if (imageSubEl && data.message) imageSubEl.textContent = data.message;

    updateProgressUI();
    renderPromptStatusList();
  }
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

    if (current.imagesGenerated >= 4) {
      current.status = 'done';
      state.currentPromptIndex++;

      if (state.currentPromptIndex < state.promptStatuses.length) {
        state.promptStatuses[state.currentPromptIndex].status = 'in-progress';
        state.currentImageIndex = 0;
      }
    }

    // Calculate overall progress
    const totalImages = state.promptStatuses.length * 4;
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
  const doneEl = document.getElementById('stat-done');
  const imagesEl = document.getElementById('stat-images');

  if (!pctEl || !fillEl || !doneEl || !imagesEl) return; // FIX: Guard against missing elements

  const donePr = state.promptStatuses.filter(p => p.status === 'done').length;
  const doneImg = state.promptStatuses.reduce((sum, p) => sum + p.imagesGenerated, 0);

  pctEl.textContent = `${state.generationProgress}%`;
  fillEl.style.width = `${state.generationProgress}%`;
  doneEl.textContent = donePr;
  imagesEl.textContent = doneImg;

  // Current prompt text
  if (state.currentPromptIndex < state.promptStatuses.length) {
    const cp = state.promptStatuses[state.currentPromptIndex];
    const promptTextEl = document.getElementById('current-prompt-text');
    const imageSubEl = document.getElementById('current-image-sub');
    if (promptTextEl) promptTextEl.textContent = cp.text;
    if (imageSubEl) imageSubEl.textContent = `Генерация ${cp.imagesGenerated + 1} из 4 · Unlimited 🆓`;
  }

  // ETA
  const remaining = state.promptStatuses.length - state.promptStatuses.filter(p => p.status === 'done').length;
  const etaEl = document.getElementById('eta-text');
  if (etaEl) etaEl.textContent = `≈ ${remaining * 2} мин. осталось`;
}

function renderPromptStatusList() {
  const list = document.getElementById('prompt-status-list');
  if (!list) return; // FIX: Guard

  list.innerHTML = state.promptStatuses.map((p, i) => {
    const icons = {
      'pending': '<div class="status-icon pending">○</div>',
      'in-progress': '<div class="status-icon in-progress">◉</div>',
      'done': '<div class="status-icon done">🐾</div>',
      'error': '<div class="status-icon error">✗</div>',
    };
    const statusTexts = {
      'pending': 'Ожидание',
      'in-progress': `Генерация… ${p.imagesGenerated}/4 · Unlimited 🆓`,
      'done': 'Готово ✓',
      'error': 'Ошибка',
    };

    return `
      <li class="status-item ${p.status === 'in-progress' ? 'current' : ''}">
        ${icons[p.status]}
        <div class="status-text">
          <div class="status-text-title">${p.text}</div>
          <div class="status-text-sub">Промпт ${i + 1} · ${statusTexts[p.status]}</div>
        </div>
      </li>
    `;
  }).join('');
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
    try { await api.generate.stop(); } catch {}
  }

  // Mark remaining as done
  state.promptStatuses.forEach(p => {
    if (p.status === 'pending') { p.status = 'done'; p.imagesGenerated = 4; }
    if (p.status === 'in-progress') { p.status = 'done'; p.imagesGenerated = 4; }
  });
  state.generationProgress = 100;
  updateProgressUI();
  renderPromptStatusList();

  finishGeneration();
}

function finishGeneration() {
  // FIX: Prevent double finishing
  if (state.generationFinished) return;
  state.generationFinished = true;

  if (state.generationTimer) {
    clearInterval(state.generationTimer);
    state.generationTimer = null;
  }
  state.isGenerating = false;
  state.generationProgress = 100;

  // Update progress UI to show 100%
  const pctEl = document.getElementById('progress-percent');
  const fillEl = document.getElementById('progress-bar-fill');
  const etaEl = document.getElementById('eta-text');
  const doneEl = document.getElementById('stat-done');

  if (pctEl) pctEl.textContent = '100%';
  if (fillEl) fillEl.style.width = '100%';
  if (etaEl) etaEl.textContent = 'Генерация завершена!';
  if (doneEl) doneEl.textContent = state.promptStatuses.length;

  // Show completion banner
  const controls = document.querySelector('.progress-controls');
  if (controls) {
    controls.innerHTML = `
      <div class="banner banner-success" style="width: 100%; margin: 0;">
        <span class="banner-icon">🐾</span>
        <span class="banner-text">Мур! Все изображения сгенерированы. Переходите к отбору лучших →</span>
        <button class="btn btn-primary" onclick="goToSelection()">Перейти к отбору</button>
      </div>
    `;
  }
}

// ── Selection ──
function goToSelection() {
  initSelection();
  navigateTo('selection');
}

function initSelection() {
  state.selectionCurrentPrompt = 0;
  state.selections = {};
  state.selectionInitialized = true;
  renderSelectionMinimap();
  renderSelectionContent();
  updateSelectionCounter();
}

function renderSelectionMinimap() {
  const minimap = document.getElementById('selection-minimap');
  if (!minimap) return; // FIX: Guard

  minimap.innerHTML = MOCK_PROMPTS.map((p, i) => {
    let cls = 'mini-map-dot';
    if (i === state.selectionCurrentPrompt) cls += ' current';
    else if (state.selections[i] !== undefined) cls += ' selected-done';
    else cls += ' unselected';
    return `<div class="${cls}" onclick="jumpToPrompt(${i})">${i + 1}</div>`;
  }).join('');
}

function renderSelectionContent() {
  const i = state.selectionCurrentPrompt;
  const prompt = MOCK_PROMPTS[i];
  if (!prompt) return; // FIX: Guard against invalid index

  const selCurrentEl = document.getElementById('sel-current');
  const selTotalEl = document.getElementById('sel-total');
  const selPromptEl = document.getElementById('sel-prompt-text');

  if (selCurrentEl) selCurrentEl.textContent = i + 1;
  if (selTotalEl) selTotalEl.textContent = MOCK_PROMPTS.length;
  if (selPromptEl) selPromptEl.textContent = prompt.text;

  // Update prev/next buttons
  const prevBtn = document.getElementById('btn-prev-prompt');
  const nextBtn = document.getElementById('btn-next-prompt');
  if (prevBtn) prevBtn.disabled = i === 0;
  if (nextBtn) nextBtn.disabled = i === MOCK_PROMPTS.length - 1;

  // Render image grid
  const grid = document.getElementById('selection-image-grid');
  if (!grid) return; // FIX: Guard

  const colors = IMAGE_COLORS[i] || IMAGE_COLORS[0];
  const selectedImg = state.selections[i];

  grid.innerHTML = colors.map((color, imgIdx) => {
    const isSelected = selectedImg === imgIdx;
    return `
      <div class="image-card ${isSelected ? 'selected' : ''}" onclick="selectImage(${i}, ${imgIdx})" style="background: linear-gradient(135deg, ${color}, ${lightenColor(color, 30)});">
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

  // Auto-advance to next prompt after a short delay
  if (promptIdx < MOCK_PROMPTS.length - 1) {
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
  if (selCountTotalEl) selCountTotalEl.textContent = MOCK_PROMPTS.length;
  if (btn) btn.disabled = count < MOCK_PROMPTS.length;
}

function prevPrompt() {
  if (state.selectionCurrentPrompt > 0) {
    state.selectionCurrentPrompt--;
    renderSelectionContent();
    renderSelectionMinimap();
  }
}

function nextPrompt() {
  if (state.selectionCurrentPrompt < MOCK_PROMPTS.length - 1) {
    state.selectionCurrentPrompt++;
    renderSelectionContent();
    renderSelectionMinimap();
  }
}

function jumpToPrompt(index) {
  if (index >= 0 && index < MOCK_PROMPTS.length) { // FIX: Bounds check
    state.selectionCurrentPrompt = index;
    renderSelectionContent();
    renderSelectionMinimap();
  }
}

function finishSelection() {
  navigateTo('results');
}

// ── Results ──
async function openResultsFolder() {
  const api = window.electronAPI;
  if (api) {
    const info = await api.app.info();
    await api.fs.openFolder(info.outputDir);
  } else {
    alert('В реальном приложении здесь бы открылась папка с результатами');
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

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  // Nav click handlers
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.screen);
    });
  });

  // Show projects or empty state
  if (state.hasProjects) {
    showProjectsList();
  }

  // Init step indicator
  updateStepIndicator();
  updateNavStatuses();

  // FIX: Reset hardcoded progress values to clean state
  const pctEl = document.getElementById('progress-percent');
  const fillEl = document.getElementById('progress-bar-fill');
  const doneEl = document.getElementById('stat-done');
  const imagesEl = document.getElementById('stat-images');
  if (pctEl) pctEl.textContent = '0%';
  if (fillEl) fillEl.style.width = '0%';
  if (doneEl) doneEl.textContent = '0';
  if (imagesEl) imagesEl.textContent = '0';

  // ── Electron: Check existing connection on startup ──
  const api = window.electronAPI;
  if (api) {
    try {
      const status = await api.chrome.status();
      console.log('[app] Chrome status:', JSON.stringify(status));

      if (status.chromeRunning) {
        // Chrome is running — try to connect CDP
        const connectResult = await api.chrome.connect();
        console.log('[app] CDP connect result:', JSON.stringify(connectResult));

        if (connectResult.success) {
          // Save/refresh session
          const saveResult = await api.chrome.saveSession();
          console.log('[app] Session save result:', JSON.stringify(saveResult));

          state.isConnected = true;
          updateConnectionUI();
          console.log('[app] ✅ Auto-connected!');
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
      if (versionEl) versionEl.textContent = `Higgsfield Studio v${info.version}`;
    } catch {}
  }
});

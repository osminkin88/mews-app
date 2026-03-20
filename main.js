/* ============================================================
   HIGGSFIELD STUDIO — Electron Main Process
   ============================================================ */

const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// ── FORENSIC LOGGER ──────────────────────────────────────────
// Captures ALL console output with millisecond timestamps to a file.
// Uses app.getPath('logs') — works correctly in packaged builds and sandboxed environments.
// /tmp is unreliable in Hardened Runtime / macOS Sandbox.
let LOG_FILE = null; // resolved lazily after app.whenReady()

function _forensicLog(level, args) {
  if (!LOG_FILE) return; // not yet initialized — skip silently
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const line = `${ts} [${level}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf-8'); } catch(e) {}
}

const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
const _origWarn = console.warn.bind(console);

console.log = (...args) => { _origLog(...args); _forensicLog('LOG', args); };
console.error = (...args) => { _origErr(...args); _forensicLog('ERR', args); };
console.warn = (...args) => { _origWarn(...args); _forensicLog('WRN', args); };

// Called after app.whenReady() to initialize the log file path
function initForensicLog() {
  try {
    const { app } = require('electron');
    const logsDir = app.getPath('logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    LOG_FILE = path.join(logsDir, 'mews-forensic.log');
    fs.writeFileSync(LOG_FILE, `\n${'═'.repeat(80)}\n[FORENSIC LOG STARTED] ${new Date().toISOString()}\n${'═'.repeat(80)}\n`, 'utf-8');
    _origLog(`[main] Forensic log: ${LOG_FILE}`);
  } catch(e) {
    _origWarn('[main] Forensic log init failed:', e.message);
  }
}
// ─────────────────────────────────────────────────────────────

// ── Modules ──────────────────────────────────────────────────
const chrome = require('./chrome-manager');
const engine = require('./higgsfield-engine');
const { importFile } = require('./file-importer');
const config = require('./config-manager');
const { getUnlimitedModelList, resolveCompatibleSettings } = require('./model-capabilities');

// ── Constants ────────────────────────────────────────────────
const IS_DEV = !app.isPackaged;
const APP_NAME = 'Mews';

// Supported image extensions (ordered by preference: most common first)
const IMAGE_EXTENSIONS = ['.jpg', '.png', '.webp'];
const WINDOW_CONFIG = {
  width: 1440,
  height: 900,
  minWidth: 1024,
  minHeight: 700,
};

/**
 * Find a slot image file in a prompt directory, checking all supported formats.
 * Returns { filePath, ext, mime } or null if not found.
 */
function findSlotFile(dir, slotIndex) {
  for (const ext of IMAGE_EXTENSIONS) {
    const fp = path.join(dir, `gen_${slotIndex}${ext}`);
    if (fs.existsSync(fp)) {
      const mimeExt = ext.slice(1); // remove dot
      const mime = mimeExt === 'jpg' ? 'image/jpeg' : `image/${mimeExt}`;
      return { filePath: fp, ext: mimeExt, mime };
    }
  }
  return null;
}
// OUTPUT_DIR is now managed by config-manager
function getOutputDir() {
  return config.getOutputDir();
}

// ── Window ───────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    ...WINDOW_CONFIG,
    title: APP_NAME,
    icon: path.join(__dirname, 'icon.png'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 18 },
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadFile(path.join('v4', 'index.html'));
  console.log('[main] V4 renderer loaded');

  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App Lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
  // Initialize forensic log FIRST (needs app.getPath which requires app ready)
  initForensicLog();

  // Set macOS dock icon
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, 'icon.png'));
  }

  // ── macOS Application Menu ──
  // Standard macOS menu: App (About, Quit ⌘Q), Edit (copy/paste), Window, Help
  if (process.platform === 'darwin') {
    const template = [
      {
        label: APP_NAME,
        submenu: [
          { role: 'about', label: `О ${APP_NAME}` },
          { type: 'separator' },
          { role: 'services', label: 'Службы' },
          { type: 'separator' },
          { role: 'hide', label: `Скрыть ${APP_NAME}` },
          { role: 'hideOthers', label: 'Скрыть остальные' },
          { role: 'unhide', label: 'Показать все' },
          { type: 'separator' },
          { role: 'quit', label: `Завершить ${APP_NAME}` },
        ],
      },
      {
        label: 'Правка',
        submenu: [
          { role: 'undo', label: 'Отменить' },
          { role: 'redo', label: 'Повторить' },
          { type: 'separator' },
          { role: 'cut', label: 'Вырезать' },
          { role: 'copy', label: 'Копировать' },
          { role: 'paste', label: 'Вставить' },
          { role: 'selectAll', label: 'Выбрать все' },
        ],
      },
      {
        label: 'Окно',
        submenu: [
          { role: 'minimize', label: 'Свернуть' },
          { role: 'zoom', label: 'Увеличить' },
          { type: 'separator' },
          { role: 'close', label: 'Закрыть окно' },
          { type: 'separator' },
          { role: 'front', label: 'На передний план' },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Cleanup old trash on startup (non-blocking)
  setTimeout(() => {
    try { cleanupOldTrash(); } catch (e) { console.warn('[trash] cleanup error:', e.message); }
  }, 5000); // 5s delay to not block startup
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  // Save session before disconnecting — so auth cookies survive restart
  try {
    const saveResult = await chrome.saveSession();
    if (saveResult.success) {
      console.log(`[main] 💾 Session saved on quit (${saveResult.cookieCount} cookies)`);
    }
  } catch (e) {
    console.warn('[main] Session save on quit failed:', e.message);
  }
  await chrome.cleanup();
});

// ── Helper: Send to Renderer ─────────────────────────────────
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // FORENSIC: log what we send
    const snap = { status: data.status, step: data.step, current: data.current, total: data.total, message: (data.message || '').substring(0,60) };
    console.log(`[main] →renderer [${channel}]: ${JSON.stringify(snap)}`);
    mainWindow.webContents.send(channel, data);
  }
}

// =============================================================
//  TRASH — Safe soft-delete (move to _trash/, not rmSync)
// =============================================================

/**
 * Returns the _trash root directory: <outputDir>/_trash/
 * Created on first use.
 */
function getTrashDir() {
  const trashDir = path.join(config.ensureOutputDir(), '_trash');
  if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
  return trashDir;
}

/**
 * Move sourcePath to _trash/<humanReadableLabel>/
 * Label format: YYYY-MM-DD_HH-MM_<label> — so Finder shows it in chronological order.
 * Returns the trash destination path.
 */
function moveToTrash(sourcePath, label) {
  if (!fs.existsSync(sourcePath)) {
    console.warn(`[trash] Source not found, nothing to move: ${sourcePath}`);
    return null;
  }

  const trashDir = getTrashDir();
  const now = new Date();
  const datePart = now.toISOString().replace('T', '_').substring(0, 16).replace(/:/g, '-'); // YYYY-MM-DD_HH-MM
  const safeName = (label || path.basename(sourcePath))
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  const trashName = `${datePart}_${safeName}`;
  const trashDest = path.join(trashDir, trashName);

  try {
    // Prefer rename (atomic, instant) — fails across filesystems
    fs.renameSync(sourcePath, trashDest);
    console.log(`[trash] ✅ Moved to trash: ${path.basename(sourcePath)} → _trash/${trashName}`);
    return trashDest;
  } catch (renameErr) {
    // Cross-filesystem fallback: copy then delete
    console.warn(`[trash] rename failed (${renameErr.message}), falling back to copy+delete`);
    try {
      fs.cpSync(sourcePath, trashDest, { recursive: true });
      fs.rmSync(sourcePath, { recursive: true, force: true });
      console.log(`[trash] ✅ Copied+deleted to trash: _trash/${trashName}`);
      return trashDest;
    } catch (copyErr) {
      console.error(`[trash] ❌ Failed to move to trash: ${copyErr.message}`);
      return null;
    }
  }
}

/**
 * Delete _trash entries older than 30 days.
 * Called once at app startup (non-blocking, 5s delay).
 */
function cleanupOldTrash() {
  const trashDir = path.join(config.getOutputDir(), '_trash');
  if (!fs.existsSync(trashDir)) return;

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  let cleaned = 0;

  try {
    const entries = fs.readdirSync(trashDir);
    for (const entry of entries) {
      const entryPath = path.join(trashDir, entry);
      try {
        const stat = fs.statSync(entryPath);
        if (stat.mtimeMs < cutoff) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          cleaned++;
          console.log(`[trash] 🗑 Auto-cleaned old entry: ${entry}`);
        }
      } catch (e) {
        console.warn(`[trash] skip cleanup for ${entry}: ${e.message}`);
      }
    }
    if (cleaned > 0) {
      console.log(`[trash] cleanup done: ${cleaned} entries removed (>30 days old)`);
    }
  } catch (e) {
    console.warn('[trash] cleanup scan failed:', e.message);
  }
}


// =============================================================
//  IPC HANDLERS — Chrome Management
// =============================================================

ipcMain.handle('chrome:launch', async () => {
  return await chrome.launchChrome();
});

ipcMain.handle('chrome:connect', async () => {
  return await chrome.connectCDP();
});

ipcMain.handle('chrome:save-session', async () => {
  return await chrome.saveSession();
});

ipcMain.handle('chrome:status', async () => {
  return await chrome.getStatus();
});

ipcMain.handle('chrome:check-auth', async () => {
  return await chrome.checkAuth();
});

// =============================================================
//  IPC HANDLERS — File Import
// =============================================================

ipcMain.handle('file:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Таблицы', extensions: ['csv', 'xlsx', 'xls'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('file:import', async (event, filePath) => {
  return importFile(filePath);
});

ipcMain.handle('file:download-template', async () => {
  try {
    const templateSrc = path.join(__dirname, 'Шаблон_промптов.xlsx');
    if (!fs.existsSync(templateSrc)) {
      return { success: false, error: 'Файл шаблона не найден в папке приложения.' };
    }

    // Show native Save-As dialog so user picks destination
    const { dialog } = require('electron');
    const desktopPath = app.getPath('desktop');
    const result = await dialog.showSaveDialog(BrowserWindow.getAllWindows()[0], {
      title: 'Сохранить шаблон промптов',
      defaultPath: path.join(desktopPath, 'Шаблон_промптов.xlsx'),
      filters: [
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    fs.copyFileSync(templateSrc, result.filePath);
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// =============================================================
//  IPC HANDLERS — Generation
// =============================================================

ipcMain.handle('generate:start', async (event, { prompts, settings, projectId }) => {
  const { model, aspect, quality, imagesCount } = settings;

  // Route output to active prompt set's generated/ folder
  let baseOutputDir = config.ensureOutputDir();
  if (projectId) {
    const projects = loadProjects();
    const project = projects.find(p => p.id === projectId);
    if (project) {
      const activeSet = getActiveSet(project);
      if (activeSet) {
        baseOutputDir = path.join(getSetDir(project, activeSet.id), 'generated');
      } else {
        baseOutputDir = path.join(config.ensureOutputDir(), project.folderName || projectId, 'generated');
      }
      if (!fs.existsSync(baseOutputDir)) fs.mkdirSync(baseOutputDir, { recursive: true });
    }
  }

  // Check Chrome connection — must be connected AND have an active Higgsfield page
  const status = await chrome.getStatus();
  if (!status.cdpConnected) {
    // Try auto-connect (Chrome may already be running from a previous session)
    console.log('[main] generate:start — not connected, attempting auto-connect...');
    const connectResult = await chrome.connectCDP();
    if (!connectResult.success) {
      return {
        success: false,
        error: 'Chrome не подключён. Перейдите в раздел Подключение и нажмите «Подключиться».',
      };
    }
  }

  // Also check that we have an active page (not just CDP connection)
  const activePage = chrome.getActivePage();
  if (!activePage) {
    return {
      success: false,
      error: 'Страница Higgsfield не открыта. Нажмите «Открыть Higgsfield» в разделе Подключение.',
    };
  }

  // ── Auth preflight: verify actual Higgsfield sign-in ──
  // Soft check — let navigateToModel catch real auth failures with clear errors
  try {
    const auth = await chrome.checkAuth();
    if (!auth.authenticated) {
      // Only hard-block if we're definitely on a sign-in page
      if (auth.url && (auth.url.includes('sign-in') || auth.url.includes('login') || auth.url.includes('/auth/'))) {
        return {
          success: false,
          error: 'Вы не вошли в Higgsfield. Откройте Chrome и войдите в аккаунт.',
        };
      }
      // Otherwise just warn — model page navigation will be the real test
      console.warn('[main] Auth preflight: not authenticated, but proceeding — model navigation will verify');
    }
  } catch (authErr) {
    console.warn('[main] Auth preflight failed:', authErr.message);
    // Non-blocking: proceed if auth check itself crashes (CDP weirdness)
  }

  // Check model supports Unlimited
  if (!engine.UNLIMITED_MODELS[model]) {
    const blockedName = engine.PAID_ONLY_MODELS[model] || model;
    return {
      success: false,
      error: `Модель "${blockedName}" не поддерживает Unlimited. Используйте: ${Object.values(engine.UNLIMITED_MODELS).map(m => m.name).join(', ')}`,
    };
  }

  // ── All preflight checks passed — mark project as in_progress ──
  let projName = '';
  let setName = '';
  if (projectId) {
    const allProjects = loadProjects();
    const proj = allProjects.find(p => p.id === projectId);
    if (proj) {
      projName = proj.name || '';
      const activeSet = getActiveSet(proj);
      if (activeSet) {
        setName = activeSet.name || '';
      }
      if (proj.status !== 'in_progress') {
        proj.status = 'in_progress';
        saveProject(proj);
        console.log(`[main] project.status → in_progress for ${projectId}`);
      }
    }
  }

  // ── META-BASED CLASSIFY: determine what to do with each prompt ──
  // Source of truth = meta.json in each prompt's folder on disk.
  // This replaces the old resumeFromIndex-based slice.
  //
  // Actions per prompt:
  //   'skip'    — status === 'done': all slots saved, do not regenerate
  //   'partial' — status === 'partial' | 'partial_desync': some slots missing,
  //               DO NOT auto-regen (Stage 1). Log + skip. Stage 2 will add skipSlots.
  //   'run'     — no meta.json, or status in: preparing/generating/error/unknown → generate
  //
  // originalIndex on each prompt guarantees correct folder mapping (001, 002...)
  // regardless of which prompts are skipped.
  function classifyPrompt(promptFolderPath) {
    const metaPath = path.join(promptFolderPath, 'meta.json');
    if (!fs.existsSync(metaPath)) return 'run';
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const s = meta.status;

      if (s === 'done') return 'skip';
      if (s === 'partial' || s === 'partial_desync' || s === 'paused') return 'backfill';

      // ── BACKFILL CRASH DETECTION ──
      // Case 1: main.js wrote 'backfilling' marker, then crashed before saveIntermediateMeta
      if (s === 'backfilling') return 'backfill';

      // Case 2: saveIntermediateMeta overwrote meta during backfill (format: {images[], status:'in_progress'})
      // Detect by checking if any image in images[] has _backfillSkipped=true
      if (s === 'in_progress') {
        const images = meta.images || [];
        const hasBackfillSkipped = images.some(r => r._backfillSkipped === true);
        if (hasBackfillSkipped) return 'backfill'; // ← backfill crashed mid-session
        return 'run'; // ← normal in_progress (crash during regular run)
      }

      // preparing / generating / error / cancelled / unknown → re-run
      return 'run';
    } catch {
      return 'run'; // damaged meta → treat as not done
    }
  }

  // Annotate every prompt with its _action before the loop.
  // All prompts are kept (no slice) so originalIndex stays absolute.
  const effectivePrompts = prompts.map((p, i) => {
    const absIdx = p.originalIndex !== undefined ? p.originalIndex : i;
    const folderPath = path.join(baseOutputDir, String(absIdx + 1).padStart(3, '0'));
    const action = classifyPrompt(folderPath);
    return { ...p, _action: action, _absIdx: absIdx };
  });

  const skipCount     = effectivePrompts.filter(p => p._action === 'skip').length;
  const backfillCount = effectivePrompts.filter(p => p._action === 'backfill').length;
  const runCount      = effectivePrompts.filter(p => p._action === 'run').length;
  console.log(`[main] ▶️ Meta-classify results: skip=${skipCount}, backfill=${backfillCount}, run=${runCount} (total=${prompts.length})`);

  // Process each prompt sequentially
  console.log(`[main] ═══ GENERATE:START received ═══`);
  console.log(`[main] Prompts in full batch: ${prompts.length}, effective (to process now): ${effectivePrompts.length}`);
  console.log(`[main] projectId: ${projectId || 'NONE'}`);
  console.log(`[main] baseOutputDir: ${baseOutputDir}`);
  console.log(`[main] imagesPerPrompt: ${imagesCount || 4}`);
  effectivePrompts.forEach((p, i) => {
    const absIdx = p.originalIndex !== undefined ? p.originalIndex : i;
    console.log(`[main]   #${i + 1}: id=${p.id}, absIndex=${absIdx}, folder=${String(absIdx + 1).padStart(3, '0')}, text="${(p.prompt || 'EMPTY!').substring(0, 80)}"`);
  });

  // ── SESSION START: send summary to UI before any prompts are processed ──
  {
    const sessionMode = (runCount > 0 && backfillCount === 0 && skipCount === 0) ? 'normal'
      : (runCount === 0 && backfillCount === 0 && skipCount > 0) ? 'resume'
      : 'mixed';
    const parts = [];
    if (runCount > 0)      parts.push(`${runCount} ${runCount === 1 ? 'новый' : 'новых'}`);
    if (backfillCount > 0) parts.push(`${backfillCount} дозаполн${backfillCount === 1 ? 'ение' : 'ения'}`);
    if (skipCount > 0)     parts.push(`${skipCount} уже ${skipCount === 1 ? 'готов' : 'готовы'}`);
    const sessionStartMsg = `▶ Запуск: ${parts.join(' · ')}  (всего ${prompts.length})`;
    sendToRenderer('generate:progress', {
      step: 'session_start',
      sessionMode,
      runCount,
      backfillCount,
      skipCount,
      promptTotal: prompts.length,
      message: sessionStartMsg,
      projectId: projectId || null,
      projectName: projName,
      setName: setName,
    });
  }

  // Reset stop flags for this entire batch
  if (typeof engine.resetStopFlags === 'function') {
    engine.resetStopFlags();
  } else {
    engine.isGenerating = true; // Fallback for older versions if needed
  }

  const results = [];
  let crossPromptExcludeFingerprints = []; // Барьер: UUID от предыдущего промпта
  for (let i = 0; i < effectivePrompts.length; i++) {
    // Check if paused/cancelled by user
    if (engine.getShouldPause() || engine.getShouldCancel()) {
      const reason = engine.getShouldCancel() ? 'CANCEL' : 'PAUSE';
      console.log(`[main] ─── User pressed ${reason} before prompt ${i + 1}. Breaking. ───`);
      break;
    }

    const prompt = effectivePrompts[i];
    const runIndex = i + 1; // Index in the current generation batch (1-based) for UI sync
    // promptTotal shown in UI = full batch size so user sees "21 of 30", not "1 of 10"
    const uiPromptTotal = prompts.length;
    const folderIndex = prompt.originalIndex !== undefined ? prompt.originalIndex + 1 : runIndex; // Absolute index for folder mapping
    const targetCount = imagesCount || 4;
    
    const promptDir = path.join(baseOutputDir, String(folderIndex).padStart(3, '0'));
    // UI runIndex for display: if resuming, offset so user sees absolute position
    const uiRunIndex = prompt.originalIndex !== undefined ? prompt.originalIndex + 1 : runIndex;
    console.log(`\n[main] ┌── PROMPT ${uiRunIndex}/${uiPromptTotal} ──────────────────────────────`);
    console.log(`[main] │ id=${prompt.id}, absIndex=${folderIndex - 1} (folder: ${String(folderIndex).padStart(3, '0')})`);
    console.log(`[main] │ target: ${targetCount} images`);
    console.log(`[main] │ projectId: ${projectId || 'NONE'}`);
    console.log(`[main] │ outputDir: ${promptDir}`);
    console.log(`[main] │ text: "${(prompt.prompt || 'EMPTY!').substring(0, 60)}"`);
    console.log(`[main] └──────────────────────────────────────────────────`);

    // ── SKIP: prompt already done — read result from meta.json, fire fake 'done' event ──
    if (prompt._action === 'skip') {
      console.log(`[main] ⏭️  SKIP prompt ${uiRunIndex} — status: done (meta.json)`);
      let skipMeta = {};
      try { skipMeta = JSON.parse(fs.readFileSync(path.join(promptDir, 'meta.json'), 'utf8')); } catch {}
      results.push({
        idx: folderIndex,
        id: prompt.id,
        status: 'done',
        savedCount: skipMeta.saved_count || 0,
        failedCount: skipMeta.failed_count || 0,
        totalSlots: targetCount,
        slots: skipMeta.slots || [],
        _skipped: true,
      });
      // Advance progress bar so UI doesn't stall on skipped prompts
      sendToRenderer('generate:progress', {
        step: 'done',
        promptCurrent: uiRunIndex,
        promptTotal: uiPromptTotal,
        imagesPerPrompt: targetCount,
        message: `Промпт ${uiRunIndex}/${uiPromptTotal} — уже готов`,
        _skipped: true,
        _mode: 'resume',
      });
      continue;
    }

    // ── BACKFILL: partial prompt — dozzapolnyaem nedostayushchie sloty cherez skipSlots ──
    // This is NOT a normal run. Engine will skip already-saved slots and generate only missing ones.
    // Old meta is loaded as the source of truth. Final meta = merge(old slots + new slots).
    if (prompt._action === 'backfill') {
      console.log(`[main] 🔄 BACKFILL prompt ${uiRunIndex} — дозаполняем частичный промпт через skipSlots`);

      // ── Load old meta — source of truth for already-saved slots ──
      let oldMeta = {};
      try { oldMeta = JSON.parse(fs.readFileSync(path.join(promptDir, 'meta.json'), 'utf8')); } catch {}
      const oldSlots = oldMeta.slots || []; // [{slot, state, file, size, ...}]

      // Build skipSlots: slot numbers that are already saved — do NOT generate these
      const skipSlots = oldSlots
        .filter(s => s.state === 'saved' && s.file)
        .map(s => s.slot);
      const missingSlots = targetCount - skipSlots.length;

      console.log(`[main] 🔄 BACKFILL: saved slots=${skipSlots.join(',') || 'none'}, missing=${missingSlots}`);

      if (missingSlots <= 0) {
        // Nothing to backfill — all slots already saved, update meta to done
        console.log(`[main] ✅ BACKFILL: all slots already present — marking done`);
        oldMeta.status = 'done';
        saveMeta(promptDir, oldMeta);
        results.push({
          idx: folderIndex, id: prompt.id, status: 'done',
          savedCount: skipSlots.length, failedCount: 0,
          totalSlots: targetCount, slots: oldSlots, _backfillComplete: true,
        });
        sendToRenderer('generate:progress', {
          step: 'done', promptCurrent: uiRunIndex, promptTotal: uiPromptTotal,
          imagesPerPrompt: targetCount,
          message: `✅ Промпт ${uiRunIndex}/${uiPromptTotal}: все слоты уже есть — BACKFILL завершён`,
        });
        continue;
      }

      // ── Update meta to 'backfilling' state before engine call ──
      const backfillMeta = {
        ...oldMeta,
        status: 'backfilling',
        timestamps: { ...(oldMeta.timestamps || {}), backfill_started: new Date().toISOString() },
      };
      saveMeta(promptDir, backfillMeta);

      sendToRenderer('generate:progress', {
        promptCurrent: uiRunIndex, promptTotal: uiPromptTotal,
        promptText: prompt.prompt, imagesPerPrompt: targetCount,
        status: 'backfilling',
        _mode: 'backfill',
        message: `Промпт ${uiRunIndex}/${uiPromptTotal} — дозаполняю (${skipSlots.length} из ${targetCount} уже есть)`,
      });

      try {
        const backfillResult = await engine.generatePrompt(prompt.prompt, {
          model, aspect, quality,
          imagesCount: targetCount,
          outputDir: promptDir,
          excludeFingerprints: crossPromptExcludeFingerprints,
          skipSlots,        // ← engine skips these, injects pre-existing records
          existingSlots: oldSlots, // ← engine uses these to reconstruct imageResults for skipped slots
          onProgress: async (progress) => {
            const enriched = {
              promptCurrent: uiRunIndex, promptTotal: uiPromptTotal,
              promptText: prompt.prompt, imagesPerPrompt: targetCount,
              _mode: 'backfill', // tag all backfill slot events
              ...progress,
            };
            // Enrich real 'saved' events with preview (same as normal run)
            if (progress.step === 'saved' && progress.savedSlot && !progress._backfillSkipped) {
              try {
                await new Promise(r => setTimeout(r, 300));
                const found = findSlotFile(promptDir, progress.savedSlot);
                if (found) {
                  const data = await fs.promises.readFile(found.filePath);
                  enriched.previewDataUrl = `data:${found.mime};base64,${data.toString('base64')}`;
                  enriched.promptIndex = uiRunIndex;
                  enriched.slotIndex = progress.savedSlot;
                }
              } catch {}
            }
            sendToRenderer('generate:progress', enriched);
          },
        });

        // ── MERGE: combine old saved slots + new session results into final meta ──
        // imageResults from engine: _backfillSkipped=true slots come from existingSlots,
        // real slots come from this session. Together they represent the full picture.
        const newImages = backfillResult.images || [];

        // Build merged slots: for each slot index 1..targetCount, prefer new result
        // (may include _backfillSkipped=true), fall back to oldSlots record
        const mergedSlots = [];
        for (let s = 1; s <= targetCount; s++) {
          const fromNew = newImages.find(r => r.index === s);
          if (fromNew) {
            mergedSlots.push({
              slot: s,
              state: fromNew.state,
              file: fromNew.file || null,
              size: fromNew.size || null,
              quality: fromNew.quality || null,
              attempts: fromNew.attempts || 0,
              errorReason: fromNew.errorReason || null,
              _backfillSkipped: fromNew._backfillSkipped || false,
            });
          } else {
            // Should not happen (engine always fills all slots), but safe fallback
            const fromOld = oldSlots.find(o => o.slot === s);
            if (fromOld) mergedSlots.push(fromOld);
          }
        }

        const mergedSavedCount = mergedSlots.filter(s => s.state === 'saved').length;
        const mergedFailedCount = mergedSlots.filter(s => s.state === 'failed').length;
        const mergedFiles = mergedSlots.filter(s => s.state === 'saved' && s.file).map(s => s.file);
        const mergedStatus = mergedSavedCount >= targetCount ? 'done'
          : mergedSavedCount > 0 ? 'partial'
          : 'error';

        // Write final merged meta — full picture of all slots across all sessions
        const finalMeta = {
          ...oldMeta,
          status: mergedStatus,
          saved_count: mergedSavedCount,
          failed_count: mergedFailedCount,
          files: mergedFiles,
          slots: mergedSlots,
          error: mergedStatus !== 'done' ? `Backfill: saved ${mergedSavedCount}/${targetCount}` : null,
          timestamps: {
            ...(oldMeta.timestamps || {}),
            backfill_completed: new Date().toISOString(),
          },
        };
        saveMeta(promptDir, finalMeta);

        console.log(`[main] 🔄 BACKFILL prompt ${uiRunIndex}: merged=${mergedSavedCount}/${targetCount} saved, status=${mergedStatus}`);

        results.push({
          idx: folderIndex, id: prompt.id,
          status: mergedStatus,
          savedCount: mergedSavedCount,
          failedCount: mergedFailedCount,
          totalSlots: targetCount,
          slots: mergedSlots,
          _backfill: true,
        });

        sendToRenderer('generate:progress', {
          step: mergedStatus === 'done' ? 'done' : 'partial_skipped',
          promptCurrent: uiRunIndex, promptTotal: uiPromptTotal,
          imagesPerPrompt: targetCount,
          _mode: 'backfill',
          message: mergedStatus === 'done'
            ? `Промпт ${uiRunIndex}/${uiPromptTotal} — дозаполнен, все ${targetCount} варианта готовы`
            : `Промпт ${uiRunIndex}: дозаполнено ${mergedSavedCount}/${targetCount}`,
        });

      } catch (backfillErr) {
        console.error(`[main] ❌ BACKFILL ошибка prompt ${uiRunIndex}:`, backfillErr.message);

        // ── RECOVER: read current meta.json from disk ──
        // The engine may have updated it via saveIntermediateMeta (format: { images[], savedCount })
        // We must NOT fall back to oldMeta blindly — it would erase progress from this session.
        let diskMeta = {};
        try { diskMeta = JSON.parse(fs.readFileSync(path.join(promptDir, 'meta.json'), 'utf8')); } catch {}

        // diskMeta may be in engine format (images[]) or main.js format (slots[])
        // Normalize to slot records: [{slot, state, file, size}]
        const diskImages = diskMeta.images || diskMeta.slots || [];

        // Merge: for each slot 1..targetCount pick the best available record
        // Priority: disk (most recent, includes progress from this session) > oldSlots (pre-backfill)
        const recoveredSlots = [];
        for (let s = 1; s <= targetCount; s++) {
          // Find disk record (engine format uses .index, main.js format uses .slot)
          const fromDisk = diskImages.find(r => (r.index === s) || (r.slot === s));
          const fromOld  = oldSlots.find(o => o.slot === s);

          if (fromDisk) {
            // Normalize to main.js slot format
            recoveredSlots.push({
              slot:        s,
              state:       fromDisk.state,
              file:        fromDisk.file || null,
              size:        fromDisk.size || null,
              quality:     fromDisk.quality || null,
              attempts:    fromDisk.attempts || 0,
              errorReason: fromDisk.errorReason || null,
              _backfillSkipped: fromDisk._backfillSkipped || false,
            });
          } else if (fromOld && fromOld.state === 'saved') {
            // Fall back to pre-backfill record only for saved slots (safe ground)
            recoveredSlots.push(fromOld);
          } else {
            // Slot unknown — mark as error so next resume will try to backfill it
            recoveredSlots.push({ slot: s, state: 'error', file: null, errorReason: 'backfill_error' });
          }
        }

        const recoveredSaved  = recoveredSlots.filter(s => s.state === 'saved').length;
        const recoveredFailed = recoveredSlots.filter(s => s.state !== 'saved').length;
        const recoveredFiles  = recoveredSlots.filter(s => s.state === 'saved' && s.file).map(s => s.file);
        // Status: partial so next resume will trigger backfill again for missing slots
        const recoveredStatus = recoveredSaved >= targetCount ? 'done'
          : recoveredSaved > 0 ? 'partial'
          : 'error';

        const recoveredMeta = {
          ...oldMeta,                   // preserve prompt, model, aspect, resolution, timestamps
          status:       recoveredStatus,
          saved_count:  recoveredSaved,
          failed_count: recoveredFailed,
          files:        recoveredFiles,
          slots:        recoveredSlots,
          error:        `Backfill error: ${backfillErr.message}`,
          timestamps: {
            ...(oldMeta.timestamps || {}),
            backfill_error: new Date().toISOString(),
          },
        };
        saveMeta(promptDir, recoveredMeta);
        console.log(`[main] 🔄 BACKFILL crash recovery: saved=${recoveredSaved}/${targetCount}, status=${recoveredStatus}`);

        results.push({
          idx: folderIndex, id: prompt.id,
          status:      recoveredStatus,
          savedCount:  recoveredSaved,
          failedCount: recoveredFailed,
          totalSlots:  targetCount,
          slots:       recoveredSlots,
          _backfill:   true,
        });

        if (backfillErr.isFatal) {
          sendToRenderer('generate:progress', { status: 'fatal_error', message: backfillErr.message, errorReason: backfillErr.errorReason });
          break;
        }
      }

      continue;
    }

    // ── RUN: generate this prompt (no meta, error, preparing, generating) ──
    if (!fs.existsSync(promptDir)) {
      fs.mkdirSync(promptDir, { recursive: true });
    }

    // ── Build initial meta ──
    const meta = {

      id: prompt.id,
      prompt: prompt.prompt,
      status: 'preparing',
      target_count: targetCount,
      saved_count: 0,
      failed_count: 0,
      files: [],
      slots: [], // Per-slot detail (populated after engine returns)
      selected: null,
      error: null,
      model,
      aspect_ratio: aspect,
      resolution: quality,
      timestamps: {
        started: new Date().toISOString(),
        completed: null,
      },
      urls: [],
    };

    saveMeta(promptDir, meta);

    // Send progress to renderer
    sendToRenderer('generate:progress', {
      promptCurrent: uiRunIndex,
      promptTotal: uiPromptTotal,
      promptText: prompt.prompt,
      imagesPerPrompt: targetCount,
      status: 'generating',
      _mode: 'normal',
      message: `Промпт ${uiRunIndex}/${uiPromptTotal}...`,
    });

    // ── Single call to engine (engine handles per-slot retries internally) ──
    try {
      meta.status = 'generating';
      saveMeta(promptDir, meta);

      const result = await engine.generatePrompt(prompt.prompt, {
        model,
        aspect,
        quality,
        imagesCount: targetCount,
        outputDir: promptDir,
        excludeFingerprints: crossPromptExcludeFingerprints,
        onProgress: async (progress) => {
          const enriched = {
            // Prompt-level fields (never overwritten by engine)
            promptCurrent: uiRunIndex,
            promptTotal: uiPromptTotal,
            promptText: prompt.prompt,
            imagesPerPrompt: targetCount,
            _mode: 'normal', // tag all normal run slot events
            // Engine slot-level fields pass through as-is
            ...progress,
          };

          // Enrich 'saved' events with a base64 preview thumbnail (async)
          if (progress.step === 'saved' && progress.savedSlot) {
            try {
              // Small delay to ensure file is fully flushed to disk
              await new Promise(r => setTimeout(r, 300));
              const found = findSlotFile(promptDir, progress.savedSlot);
              if (found) {
                const data = await fs.promises.readFile(found.filePath);
                enriched.previewDataUrl = `data:${found.mime};base64,${data.toString('base64')}`;
                enriched.promptIndex = uiRunIndex;
                enriched.slotIndex = progress.savedSlot;
              } else {
                throw new Error(`Slot file not found: gen_${progress.savedSlot}.*`);
              }
            } catch (e) {
              // File may not exist yet — non-fatal, progress.js will show placeholder
              console.warn('[main] Preview read error (tile will show placeholder):', e.message);
              enriched.promptIndex = uiRunIndex;
              enriched.slotIndex = progress.savedSlot;
              
              // Deferred retry: try again after 1.5s to upgrade placeholder with real preview
              const retrySlot = progress.savedSlot;
              const retryPromptDir = promptDir;
              const retryRunIndex = uiRunIndex; // absolute prompt index for correct UI mapping
              setTimeout(async () => {
                try {
                  const retryFound = findSlotFile(retryPromptDir, retrySlot);
                  if (retryFound) {
                    const d = await fs.promises.readFile(retryFound.filePath);
                    sendToRenderer('generate:progress', {
                      step: 'saved',
                      promptCurrent: uiRunIndex,
                      promptTotal: uiPromptTotal,
                      promptIndex: uiRunIndex,
                      slotIndex: retrySlot,
                      savedSlot: retrySlot,
                      previewDataUrl: `data:${retryFound.mime};base64,${d.toString('base64')}`,
                      _retryUpgrade: true, // marker so progress.js doesn't duplicate log/progress
                    });
                    console.log(`[main] ✅ Deferred preview retry succeeded for slot ${retrySlot}`);
                  }
                } catch (_) { /* silent — placeholder stays */ }
              }, 1500);
            }
          }

          sendToRenderer('generate:progress', enriched);
        },
      });

      // ── МЕЖПРОМПТОВЫЙ БАРЬЕР (RC-3, RC-6, RC-DESYNC) ──
      // Ждём стабилизации ленты и фиксируем ТЕКУЩИЕ UUID для защиты следующего промпта
      if (i < effectivePrompts.length - 1 && !engine.getShouldPause() && !engine.getShouldCancel()) {
        console.log(`[main] ⏳ После промпта ${uiRunIndex}: ждём стабилизации ленты...`);
        const page = require('./chrome-manager').getActivePage();
        if (page) {
          const stabilityResult = await engine.waitForFeedStable(page, 45_000);

          // ── DESYNC DETECTION: verify no late arrivals ──
          // Wait 5s after stability, then re-snapshot and compare
          console.log(`[main] 🔍 Десинк-проверка: ждём 5с после стабильности...`);
          await new Promise(r => setTimeout(r, 5000));

          const postWaitUUIDs = await engine.snapshotFeedFingerprints(page, 10); // same depth as waitForFeedStable
          const inFlightAfter = await engine.countInFlightItems(page);

          // Check for late-arriving images (UUIDs that appeared during verification window)
          const stableUUIDs = new Set(stabilityResult.finalUUIDs);
          const lateUUIDs = postWaitUUIDs.filter(u => !stableUUIDs.has(u));

          if (lateUUIDs.length > 0 || inFlightAfter.total > 0) {
            const reason = lateUUIDs.length > 0 
              ? `${lateUUIDs.length} late UUID(s) detected after stability` 
              : `${inFlightAfter.total} in-flight items still active`;
            console.warn(`[main] ⚠️ BOUNDARY DESYNC (recoverable): ${reason}`);
            console.warn(`[main]    lateUUIDs: ${lateUUIDs.join(', ')}`);
            console.warn(`[main]    inFlight: Q=${inFlightAfter.queued} G=${inFlightAfter.generating}`);

            // ── QUARANTINE: isolate ambiguous results ──
            const quarantineDir = path.join(baseOutputDir, '..', '_desync_recovery');
            if (!fs.existsSync(quarantineDir)) fs.mkdirSync(quarantineDir, { recursive: true });

            // Write desync event log for post-mortem analysis
            const eventFile = path.join(quarantineDir, `desync_prompt_${runIndex}_${Date.now()}.json`);
            fs.writeFileSync(eventFile, JSON.stringify({
              timestamp: new Date().toISOString(),
              promptIndex: runIndex,
              promptText: prompt.prompt?.substring(0, 100),
              reason,
              lateUUIDs,
              inFlightAfter,
              stabilityResult: { stable: stabilityResult.stable, uuidCount: stabilityResult.finalUUIDs.length },
            }, null, 2));

            console.log(`[main] 📦 Десинк-событие записано: ${path.basename(eventFile)}`);

            // ── Mark prompt as partial_desync but preserve saved images ──
            const dsSavedImages = (result.images || []).filter(r => r.state === 'saved' && r.file);
            const dsFiles = dsSavedImages.map(r => path.basename(r.file));
            const dsSlots = (result.images || []).map(img => ({
              slot: img.index, state: img.state, file: img.file || null,
              attempts: img.attempts || 1, errorReason: img.errorReason || null, size: img.size || null,
            }));

            meta.status = 'partial_desync';
            meta.saved_count = result.savedCount || dsFiles.length;
            meta.failed_count = result.failedCount || 0;
            meta.files = dsFiles;
            meta.slots = dsSlots;
            meta.error = `Boundary desync: ${reason}. Late results quarantined.`;
            meta.error_reason = 'boundary_desync';
            meta.timestamps.completed = new Date().toISOString();
            saveMeta(promptDir, meta);

            // Notify renderer — recoverable, not fatal
            sendToRenderer('generate:progress', {
              step: 'boundary_desync',
              message: `⚠️ Десинк после промпта ${runIndex}: изолирую, продолжаю batch.`,
              promptCurrent: runIndex,
              promptTotal: prompts.length,
            });

            // ── RESYNC: wait for all in-flight to clear before continuing ──
            console.log(`[main] 🔄 Ресинк: жду полной очистки in-flight...`);
            const resyncDeadline = Date.now() + 60_000;
            while (Date.now() < resyncDeadline) {
              const inf = await engine.countInFlightItems(page);
              if (inf.total === 0) {
                console.log(`[main] ✅ Ресинк: in-flight очистился`);
                break;
              }
              console.log(`[main] ⏳ Ресинк: in-flight=${inf.total} (Q=${inf.queued} G=${inf.generating})`);
              await new Promise(r => setTimeout(r, 3000));
            }

            // Fresh boundary snapshot after resync — ALL images to avoid ambiguity
            crossPromptExcludeFingerprints = await engine.snapshotFeedFingerprints(page, 999);
            console.log(`[main] ✅ Ресинк завершён: ${crossPromptExcludeFingerprints.length} UUID зафиксировано для следующего промпта`);

            // Push result with saved data (no break — continue to next prompt)
            results.push({
              idx: folderIndex, id: prompt.id, status: 'partial_desync',
              savedCount: result.savedCount || dsFiles.length,
              failedCount: result.failedCount || 0,
              totalSlots: targetCount, slots: dsSlots,
              errorReason: 'boundary_desync',
            });
            continue; // ← KEY: continue loop instead of break
          }

          // Use FULL snapshot for exclude fingerprints — prevents ambiguity on next prompt
          crossPromptExcludeFingerprints = await engine.snapshotFeedFingerprints(page, 999);
          console.log(`[main] ✅ Барьер: зафиксировано ${crossPromptExcludeFingerprints.length} UUID для исключения (стабильно=${stabilityResult.stable})`);
        }
      }

      // Engine returns { images, savedCount, failedCount, stoppedCount, total, promptStatus }
      const savedImages = (result.images || []).filter(r => r.state === 'saved' && r.file);
      const files = savedImages.map(r => path.basename(r.file));
      const promptStatus = result.promptStatus || (files.length >= targetCount ? 'done' : files.length > 0 ? 'partial' : 'error');

      // Build slot detail for meta.json
      const slots = (result.images || []).map(img => ({
        slot: img.index,
        state: img.state,           // saved | failed | stopped
        file: img.file || null,
        attempts: img.attempts || 1,
        errorReason: img.errorReason || null,
        size: img.size || null,
      }));

      // Update meta.json with full slot detail
      meta.status = promptStatus;
      meta.saved_count = result.savedCount || files.length;
      meta.failed_count = result.failedCount || 0;
      meta.files = files;
      meta.slots = slots;
      meta.timestamps.completed = new Date().toISOString();
      meta.error = promptStatus !== 'done' ? `Saved ${files.length}/${targetCount}` : null;
      saveMeta(promptDir, meta);

      // Push enriched result for finishGeneration() in app.js
      results.push({
        idx: folderIndex,
        id: prompt.id,
        status: promptStatus,
        savedCount: result.savedCount || files.length,
        failedCount: result.failedCount || 0,
        totalSlots: targetCount,
        slots,
      });

      // ── Send per-prompt 'done' event so progress.js can advance bar deterministically ──
      sendToRenderer('generate:progress', {
        step: 'done',
        promptCurrent: uiRunIndex,
        promptTotal: uiPromptTotal,
        imagesPerPrompt: targetCount,
        message: `✅ Промпт ${uiRunIndex}/${uiPromptTotal} завершён — ${files.length}/${targetCount} сохранено`,
      });

      console.log(`[main] ┌── RESULT PROMPT ${uiRunIndex} ─────────────────────────`);
      console.log(`[main] │ status: ${promptStatus.toUpperCase()} → saved ${files.length}/${targetCount}`);
      console.log(`[main] │ failed: ${result.failedCount || 0} slots`);
      console.log(`[main] │ files: [${files.join(', ')}]`);
      console.log(`[main] │ folder: ${promptDir}`);
      console.log(`[main] └──────────────────────────────────────────────────`);


    } catch (err) {
      // Engine throws only for fatal errors (isFatal=true) or 0-saved non-stop case
      const isFatal = err.isFatal === true;
      const reason = err.errorReason || 'unknown';

      console.error(`[main] Prompt ${uiRunIndex} FAILED [fatal=${isFatal}, reason=${reason}]: ${err.message}`);

      // ── Recover slot data: prefer most complete source ──
      // Priority: 1) imageResults from error  2) disk meta  3) empty fallback
      let recoveredSlots = [];
      let recoveredSource = 'none';

      // Source 1: Engine attached imageResults to the error (Fix 1)
      if (err.imageResults && err.imageResults.length > 0) {
        recoveredSlots = err.imageResults.map(img => ({
          slot: img.index,
          state: img.state,
          file: img.file || null,
          attempts: img.attempts || 1,
          errorReason: img.errorReason || null,
          size: img.size || null,
        }));
        recoveredSource = 'error_object';
      }

      // Source 2: Intermediate meta on disk (engine writes it after every slot)
      if (recoveredSlots.length === 0) {
        try {
          const diskMeta = JSON.parse(fs.readFileSync(path.join(promptDir, 'meta.json'), 'utf8'));
          const diskImages = diskMeta.images || diskMeta.slots || [];
          if (diskImages.length > 0) {
            recoveredSlots = diskImages.map(r => ({
              slot: r.index || r.slot,
              state: r.state,
              file: r.file || null,
              attempts: r.attempts || 0,
              errorReason: r.errorReason || null,
              size: r.size || null,
            }));
            recoveredSource = 'disk_meta';
          }
        } catch {}
      }

      const recoveredSaved = recoveredSlots.filter(s => s.state === 'saved').length;
      const recoveredFailed = recoveredSlots.filter(s => s.state === 'failed').length;
      const recoveredFiles = recoveredSlots.filter(s => s.state === 'saved' && s.file).map(s => s.file);

      console.log(`[main] 🔧 Slot recovery: source=${recoveredSource}, slots=${recoveredSlots.length}, saved=${recoveredSaved}, failed=${recoveredFailed}`);

      meta.status = 'error';
      meta.error = err.message;
      meta.error_reason = reason;
      meta.slots = recoveredSlots;
      meta.saved_count = recoveredSaved;
      meta.failed_count = recoveredFailed;
      meta.files = recoveredFiles;
      meta.timestamps.completed = new Date().toISOString();
      saveMeta(promptDir, meta);

      results.push({ idx: folderIndex, id: prompt.id, status: 'error', error: err.message, errorReason: reason, slots: recoveredSlots });

      console.log(`[main] ┌── RESULT PROMPT ${uiRunIndex} ─────────────────────────`);
      console.log(`[main] │ status: ERROR [${reason}]`);
      console.log(`[main] │ fatal: ${isFatal}`);
      console.log(`[main] │ error: ${err.message}`);
      console.log(`[main] └──────────────────────────────────────────────────`);

      if (isFatal) {
        // Fatal error (auth expired, credits exhausted) — stop entire batch
        sendToRenderer('generate:progress', {
          status: reason === 'auth_error' ? 'auth_error' : 'fatal_error',
          message: err.message,
          errorReason: reason,
        });
        break; // Break the prompts loop
      }
    }

    // Check if paused/cancelled by user
    if (engine.getShouldPause() || engine.getShouldCancel()) {
      const wasCancelled = engine.getShouldCancel();
      const reason = wasCancelled ? 'CANCEL' : 'PAUSE';
      console.log(`[main] ─── User pressed ${reason} after prompt ${i + 1}. Breaking. ───`);

      if (projectId) {
        try {
          const resumeProjects = loadProjects();
          const resumeProj = resumeProjects.find(p => p.id === projectId);
          const resumeSet = resumeProj ? getActiveSet(resumeProj) : null;
          if (resumeSet) {
            if (wasCancelled) {
              // CANCEL: clear generationState → no resume banner, clean state
              delete resumeSet.generationState;
              resumeSet.status = 'cancelled';
              saveProject(resumeProj);
              console.log(`[main] ✕ Cancel: generationState cleared — no resume banner`);
            } else {
              // PAUSE: save generationState → resume banner in settings.js
              resumeSet.generationState = {
                stoppedAt: new Date().toISOString(),
                reason: 'paused',
                totalPrompts: prompts.length,
                settings: { model, aspect, quality, imagesCount },
              };
              resumeSet.status = 'paused';
              saveProject(resumeProj);
              console.log(`[main] ⏸ Pause marker saved for resume banner`);
            }
          }
        } catch (saveErr) {
          console.warn('[main] Could not save stop marker:', saveErr.message);
        }
      }

      break;
    }
  }

  // Reset engine state after the entire batch completes
  try { engine.resetStopFlags(); } catch {}
  // isGenerating was left true by generatePrompt — reset it now
  if (typeof engine.getIsGenerating === 'function') {
    // Direct module-level reset
    engine._resetIsGenerating && engine._resetIsGenerating();
  }

  // ── CLEAR RESUME STATE on full completion (not paused/cancelled) ──
  // If the batch ran to the end naturally, wipe generationState
  // so next launch starts fresh.
  if (!engine.getShouldPause() && !engine.getShouldCancel() && projectId) {
    try {
      const doneProjects = loadProjects();
      const doneProj = doneProjects.find(p => p.id === projectId);
      const doneSet = doneProj ? getActiveSet(doneProj) : null;
      if (doneSet && doneSet.generationState) {
        delete doneSet.generationState;
        if (doneSet.status === 'paused' || doneSet.status === 'cancelled') doneSet.status = 'completed';
        saveProject(doneProj);
        console.log('[main] ✅ Resume state cleared — batch completed fully');
      }
    } catch (clearErr) {
      console.warn('[main] Could not clear resume state:', clearErr.message);
    }
  }

  // ── FIX: Small delay before 'complete' so last 'saved'/'done' events propagate via IPC ──
  // Without this, the renderer can receive 'complete' before processing the final
  // progress events, leaving the bar stuck at <100%.
  await new Promise(r => setTimeout(r, 500));

  sendToRenderer('generate:progress', {
    status: 'complete',
    results,
  });

  return { success: true, results };
});

// Helper to save meta.json
function saveMeta(dir, meta) {
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify(meta, null, 2),
    'utf-8'
  );
}


ipcMain.handle('generate:pause', () => {
  console.log('[main] 🛑 ACTION RECEIVED: PAUSE (soft timeout) for current slot');
  sendToRenderer('generate:progress', { step: 'debug', message: '🛑 PAUSE REQUESTED: дожидаюсь текущего слота' });
  engine.pauseGeneration();
  return { success: true };
});

ipcMain.handle('generate:cancel', () => {
  console.log('[main] ✕ ACTION RECEIVED: CANCEL (hard timeout) for current slot');
  sendToRenderer('generate:progress', { step: 'debug', message: '✕ CANCEL REQUESTED: сбрасываю текущий слот' });
  engine.cancelGeneration();
  return { success: true };
});

// Backward compat alias: stop → pause
ipcMain.handle('generate:stop', () => {
  console.log('[main] 🛑 ACTION RECEIVED: STOP (alias for pause)');
  sendToRenderer('generate:progress', { step: 'debug', message: '🛑 STOP REQUESTED: дожидаюсь текущего слота' });
  engine.pauseGeneration();
  return { success: true };
});

// ── Get resume state — scans meta.json on disk, not resumeFromIndex ──
// Returns real counts: how many prompts are done, pending, partial.
// canResume: true if any prompt is not 'done' (= pending or partial).
ipcMain.handle('generate:get-resume-state', (event, { projectId }) => {
  if (!projectId) return { canResume: false };
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { canResume: false };
  const activeSet = getActiveSet(project);
  if (!activeSet) return { canResume: false };

  // Only show banner if we have a stop marker (user explicitly stopped)
  const genState = activeSet.generationState;
  if (!genState || !genState.stoppedAt) return { canResume: false };

  // Scan generated/ folder for prompt subdirs
  let baseGenDir;
  try {
    baseGenDir = path.join(getSetDir(project, activeSet.id), 'generated');
  } catch { return { canResume: false }; }
  if (!fs.existsSync(baseGenDir)) return { canResume: false };

  const totalPrompts = genState.totalPrompts || (activeSet.prompts?.length || 0);
  if (totalPrompts === 0) return { canResume: false };

  // Count statuses across all prompt folders (001, 002, ...)
  let doneCount = 0;
  let partialCount = 0;
  let pendingCount = 0;

  for (let i = 0; i < totalPrompts; i++) {
    const folder = path.join(baseGenDir, String(i + 1).padStart(3, '0'));
    const metaPath = path.join(folder, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      pendingCount++;
      continue;
    }
    try {
      const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (m.status === 'done') doneCount++;
      else if (m.status === 'partial' || m.status === 'partial_desync') partialCount++;
      else pendingCount++; // preparing / generating / error
    } catch {
      pendingCount++; // damaged meta
    }
  }

  // canResume: there's something left to generate
  const canResume = pendingCount > 0;
  // If everything is done or partial-only — no point showing resume
  if (!canResume && partialCount === 0) {
    // All done — clean up stop marker
    try {
      delete activeSet.generationState;
      if (activeSet.status === 'paused') activeSet.status = 'completed';
      saveProject(project);
    } catch {}
    return { canResume: false };
  }

  return {
    canResume,
    totalPrompts,
    doneCount,
    pendingCount,
    partialCount,
    stoppedAt: genState.stoppedAt,
    settings: genState.settings || null,
  };
});

// ── Clear resume state (user chose to start fresh instead of resuming) ──
ipcMain.handle('generate:clear-resume-state', (event, { projectId }) => {
  if (!projectId) return { success: false };
  try {
    const projects = loadProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return { success: false };
    const activeSet = getActiveSet(project);
    if (activeSet && activeSet.generationState) {
      delete activeSet.generationState;
      if (activeSet.status === 'paused') activeSet.status = 'draft';
      saveProject(project);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// =============================================================
//  IPC HANDLERS — Config
// =============================================================

ipcMain.handle('config:get', (event, key) => {
  return config.get(key);
});

ipcMain.handle('config:set', (event, { key, val }) => {
  config.set(key, val);
  return { success: true };
});

ipcMain.handle('config:get-all', () => {
  return config.get();
});

ipcMain.handle('config:select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Выберите папку для сохранения изображений',
    defaultPath: config.getOutputDir(),
  });
  if (result.canceled) return null;
  const newDir = result.filePaths[0];
  config.set('outputDir', newDir);
  return newDir;
});

ipcMain.handle('chrome:check-installed', () => {
  const chromePath = chrome.findChromePath();
  return {
    installed: !!chromePath,
    path: chromePath,
  };
});

ipcMain.handle('chrome:open-model-page', async () => {
  return chrome.openModelPage();
});

// =============================================================
//  IPC HANDLERS — Projects
// =============================================================

// ── Prompt Set Helpers ──
function generateSetId() {
  return 'set_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function sanitizeComponent(name, maxLength) {
  if (!name) return 'unnamed';
  let s = name.toString().toLowerCase();
  s = s.replace(/[^a-z0-9а-яё]/gi, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  if (!s) return 'unnamed';
  return s.substring(0, Math.min(maxLength, s.length));
}

function generateSetNames(project, baseName) {
  const existingFolders = (project.promptSets || []).map(s => (s.folderName || s.id).toLowerCase());
  const projPart = sanitizeComponent(project.name || project.folderName || 'project', 30);
  let cleanBaseName = (baseName || 'prompts').replace(/\.csv$|\.xlsx$/i, '').trim();
  const setPart = sanitizeComponent(cleanBaseName, 30);

  const baseFolder = `${projPart}__${setPart}`;

  let version = 1;
  while (true) {
    const candidateFolder = `${baseFolder}__v${version}`;
    const candidateUiName = `${cleanBaseName} v${version}`;

    if (!existingFolders.includes(candidateFolder.toLowerCase())) {
      const projectDir = path.join(config.ensureOutputDir(), project.folderName || project.id);
      const setDir = path.join(projectDir, 'sets', candidateFolder);
      if (!fs.existsSync(setDir)) {
        return { folderName: candidateFolder, uiName: candidateUiName };
      }
    }
    version++;
    if (version > 999) break;
  }

  const fallbackTime = Date.now().toString(36);
  return { 
    folderName: `${baseFolder}__v${version}_${fallbackTime}`, 
    uiName: `${cleanBaseName} v${version} (${fallbackTime})`
  };
}

function getActiveSet(project) {
  if (!project.promptSets || !project.activePromptSetId) return null;
  return project.promptSets.find(s => s.id === project.activePromptSetId) || null;
}

/**
 * Resolve disk path for a prompt set.
 * Uses set.folderName if available (new clean naming), falls back to set.id (old ugly naming).
 */
function getSetDir(project, setId) {
  const set = (project.promptSets || []).find(s => s.id === setId);
  const folder = set?.folderName || setId;
  return path.join(config.ensureOutputDir(), project.folderName || project.id, 'sets', folder);
}

/**
 * Migrate old flat-project to prompt-set model.
 * Moves generated/ and selected/ into sets/<migratedSetId>/.
 */
function migrateProjectToSets(project) {
  if (project.promptSets && project.promptSets.length > 0) return; // Already migrated
  if (!project.prompts || project.prompts.length === 0) {
    // No prompts yet — just initialize empty
    project.promptSets = [];
    project.activePromptSetId = null;
    delete project.prompts;
    delete project.promptCount;
    return;
  }

  const setId = generateSetId();
  const projectDir = path.join(config.ensureOutputDir(), project.folderName || project.id);
  const setDir = path.join(projectDir, 'sets', setId);

  // Create set directory
  fs.mkdirSync(setDir, { recursive: true });

  // Move generated/ → sets/<setId>/generated/
  const oldGenDir = path.join(projectDir, 'generated');
  const newGenDir = path.join(setDir, 'generated');
  if (fs.existsSync(oldGenDir)) {
    try { fs.renameSync(oldGenDir, newGenDir); } catch (e) {
      console.warn('[migration] Could not move generated/, copying instead:', e.message);
      try {
        fs.cpSync(oldGenDir, newGenDir, { recursive: true });
        fs.rmSync(oldGenDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  // Move selected/ → sets/<setId>/selected/
  const oldSelDir = path.join(projectDir, 'selected');
  const newSelDir = path.join(setDir, 'selected');
  if (fs.existsSync(oldSelDir)) {
    try { fs.renameSync(oldSelDir, newSelDir); } catch (e) {
      console.warn('[migration] Could not move selected/, copying instead:', e.message);
      try {
        fs.cpSync(oldSelDir, newSelDir, { recursive: true });
        fs.rmSync(oldSelDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  // Move prompts.csv if exists
  const oldCsv = path.join(projectDir, 'prompts.csv');
  if (fs.existsSync(oldCsv)) {
    try { fs.renameSync(oldCsv, path.join(setDir, 'prompts.csv')); } catch (_) {}
  }

  // Build prompt set from old flat fields
  const promptSet = {
    id: setId,
    name: project.sourceMeta?.originalFileName || 'Набор 1',
    prompts: project.prompts || [],
    promptCount: project.promptCount || project.prompts?.length || 0,
    sourceMeta: project.sourceMeta || null,
    status: project.status || 'draft',
    selections: project.selections || {},
    selectionCurrentPrompt: project.selectionCurrentPrompt || 0,
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  project.promptSets = [promptSet];
  project.activePromptSetId = setId;

  // Clean old flat fields
  delete project.prompts;
  delete project.promptCount;
  delete project.sourceMeta;
  delete project.selections;
  delete project.selectionCurrentPrompt;

  console.log(`[migration] Project "${project.name}" migrated to prompt-set model (setId=${setId})`);
}

function loadProjects() {
  const outputDir = config.getOutputDir();
  if (!fs.existsSync(outputDir)) return [];

  // Migration: If old `projects.json` exists in root, read it and distribute to folders
  const oldFile = path.join(outputDir, 'projects.json');
  if (fs.existsSync(oldFile)) {
    try {
      const oldData = JSON.parse(fs.readFileSync(oldFile, 'utf-8'));
      for (const p of oldData) {
        if (!p.folderName) continue;
        const projectDir = path.join(outputDir, p.folderName);
        if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
        
        const projectJsonPath = path.join(projectDir, 'project.json');
        if (!fs.existsSync(projectJsonPath)) {
          fs.writeFileSync(projectJsonPath, JSON.stringify(p, null, 2), 'utf-8');
        }
      }
      fs.renameSync(oldFile, path.join(outputDir, 'projects_backup.json'));
    } catch(err) {
      console.error('[projects] Migration error:', err);
    }
  }

  const folders = fs.readdirSync(outputDir).filter(f => {
    const fp = path.join(outputDir, f);
    return fs.statSync(fp).isDirectory();
  });
  const projects = [];

  for (const folder of folders) {
    const projectFile = path.join(outputDir, folder, 'project.json');
    if (fs.existsSync(projectFile)) {
      try {
        const projectData = JSON.parse(fs.readFileSync(projectFile, 'utf-8'));
        projectData.folderName = folder;

        // Auto-migrate old flat projects to prompt-set model
        if (!projectData.promptSets) {
          migrateProjectToSets(projectData);
          saveProject(projectData);
        }

        // --- ENRICHMENT FOR PROJECT LIST UX ---
        let stats = { generated: 0, selected: 0 };
        let coverUrl = null;

        const activeSet = getActiveSet(projectData);
        if (activeSet) {
          const setDir = getSetDir(projectData, activeSet.id);
          const selDir = path.join(setDir, 'selected');
          const genDir = path.join(setDir, 'generated');

          if (fs.existsSync(selDir)) {
            try {
              const selFiles = fs.readdirSync(selDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
              stats.selected = selFiles.length;
              if (selFiles.length > 0) {
                const p = path.join(selDir, selFiles[0]);
                const ext = path.extname(p).slice(1).toLowerCase();
                const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
                coverUrl = `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
              }
            } catch (_) {}
          }

          if (fs.existsSync(genDir)) {
            try {
              const subdirs = fs.readdirSync(genDir);
              for (const d of subdirs) {
                const dPath = path.join(genDir, d);
                if (fs.statSync(dPath).isDirectory()) {
                  const imgs = fs.readdirSync(dPath).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
                  stats.generated += imgs.length;
                  if (!coverUrl && imgs.length > 0) {
                    const p = path.join(dPath, imgs[0]);
                    const ext = path.extname(p).slice(1).toLowerCase();
                    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
                    coverUrl = `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
                  }
                }
              }
            } catch (_) {}
          }
        }
        
        projectData.stats = stats;
        projectData.coverUrl = coverUrl;
        // ----------------------------------------

        projects.push(projectData);
      } catch (e) {
        console.error(`[projects] Error reading ${projectFile}:`, e);
      }
    }
  }

  return projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function saveProject(project) {
  const outputDir = config.ensureOutputDir();
  if (!project.folderName) return;
  const projectDir = path.join(outputDir, project.folderName);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  const file = path.join(projectDir, 'project.json');
  fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf-8');
}

ipcMain.handle('projects:list', () => {
  return loadProjects();
});

ipcMain.handle('projects:create', (event, { name, icon }) => {
  const projects = loadProjects();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const folderName = sanitizeFolderName(name || 'Новый проект', projects);
  const project = {
    id,
    name: name || 'Новый проект',
    icon: icon || '🎬',
    folderName,
    createdAt: new Date().toISOString(),
    status: 'draft',
    model: config.get('selectedModel') || 'nano_banana_pro',
    promptSets: [],
    activePromptSetId: null,
  };
  
  const projectDir = path.join(config.ensureOutputDir(), folderName);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  saveProject(project);

  return project;
});

/**
 * Sanitize project name for use as folder name.
 * Preserves Cyrillic, Latin, numbers. Strips unsafe chars.
 * Adds numeric suffix if name already exists.
 */
function sanitizeFolderName(name, existingProjects) {
  // Replace unsafe filesystem chars, keep Cyrillic/Latin/digits/spaces/hyphens
  let safe = name
    .replace(/[<>:"/\\|?*]/g, '')   // remove unsafe
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim()
    .slice(0, 80);                  // limit length

  if (!safe) safe = 'Проект';

  // Check for collision with existing folder names
  const existingFolders = new Set(existingProjects.map(p => p.folderName).filter(Boolean));
  if (!existingFolders.has(safe)) return safe;

  // Add suffix
  for (let i = 2; i < 100; i++) {
    const candidate = `${safe} (${i})`;
    if (!existingFolders.has(candidate)) return candidate;
  }
  return `${safe}_${Date.now()}`;
}

ipcMain.handle('projects:delete', (event, { id }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === id);
  if (!project) return { success: false, error: 'Project not found' };

  // ── GUARD: block if any set is in_progress ──
  const inProgressSet = (project.promptSets || []).find(s => s.status === 'in_progress');
  if (inProgressSet) {
    return {
      success: false,
      error: `Генерация активна (набор «${inProgressSet.name}»). Остановите генерацию перед удалением проекта.`,
      reason: 'in_progress',
    };
  }

  // ── SAFE DELETE: move to trash instead of rmSync ──
  const folder = project.folderName || id;
  const projectDir = path.join(config.ensureOutputDir(), folder);
  const trashPath = moveToTrash(projectDir, project.name || folder);

  if (!trashPath && fs.existsSync(projectDir)) {
    // Should not happen, but log clearly if trash move failed
    console.error('[projects] trash move failed for project:', projectDir);
    return { success: false, error: 'Не удалось переместить в корзину. Проект не удалён.' };
  }

  console.log(`[projects] Project "${project.name}" moved to trash: ${trashPath || '(was missing)'}`);
  return { success: true, trashPath };
});

ipcMain.handle('projects:update', (event, { id, updates }) => {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return { success: false, error: 'Project not found' };

  const project = projects[idx];
  // Route selection keys into active prompt set, not project root
  const activeSet = getActiveSet(project);
  if (activeSet && (updates.selections !== undefined || updates.selectionCurrentPrompt !== undefined)) {
    if (updates.selections !== undefined) activeSet.selections = updates.selections;
    if (updates.selectionCurrentPrompt !== undefined) activeSet.selectionCurrentPrompt = updates.selectionCurrentPrompt;
    activeSet.updatedAt = new Date().toISOString();
    delete updates.selections;
    delete updates.selectionCurrentPrompt;
  }

  Object.assign(project, updates);
  saveProject(project);
  
  return { success: true, project };
});

// ── Save prompts to project folder ──
ipcMain.handle('projects:save-prompts', (event, { projectId, prompts, sourceFile }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const projectDir = path.join(config.ensureOutputDir(), project.folderName || projectId);
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  // Create a NEW prompt set (never overwrite existing)
  const sourceRawName = sourceFile ? require('path').basename(sourceFile) : 'prompts';
  const names = generateSetNames(project, sourceRawName);
  const setId = generateSetId();
  const setFolderName = names.folderName;
  const setDir = path.join(projectDir, 'sets', setFolderName);
  fs.mkdirSync(path.join(setDir, 'generated'), { recursive: true });
  fs.mkdirSync(path.join(setDir, 'selected'), { recursive: true });

  let sourceMeta = null;
  if (sourceFile && fs.existsSync(sourceFile)) {
    fs.copyFileSync(sourceFile, path.join(setDir, 'prompts.csv'));
    sourceMeta = {
      originalFileName: require('path').basename(sourceFile),
      importedAt: new Date().toISOString()
    };
  }

  const setNumber = (project.promptSets || []).length + 1;
  const promptSet = {
    id: setId,
    folderName: setFolderName,
    name: names.uiName,
    prompts,
    promptCount: prompts.length,
    sourceMeta,
    status: 'draft',
    selections: {},
    selectionCurrentPrompt: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!project.promptSets) project.promptSets = [];
  project.promptSets.push(promptSet);
  project.activePromptSetId = setId;
  saveProject(project);

  console.log(`[projects] New prompt set created: "${promptSet.name}" (${setId}), ${prompts.length} prompts`);
  return { success: true, count: prompts.length, setId };
});

// ── Load prompts from active prompt set ──
ipcMain.handle('projects:load-prompts', (event, { projectId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, prompts: [], promptSets: [] };

  const activeSet = getActiveSet(project);
  return {
    success: true,
    prompts: activeSet?.prompts || [],
    promptSets: (project.promptSets || []).map(s => ({
      id: s.id, name: s.name, promptCount: s.promptCount,
      status: s.status, createdAt: s.createdAt,
      archived: s.archived || false,
      archivedAt: s.archivedAt || null,
    })),
    activePromptSetId: project.activePromptSetId,
    sourceMeta: activeSet?.sourceMeta || null,
    selections: activeSet?.selections || {},
    selectionCurrentPrompt: activeSet?.selectionCurrentPrompt || 0,
  };
});

// ── Get prompt statuses for selective run UI ──
ipcMain.handle('projects:getPromptStatuses', (event, { projectId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, statuses: [] };

  const activeSet = getActiveSet(project);
  if (!activeSet || !activeSet.prompts) return { success: true, statuses: [] };

  const baseOutputDir = (() => {
    if (activeSet) {
      return path.join(getSetDir(project, activeSet.id), 'generated');
    }
    return path.join(config.ensureOutputDir(), project.folderName || project.id, 'generated');
  })();

  const statuses = activeSet.prompts.map((prompt, i) => {
    const absIdx = prompt.originalIndex !== undefined ? prompt.originalIndex : i;
    const folderPath = path.join(baseOutputDir, String(absIdx + 1).padStart(3, '0'));
    const metaPath = path.join(folderPath, 'meta.json');

    let status = 'pending'; // no generation yet
    let hasSelection = false;

    try {
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const s = meta.status;
        if (s === 'done') status = 'done';
        else if (s === 'partial' || s === 'partial_desync' || s === 'paused' || s === 'backfilling') status = 'partial';
        else if (s === 'error' || s === 'cancelled') status = 'error';
        else if (s === 'in_progress' || s === 'generating' || s === 'preparing') status = 'in_progress';

        // Check if this prompt has a selection
        hasSelection = !!(meta.selected);
      }
    } catch {}

    // Also check selections stored in the set itself
    if (!hasSelection && activeSet.selections) {
      const selKey = String(i);
      if (activeSet.selections[selKey] !== undefined && activeSet.selections[selKey] !== null) {
        hasSelection = true;
      }
    }

    return {
      index: i,
      originalIndex: absIdx,
      status,
      hasSelection,
      promptPreview: (prompt.prompt || '').substring(0, 80),
    };
  });

  return { success: true, statuses };
});

// ── Switch active prompt set ──
ipcMain.handle('projects:switch-set', (event, { projectId, setId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false };

  const targetSet = (project.promptSets || []).find(s => s.id === setId);
  if (!targetSet) return { success: false, error: 'Set not found' };

  // ── GUARD: block switching to an archived set ──
  if (targetSet.archived) {
    return { success: false, error: 'Нельзя переключиться на заархивированный набор. Сначала восстановите его из архива.', reason: 'archived' };
  }

  project.activePromptSetId = setId;
  saveProject(project);
  console.log(`[projects] Switched to prompt set: "${targetSet.name}" (${setId})`);
  return { success: true };
});

// ── Rename prompt set ──
ipcMain.handle('projects:rename-set', (event, { projectId, setId, newName }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const targetSet = (project.promptSets || []).find(s => s.id === setId);
  if (!targetSet) return { success: false, error: 'Set not found' };

  targetSet.name = newName;
  saveProject(project);
  console.log(`[projects] Renamed set to "${newName}" (${setId})`);
  return { success: true };
});

// ── Archive a prompt set (hide from main list, files untouched) ──
ipcMain.handle('projects:archive-set', (event, { projectId, setId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const targetSet = (project.promptSets || []).find(s => s.id === setId);
  if (!targetSet) return { success: false, error: 'Set not found' };

  // ── GUARD: block archiving of actively generating set ──
  if (targetSet.status === 'in_progress') {
    return {
      success: false,
      error: 'Набор сейчас генерируется. Остановите генерацию перед архивированием.',
      reason: 'in_progress',
    };
  }

  // Already archived — idempotent
  if (targetSet.archived) {
    return { success: true, wasActive: false, nextActiveSet: null };
  }

  // Mark as archived
  targetSet.archived = true;
  targetSet.archivedAt = new Date().toISOString();
  targetSet.updatedAt = new Date().toISOString();

  // ── If this was the active set, switch to next non-archived set ──
  const wasActive = project.activePromptSetId === setId;
  let nextActiveSet = null;

  if (wasActive) {
    const remaining = (project.promptSets || []).filter(s => s.id !== setId && !s.archived);
    if (remaining.length > 0) {
      // Pick the most recent non-archived set
      nextActiveSet = remaining[remaining.length - 1];
      project.activePromptSetId = nextActiveSet.id;
    } else {
      project.activePromptSetId = null;
      project.status = 'draft';
    }
  }

  saveProject(project);
  console.log(`[projects] Archived set "${targetSet.name}" (${setId})${wasActive ? `, switched active to: ${nextActiveSet?.name || 'none'}` : ''}`);
  return {
    success: true,
    wasActive,
    nextActiveSet: nextActiveSet ? { id: nextActiveSet.id, name: nextActiveSet.name } : null,
  };
});

// ── Unarchive a prompt set (restore to main list, does NOT auto-switch active) ──
ipcMain.handle('projects:unarchive-set', (event, { projectId, setId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const targetSet = (project.promptSets || []).find(s => s.id === setId);
  if (!targetSet) return { success: false, error: 'Set not found' };

  // Already not archived — idempotent
  if (!targetSet.archived) {
    return { success: true };
  }

  // Restore: remove archive flags
  targetSet.archived = false;
  delete targetSet.archivedAt;
  targetSet.updatedAt = new Date().toISOString();

  // Note: restore does NOT auto-switch active set — user does that manually
  saveProject(project);
  console.log(`[projects] Unarchived set "${targetSet.name}" (${setId})`);
  return { success: true };
});

// ── Delete a prompt set ──
ipcMain.handle('projects:delete-set', (event, { projectId, setId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const setIdx = (project.promptSets || []).findIndex(s => s.id === setId);
  if (setIdx === -1) return { success: false, error: 'Set not found' };

  const targetSet = project.promptSets[setIdx];

  // ── GUARD: block deletion of actively generating set ──
  if (targetSet.status === 'in_progress') {
    return {
      success: false,
      error: 'Набор сейчас генерируется. Остановите генерацию перед удалением.',
      reason: 'in_progress',
    };
  }

  // ── SAFE DELETE: move set folder to trash ──
  const setDir = getSetDir(project, setId);
  let trashPath = null;
  if (fs.existsSync(setDir)) {
    trashPath = moveToTrash(setDir, `${project.name} — ${targetSet.name}`);
    if (!trashPath) {
      console.error('[projects] trash move failed for set:', setDir);
      return { success: false, error: 'Не удалось переместить набор в корзину. Удаление отменено.' };
    }
  }

  // ── Determine which set becomes active after deletion ──
  let nextActiveSet = null;
  const wasActive = project.activePromptSetId === setId;

  project.promptSets.splice(setIdx, 1);

  if (wasActive) {
    if (project.promptSets.length > 0) {
      // Switch to last remaining set (descending recency)
      nextActiveSet = project.promptSets[project.promptSets.length - 1];
      project.activePromptSetId = nextActiveSet.id;
    } else {
      project.activePromptSetId = null;
      project.status = 'draft';
    }
  }

  saveProject(project);
  console.log(`[projects] Moved set "${targetSet.name}" (${setId}) to trash: ${trashPath || '(folder was missing)'}`);
  return {
    success: true,
    remainingSets: project.promptSets.length,
    trashPath,
    nextActiveSet: nextActiveSet ? { id: nextActiveSet.id, name: nextActiveSet.name } : null,
  };
});

// ── Duplicate Set as Active (Restart Generation from Zero) ──
ipcMain.handle('projects:duplicate-set-as-active', (event, { projectId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Проект не найден' };

  const activeSet = getActiveSet(project);
  if (!activeSet) return { success: false, error: 'Нет активного набора для копирования' };

  // Generate new set ID
  const newId = generateSetId();

  // Extract clean base name without any trailing " vN"
  let baseName = activeSet.name || 'prompts';
  baseName = baseName.replace(/ v\d+(\s*\(.*?\))?$/i, '').trim();

  const names = generateSetNames(project, baseName);

  // Clone prompts
  const clonedPrompts = (activeSet.prompts || []).map(p => ({ ...p }));

  const newSet = {
    id: newId,
    name: names.uiName,
    folderName: names.folderName,
    prompts: clonedPrompts,
    promptCount: clonedPrompts.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    selections: {},
    status: 'draft' // Starts pristine
  };

  project.promptSets.push(newSet);
  project.activePromptSetId = newId;
  
  // Clear project-level selection state tracking
  project.selections = {};
  project.selectionCurrentPrompt = 0;
  // Note: we don't wipe project.status so it remains in_progress or completed
  // but the active set is purely draft.

  saveProject(project);
  console.log(`[projects] Duplicated active set into new set: "${names.uiName}" (${newId}) for project ${projectId}`);
  return { success: true, newSetId: newId };
});

// ── Get generated images for a prompt ──
ipcMain.handle('projects:get-images', (event, { projectId, promptIndex }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, images: [] };

  const activeSet = getActiveSet(project);
  let promptDir;
  if (activeSet) {
    promptDir = path.join(getSetDir(project, activeSet.id), 'generated', String(promptIndex + 1).padStart(3, '0'));
  } else {
    const projectDir = path.join(config.ensureOutputDir(), project.folderName || projectId);
    promptDir = path.join(projectDir, 'generated', String(promptIndex + 1).padStart(3, '0'));
  }

  if (!fs.existsSync(promptDir)) return { success: true, images: [] };

  try {
    const files = fs.readdirSync(promptDir)
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort();

    const images = files.map(f => {
      const filePath = path.join(promptDir, f);
      const data = fs.readFileSync(filePath);
      const ext = path.extname(f).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return {
        name: f,
        path: filePath,
        dataUrl: `data:${mime};base64,${data.toString('base64')}`,
      };
    });

    // ── Read meta.json for backfill marker ──
    let wasBackfilled = false;
    try {
      const metaPath = path.join(promptDir, 'meta.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        wasBackfilled = !!(meta.timestamps && meta.timestamps.backfill_completed);
      }
    } catch { /* meta read failure is non-blocking */ }

    return { success: true, images, wasBackfilled };
  } catch (err) {
    console.error('[projects] get-images error:', err);
    return { success: false, images: [], wasBackfilled: false };
  }
});

// ── Save selection (scoped to active set) ──
ipcMain.handle('projects:save-selection', (event, { projectId, selections }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false };

  const activeSet = getActiveSet(project);
  let generatedBase, selectedDir;
  if (activeSet) {
    const sd = getSetDir(project, activeSet.id);
    generatedBase = path.join(sd, 'generated');
    selectedDir = path.join(sd, 'selected');
    // Persist selections in set
    activeSet.selections = selections;
    activeSet.status = 'completed';
    activeSet.updatedAt = new Date().toISOString();
  } else {
    const projectDir = path.join(config.ensureOutputDir(), project.folderName || projectId);
    generatedBase = path.join(projectDir, 'generated');
    selectedDir = path.join(projectDir, 'selected');
  }
  if (!fs.existsSync(selectedDir)) fs.mkdirSync(selectedDir, { recursive: true });

  let copied = 0;
  for (const [promptIdx, imageIdx] of Object.entries(selections)) {
    const promptDir = path.join(generatedBase, String(Number(promptIdx) + 1).padStart(3, '0'));
    if (!fs.existsSync(promptDir)) continue;

    const files = fs.readdirSync(promptDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
    const sourceFile = files[imageIdx];
    if (!sourceFile) continue;

    const ext = path.extname(sourceFile);
    const destName = `${String(Number(promptIdx) + 1).padStart(3, '0')}${ext}`;
    fs.copyFileSync(path.join(promptDir, sourceFile), path.join(selectedDir, destName));
    copied++;
  }

  project.status = 'completed';
  saveProject(project);

  return { success: true, copied };
});

// ── Get project path (scoped to active set) ──
ipcMain.handle('projects:get-project-path', (event, { projectId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, path: null };

  const activeSet = getActiveSet(project);
  if (activeSet) {
    return { success: true, path: getSetDir(project, activeSet.id) };
  }
  const projectDir = path.join(config.ensureOutputDir(), project.folderName || projectId);
  return { success: true, path: projectDir };
});

// ── Get selected images (scoped to active set) ──
ipcMain.handle('projects:get-selected-images', (event, { projectId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, images: [] };

  const activeSet = getActiveSet(project);
  let selectedDir;
  if (activeSet) {
    selectedDir = path.join(getSetDir(project, activeSet.id), 'selected');
  } else {
    selectedDir = path.join(config.ensureOutputDir(), project.folderName || projectId, 'selected');
  }

  if (!fs.existsSync(selectedDir)) return { success: true, images: [] };

  try {
    const files = fs.readdirSync(selectedDir)
      .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort();

    const images = files.map(f => {
      const filePath = path.join(selectedDir, f);
      const data = fs.readFileSync(filePath);
      const ext = path.extname(f).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return {
        name: f,
        path: filePath,
        dataUrl: `data:${mime};base64,${data.toString('base64')}`,
      };
    });

    return { success: true, images };
  } catch (err) {
    console.error('[projects] get-selected-images error:', err);
    return { success: false, images: [] };
  }
});

// ── Export selected images (scoped to active set) ──
ipcMain.handle('projects:export-selected', async (event, { projectId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Проект не найден' };

  const activeSet = getActiveSet(project);
  let selectedDir;
  if (activeSet) {
    selectedDir = path.join(getSetDir(project, activeSet.id), 'selected');
  } else {
    selectedDir = path.join(config.ensureOutputDir(), project.folderName || projectId, 'selected');
  }

  if (!fs.existsSync(selectedDir)) return { success: false, error: 'Папка selected не найдена' };

  try {
    const files = fs.readdirSync(selectedDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
    if (files.length === 0) return { success: false, error: 'Нет файлов для экспорта' };

    const { dialog, BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Экспорт финальных кадров',
      buttonLabel: 'Выбрать папку для экспорта',
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const targetDir = result.filePaths[0];
    let count = 0;
    for (const f of files) {
      fs.copyFileSync(path.join(selectedDir, f), path.join(targetDir, f));
      count++;
    }

    return { success: true, count, dest: targetDir };
  } catch (err) {
    console.error('[projects] export-selected error:', err);
    return { success: false, error: err.message };
  }
});

// ── Export selected images as ZIP (scoped to active set) ──
ipcMain.handle('projects:export-zip', async (event, { projectId, includePrompts }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Проект не найден' };

  const activeSet = getActiveSet(project);
  let selectedDir, promptsCsvPath;

  if (activeSet) {
    const sd = getSetDir(project, activeSet.id);
    selectedDir = path.join(sd, 'selected');
    promptsCsvPath = path.join(sd, 'prompts.csv');
  } else {
    const projectDir = path.join(config.ensureOutputDir(), project.folderName || projectId);
    selectedDir = path.join(projectDir, 'selected');
    promptsCsvPath = path.join(projectDir, 'prompts.csv');
  }

  if (!fs.existsSync(selectedDir)) {
    return { success: false, error: 'Папка selected не найдена' };
  }

  const imageFiles = fs.readdirSync(selectedDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
  if (imageFiles.length === 0) {
    return { success: false, error: 'Нет изображений для экспорта' };
  }

  // ── Build default ZIP filename ──
  const safeName = (s) => (s || '').replace(/[<>:"/\\|?*\s]+/g, '_').slice(0, 40);
  const dateStr = new Date().toISOString().slice(0, 10); // 2026-03-20
  const setName = activeSet?.name || 'set';
  const defaultName = `${safeName(project.name)}_${safeName(setName)}_${dateStr}.zip`;

  try {
    const { dialog, BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить ZIP',
      defaultPath: defaultName,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true };
    }

    const destPath = saveResult.filePath;

    // ── Create ZIP with archiver ──
    const archiver = require('archiver');
    const output = fs.createWriteStream(destPath);

    await new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);

      // Add selected images (flat, preserving original names)
      for (const f of imageFiles) {
        archive.file(path.join(selectedDir, f), { name: f });
      }

      // Optionally add prompts.csv
      if (includePrompts && fs.existsSync(promptsCsvPath)) {
        archive.file(promptsCsvPath, { name: 'prompts.csv' });
      }

      archive.finalize();
    });

    const count = imageFiles.length + (includePrompts && fs.existsSync(promptsCsvPath) ? 1 : 0);
    console.log(`[export-zip] ✅ Exported ZIP: ${imageFiles.length} images${includePrompts ? ' + prompts.csv' : ''} → ${destPath}`);
    return { success: true, count: imageFiles.length, includePrompts: !!(includePrompts && fs.existsSync(promptsCsvPath)), dest: destPath };

  } catch (err) {
    console.error('[projects] export-zip error:', err);
    return { success: false, error: err.message };
  }
});

// ── Cleanup generated variants after selection (move to trash) ──
/**
 * Count image files inside generated/<NNN>/ subdirs.
 * Used to report how many files were cleaned up.
 */
function countGeneratedFiles(generatedDir) {
  if (!fs.existsSync(generatedDir)) return 0;
  let count = 0;
  try {
    const subdirs = fs.readdirSync(generatedDir);
    for (const d of subdirs) {
      const dp = path.join(generatedDir, d);
      try {
        if (fs.statSync(dp).isDirectory()) {
          count += fs.readdirSync(dp).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).length;
        }
      } catch { /* skip unreadable subdir */ }
    }
  } catch { /* skip unreadable root */ }
  return count;
}

ipcMain.handle('projects:cleanup-generated', (event, { projectId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Проект не найден' };

  const activeSet = getActiveSet(project);
  if (!activeSet) return { success: false, error: 'Нет активного набора' };

  // ── GUARD: only completed sets can be cleaned ──
  if (activeSet.status !== 'completed') {
    return {
      success: false,
      error: 'Очистка доступна только после завершения отбора.',
      reason: 'not_completed',
    };
  }

  // ── GUARD: idempotent — already cleaned ──
  if (activeSet.generationCleaned) {
    return { success: true, alreadyClean: true, deletedCount: 0 };
  }

  const setDir = getSetDir(project, activeSet.id);
  const generatedDir = path.join(setDir, 'generated');
  const selectedDir = path.join(setDir, 'selected');

  // ── GUARD: selected/ must not be empty (finales must exist) ──
  let selectedCount = 0;
  if (fs.existsSync(selectedDir)) {
    try {
      selectedCount = fs.readdirSync(selectedDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).length;
    } catch { /* treat as 0 */ }
  }
  if (selectedCount === 0) {
    return {
      success: false,
      error: 'Нет финальных кадров в selected/. Завершите отбор перед очисткой.',
      reason: 'no_selected',
    };
  }

  // ── Nothing to clean — generated/ doesn't exist ──
  if (!fs.existsSync(generatedDir)) {
    activeSet.generationCleaned = true;
    activeSet.generationCleanedAt = new Date().toISOString();
    activeSet.updatedAt = new Date().toISOString();
    saveProject(project);
    return { success: true, alreadyClean: true, deletedCount: 0 };
  }

  // ── Count files before move (for reporting) ──
  const deletedCount = countGeneratedFiles(generatedDir);

  // ── SAFE DELETE: move generated/ to _trash/ ──
  const trashLabel = `${project.name} — ${activeSet.name} — черновики`;
  const trashPath = moveToTrash(generatedDir, trashLabel);

  if (!trashPath) {
    console.error('[cleanup] trash move failed for generated dir:', generatedDir);
    return { success: false, error: 'Не удалось переместить черновики в корзину. Очистка отменена.' };
  }

  // ── Mark set as cleaned ──
  activeSet.generationCleaned = true;
  activeSet.generationCleanedAt = new Date().toISOString();
  activeSet.updatedAt = new Date().toISOString();
  saveProject(project);

  console.log(`[cleanup] ✅ Moved generated/ to trash for set "${activeSet.name}" (${activeSet.id}): ${deletedCount} files → ${trashPath}`);
  return { success: true, deletedCount, trashPath };
});

// =============================================================
//  IPC HANDLERS — File System
// =============================================================

ipcMain.handle('fs:open-folder', async (event, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
    return true;
  }
  return false;
});

ipcMain.handle('fs:read-output', () => {
  const outputDir = getOutputDir();
  if (!fs.existsSync(outputDir)) return [];

  const folders = fs.readdirSync(outputDir)
    .filter(f => fs.statSync(path.join(outputDir, f)).isDirectory())
    .sort();

  const results = [];
  for (const folder of folders) {
    const metaPath = path.join(outputDir, folder, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        meta._folder = folder;
        meta._path = path.join(outputDir, folder);
        results.push(meta);
      } catch {}
    }
  }
  return results;
});

ipcMain.handle('fs:read-image', (event, imagePath) => {
  try {
    const data = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' :
                 ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

// FIX L4: Removed legacy fs:select-image handler — use projects:save-selection instead

// ── App Info ─────────────────────────────────────────────────
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  isPackaged: app.isPackaged,
  outputDir: getOutputDir(),
  chromePath: chrome.findChromePath(),
  appData: config.APP_DATA,
}));

ipcMain.handle('app:quit', () => {
  app.quit();
});

// ── Model Capabilities ──────────────────────────────────────
ipcMain.handle('models:get-unlimited-list', () => getUnlimitedModelList());
ipcMain.handle('models:resolve-settings', (event, settings) => resolveCompatibleSettings(settings));

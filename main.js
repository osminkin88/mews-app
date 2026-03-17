/* ============================================================
   HIGGSFIELD STUDIO — Electron Main Process
   ============================================================ */

const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// ── FORENSIC LOGGER ──────────────────────────────────────────
// Captures ALL console output with millisecond timestamps to a file.
const LOG_FILE = '/tmp/higgsfield-forensic.log';
try {
  // Clear log on startup
  fs.writeFileSync(LOG_FILE, `\n${'═'.repeat(80)}\n[FORENSIC LOG STARTED] ${new Date().toISOString()}\n${'═'.repeat(80)}\n`, 'utf-8');
} catch(e) {}

const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
const _origWarn = console.warn.bind(console);

function _forensicLog(level, args) {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const line = `${ts} [${level}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf-8'); } catch(e) {}
}

console.log = (...args) => { _origLog(...args); _forensicLog('LOG', args); };
console.error = (...args) => { _origErr(...args); _forensicLog('ERR', args); };
console.warn = (...args) => { _origWarn(...args); _forensicLog('WRN', args); };
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
const WINDOW_CONFIG = {
  width: 1440,
  height: 900,
  minWidth: 1024,
  minHeight: 700,
};
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
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

  // Check Chrome connection
  const status = await chrome.getStatus();
  if (!status.cdpConnected) {
    const connectResult = await chrome.connectCDP();
    if (!connectResult.success) {
      return { success: false, error: 'Chrome не подключён. Запустите Chrome и подключитесь.' };
    }
  }

  // ── Auth preflight: verify actual Higgsfield sign-in ──
  try {
    const auth = await chrome.checkAuth();
    if (!auth.authenticated) {
      const hint = auth.url && (auth.url.includes('sign-in') || auth.url.includes('login'))
        ? 'Откройте Chrome и войдите в аккаунт Higgsfield.'
        : 'Перейдите на higgsfield.ai в Chrome и войдите в аккаунт.';
      return {
        success: false,
        error: `Вы не вошли в Higgsfield. ${hint}`,
      };
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
  if (projectId) {
    const allProjects = loadProjects();
    const proj = allProjects.find(p => p.id === projectId);
    if (proj && proj.status !== 'in_progress') {
      proj.status = 'in_progress';
      saveProject(proj);
      console.log(`[main] project.status → in_progress for ${projectId}`);
    }
  }

  // Process each prompt sequentially
  console.log(`[main] ═══ GENERATE:START received ═══`);
  console.log(`[main] Prompts to process: ${prompts.length}`);
  console.log(`[main] projectId: ${projectId || 'NONE'}`);
  console.log(`[main] baseOutputDir: ${baseOutputDir}`);
  console.log(`[main] imagesPerPrompt: ${imagesCount || 4}`);
  prompts.forEach((p, i) => {
    const absIdx = p.originalIndex !== undefined ? p.originalIndex : i;
    console.log(`[main]   #${i + 1}: id=${p.id}, absIndex=${absIdx}, folder=${String(absIdx + 1).padStart(3, '0')}, text="${(p.prompt || 'EMPTY!').substring(0, 80)}"`);
  });

  // Reset stop flag for this entire batch
  if (typeof engine.resetShouldStop === 'function') {
    engine.resetShouldStop();
  } else {
    engine.isGenerating = true; // Fallback for older versions if needed
  }

  const results = [];
  let crossPromptExcludeFingerprints = []; // Барьер: UUID от предыдущего промпта
  for (let i = 0; i < prompts.length; i++) {
    // Check if stopped by user (only via explicit stop button)
    if (engine.getShouldStop()) {
      console.log(`[main] ─── User pressed STOP before prompt ${i + 1}. Breaking. ───`);
      break;
    }

    const prompt = prompts[i];
    const runIndex = i + 1; // Index in the current generation batch (1-based) for UI sync
    const folderIndex = prompt.originalIndex !== undefined ? prompt.originalIndex + 1 : runIndex; // Absolute index for folder mapping
    const targetCount = imagesCount || 4;
    
    const promptDir = path.join(baseOutputDir, String(folderIndex).padStart(3, '0'));
    console.log(`\n[main] ┌── PROMPT ${runIndex}/${prompts.length} ──────────────────────────────`);
    console.log(`[main] │ id=${prompt.id}, absIndex=${folderIndex - 1} (folder: ${String(folderIndex).padStart(3, '0')})`);
    console.log(`[main] │ target: ${targetCount} images`);
    console.log(`[main] │ projectId: ${projectId || 'NONE'}`);
    console.log(`[main] │ outputDir: ${promptDir}`);
    console.log(`[main] │ text: "${(prompt.prompt || 'EMPTY!').substring(0, 60)}"`);
    console.log(`[main] └──────────────────────────────────────────────────`);

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
      promptCurrent: runIndex,
      promptTotal: prompts.length,
      promptText: prompt.prompt,
      imagesPerPrompt: targetCount,
      status: 'generating',
      message: `Промпт ${runIndex}/${prompts.length}...`,
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
            promptCurrent: runIndex,
            promptTotal: prompts.length,
            promptText: prompt.prompt,
            imagesPerPrompt: targetCount,
            // Engine slot-level fields pass through as-is
            ...progress,
          };

          // Enrich 'saved' events with a base64 preview thumbnail (async)
          if (progress.step === 'saved' && progress.savedSlot) {
            try {
              // Small delay to ensure file is fully flushed to disk
              await new Promise(r => setTimeout(r, 300));
              let filePath = path.join(promptDir, `gen_${progress.savedSlot}.jpg`);
              // Fallback: try .webp if .jpg doesn't exist
              if (!require('fs').existsSync(filePath)) {
                const altPath = path.join(promptDir, `gen_${progress.savedSlot}.webp`);
                if (require('fs').existsSync(altPath)) filePath = altPath;
              }
              const data = await fs.promises.readFile(filePath);
              const ext = path.extname(filePath).slice(1) || 'jpeg';
              enriched.previewDataUrl = `data:image/${ext};base64,${data.toString('base64')}`;
              enriched.promptIndex = runIndex;
              enriched.slotIndex = progress.savedSlot;
            } catch (e) {
              // File may not exist yet — non-fatal, progress.js will show placeholder
              console.warn('[main] Preview read error (tile will show placeholder):', e.message);
              enriched.promptIndex = runIndex;
              enriched.slotIndex = progress.savedSlot;
              
              // Deferred retry: try again after 1.5s to upgrade placeholder with real preview
              const retrySlot = progress.savedSlot;
              const retryPromptDir = promptDir;
              const retryRunIndex = runIndex;
              setTimeout(async () => {
                try {
                  let fp = path.join(retryPromptDir, `gen_${retrySlot}.jpg`);
                  if (!require('fs').existsSync(fp)) {
                    const alt = path.join(retryPromptDir, `gen_${retrySlot}.webp`);
                    if (require('fs').existsSync(alt)) fp = alt;
                  }
                  if (require('fs').existsSync(fp)) {
                    const d = await fs.promises.readFile(fp);
                    const ext = path.extname(fp).slice(1) || 'jpeg';
                    sendToRenderer('generate:progress', {
                      step: 'saved',
                      promptCurrent: retryRunIndex,
                      promptTotal: prompts.length,
                      promptIndex: retryRunIndex,
                      slotIndex: retrySlot,
                      savedSlot: retrySlot,
                      previewDataUrl: `data:image/${ext};base64,${d.toString('base64')}`,
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
      if (i < prompts.length - 1 && !engine.getShouldStop()) {
        console.log(`[main] ⏳ После промпта ${runIndex}: ждём стабилизации ленты...`);
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

            // Fresh boundary snapshot after resync
            crossPromptExcludeFingerprints = await engine.snapshotFeedFingerprints(page, 20);
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

          // Use wider snapshot (20) for exclude fingerprints — more conservative for next prompt
          crossPromptExcludeFingerprints = await engine.snapshotFeedFingerprints(page, 20);
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
        promptCurrent: runIndex,
        promptTotal: prompts.length,
        imagesPerPrompt: targetCount,
        message: `✅ Промпт ${runIndex}/${prompts.length} завершён — ${files.length}/${targetCount} сохранено`,
      });

      console.log(`[main] ┌── RESULT PROMPT ${runIndex} ─────────────────────────`);
      console.log(`[main] │ status: ${promptStatus.toUpperCase()} → saved ${files.length}/${targetCount}`);
      console.log(`[main] │ failed: ${result.failedCount || 0} slots`);
      console.log(`[main] │ files: [${files.join(', ')}]`);
      console.log(`[main] │ folder: ${promptDir}`);
      console.log(`[main] └──────────────────────────────────────────────────`);

    } catch (err) {
      // Engine throws only for fatal errors (isFatal=true) or 0-saved non-stop case
      const isFatal = err.isFatal === true;
      const reason = err.errorReason || 'unknown';

      console.error(`[main] Prompt ${runIndex} FAILED [fatal=${isFatal}, reason=${reason}]: ${err.message}`);

      meta.status = 'error';
      meta.error = err.message;
      meta.error_reason = reason;
      meta.timestamps.completed = new Date().toISOString();
      saveMeta(promptDir, meta);

      results.push({ idx: folderIndex, id: prompt.id, status: 'error', error: err.message, errorReason: reason });

      console.log(`[main] ┌── RESULT PROMPT ${runIndex} ─────────────────────────`);
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

    // Check if stopped by user (only via explicit stop button)
    if (engine.getShouldStop()) {
      console.log(`[main] ─── User pressed STOP after prompt ${i + 1}. Breaking. ───`);
      break;
    }
  }

  // Reset engine state after the entire batch completes
  try { engine.resetShouldStop(); } catch {}
  // isGenerating was left true by generatePrompt — reset it now
  if (typeof engine.getIsGenerating === 'function') {
    // Direct module-level reset
    engine._resetIsGenerating && engine._resetIsGenerating();
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


ipcMain.handle('generate:stop', () => {
  engine.stopGeneration();
  return { success: true };
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

// =============================================================
//  IPC HANDLERS — Projects
// =============================================================

// ── Prompt Set Helpers ──
function generateSetId() {
  return 'set_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Generate a clean, human-readable folder name for a new prompt set.
 * Pattern: prompt-set-NNN (001, 002, etc.) — unique within the project.
 */
function generateSetFolderName(project) {
  const existing = (project.promptSets || []).map(s => s.folderName || s.id);
  for (let i = 1; i <= 999; i++) {
    const candidate = `prompt-set-${String(i).padStart(3, '0')}`;
    if (!existing.includes(candidate)) return candidate;
  }
  // Fallback (should never happen): use id-based name
  return 'prompt-set-' + Date.now().toString(36);
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
  let projects = loadProjects();
  const project = projects.find(p => p.id === id);

  // Delete project folder from disk
  if (project) {
    const folder = project.folderName || id;
    const projectDir = path.join(config.ensureOutputDir(), folder);
    try {
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('[projects] Failed to delete folder:', err);
    }
  }
  return { success: true };
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
  const setId = generateSetId();
  const setFolderName = generateSetFolderName(project);
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
    name: sourceMeta?.originalFileName || `Набор ${setNumber}`,
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
    })),
    activePromptSetId: project.activePromptSetId,
    sourceMeta: activeSet?.sourceMeta || null,
    selections: activeSet?.selections || {},
    selectionCurrentPrompt: activeSet?.selectionCurrentPrompt || 0,
  };
});

// ── Switch active prompt set ──
ipcMain.handle('projects:switch-set', (event, { projectId, setId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false };

  const targetSet = (project.promptSets || []).find(s => s.id === setId);
  if (!targetSet) return { success: false, error: 'Set not found' };

  project.activePromptSetId = setId;
  saveProject(project);
  console.log(`[projects] Switched to prompt set: "${targetSet.name}" (${setId})`);
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

  // Block deletion of actively generating set
  if (targetSet.status === 'in_progress') {
    return { success: false, error: 'Набор сейчас генерируется. Остановите генерацию перед удалением.' };
  }

  // Remove set folder from disk
  const setDir = getSetDir(project, setId);
  if (fs.existsSync(setDir)) {
    try {
      fs.rmSync(setDir, { recursive: true, force: true });
      console.log(`[projects] Deleted set folder: ${setDir}`);
    } catch (e) {
      console.error('[projects] Failed to delete set folder:', e.message);
    }
  }

  // Remove from metadata
  project.promptSets.splice(setIdx, 1);

  // Handle active set switching
  if (project.activePromptSetId === setId) {
    if (project.promptSets.length > 0) {
      // Switch to last remaining set
      project.activePromptSetId = project.promptSets[project.promptSets.length - 1].id;
    } else {
      // No sets left — project returns to empty state
      project.activePromptSetId = null;
      project.status = 'draft';
    }
  }

  saveProject(project);
  console.log(`[projects] Deleted prompt set: "${targetSet.name}" (${setId})`);
  return { success: true, remainingSets: project.promptSets.length };
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

    return { success: true, images };
  } catch (err) {
    console.error('[projects] get-images error:', err);
    return { success: false, images: [] };
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

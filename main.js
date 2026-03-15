/* ============================================================
   HIGGSFIELD STUDIO — Electron Main Process
   ============================================================ */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Modules ──────────────────────────────────────────────────
const chrome = require('./chrome-manager');
const engine = require('./higgsfield-engine');
const { importFile } = require('./file-importer');

// ── Constants ────────────────────────────────────────────────
const IS_DEV = !app.isPackaged;
const APP_NAME = 'Higgsfield Studio';
const WINDOW_CONFIG = {
  width: 1440,
  height: 900,
  minWidth: 1024,
  minHeight: 700,
};
const OUTPUT_DIR = path.join(__dirname, 'output');

// ── Window ───────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    ...WINDOW_CONFIG,
    title: APP_NAME,
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

  mainWindow.loadFile('index.html');

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

// =============================================================
//  IPC HANDLERS — Generation
// =============================================================

ipcMain.handle('generate:start', async (event, { prompts, settings }) => {
  const { model, aspect, quality } = settings;

  // Ensure output dir exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Check Chrome connection
  const status = await chrome.getStatus();
  if (!status.cdpConnected) {
    const connectResult = await chrome.connectCDP();
    if (!connectResult.success) {
      return { success: false, error: 'Chrome не подключён. Запустите Chrome и подключитесь.' };
    }
  }

  // Check model supports Unlimited
  if (!engine.UNLIMITED_MODELS[model]) {
    const blockedName = engine.PAID_ONLY_MODELS[model] || model;
    return {
      success: false,
      error: `Модель "${blockedName}" не поддерживает Unlimited. Используйте: ${Object.values(engine.UNLIMITED_MODELS).map(m => m.name).join(', ')}`,
    };
  }

  // Process each prompt sequentially
  const results = [];
  for (let i = 0; i < prompts.length; i++) {
    if (!engine.getIsGenerating() && i > 0) break; // Stopped

    const prompt = prompts[i];
    const idx = i + 1;
    const promptDir = path.join(OUTPUT_DIR, String(idx).padStart(3, '0'));

    if (!fs.existsSync(promptDir)) {
      fs.mkdirSync(promptDir, { recursive: true });
    }

    // ── Build initial meta ──
    const meta = {
      id: prompt.id,
      prompt: prompt.prompt,
      status: 'preparing',
      target_count: 4,
      generated_count: 0,
      in_flight_count: 0,
      files: [],
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

    // Send progress
    sendToRenderer('generate:progress', {
      current: idx,
      total: prompts.length,
      prompt: prompt.prompt,
      status: 'generating',
      message: `Промпт ${idx}/${prompts.length}...`,
    });

    // ── Try generation (with 1 auto-retry) ──
    let succeeded = false;
    for (let attempt = 1; attempt <= 2 && !succeeded; attempt++) {
      if (attempt === 2) {
        console.log(`[main] Retry for prompt ${idx}...`);
        sendToRenderer('generate:progress', {
          current: idx,
          total: prompts.length,
          prompt: prompt.prompt,
          status: 'retrying',
          message: `Повторяю промпт ${idx}...`,
        });
      }

      try {
        meta.status = 'generating';
        meta.in_flight_count = 4;
        saveMeta(promptDir, meta);

        // ── Generate images ──
        const result = await engine.generatePrompt(prompt.prompt, {
          model,
          aspect,
          quality,
          onProgress: (progress) => {
            sendToRenderer('generate:progress', {
              current: idx,
              total: prompts.length,
              prompt: prompt.prompt,
              ...progress,
            });
          },
        });

        if (!result.urls || result.urls.length === 0) {
          throw new Error('Не получены URL изображений');
        }

        // ── Download images ──
        meta.status = 'downloading';
        meta.urls = result.urls;
        saveMeta(promptDir, meta);

        const files = [];
        for (let j = 0; j < Math.min(result.urls.length, 4); j++) {
          const destPath = path.join(promptDir, `gen_${j + 1}.jpg`);

          sendToRenderer('generate:progress', {
            current: idx,
            total: prompts.length,
            prompt: prompt.prompt,
            status: 'downloading',
            message: `Скачиваю ${j + 1}/${Math.min(result.urls.length, 4)}...`,
          });

          const dlResult = await engine.downloadImage(result.urls[j], destPath);
          if (dlResult.success) {
            files.push(`gen_${j + 1}.jpg`);
          } else {
            console.log(`[main] Download failed for image ${j + 1}: ${dlResult.error}`);
          }
        }

        if (files.length > 0) {
          // Success!
          meta.status = 'ready_for_selection';
          meta.generated_count = files.length;
          meta.in_flight_count = 0;
          meta.files = files;
          meta.timestamps.completed = new Date().toISOString();
          meta.error = null;
          saveMeta(promptDir, meta);

          results.push({ idx, id: prompt.id, status: 'done', files: files.length });
          succeeded = true;
        } else {
          throw new Error('Все скачивания провалились');
        }

      } catch (err) {
        console.error(`[main] Prompt ${idx} attempt ${attempt} error: ${err.message}`);

        if (attempt === 2 || err.message.includes('Сессия истекла') || err.message.includes('не поддерживает Unlimited')) {
          // Final failure
          meta.status = 'error';
          meta.error = err.message;
          meta.in_flight_count = 0;
          meta.timestamps.completed = new Date().toISOString();
          saveMeta(promptDir, meta);

          results.push({ idx, id: prompt.id, status: 'error', error: err.message });

          // Fatal auth error — stop all
          if (err.message.includes('Сессия истекла')) {
            sendToRenderer('generate:progress', {
              status: 'auth_error',
              message: err.message,
            });
            break;
          }
        }
        // else: will retry on next iteration
      }
    }

    // Check if stopped
    if (!engine.getIsGenerating()) break;
  }

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
  if (!fs.existsSync(OUTPUT_DIR)) return [];

  const folders = fs.readdirSync(OUTPUT_DIR)
    .filter(f => fs.statSync(path.join(OUTPUT_DIR, f)).isDirectory())
    .sort();

  const results = [];
  for (const folder of folders) {
    const metaPath = path.join(OUTPUT_DIR, folder, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        meta._folder = folder;
        meta._path = path.join(OUTPUT_DIR, folder);
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

ipcMain.handle('fs:select-image', async (event, { promptFolder, imageFile }) => {
  const srcDir = path.join(OUTPUT_DIR, promptFolder);
  const selDir = path.join(srcDir, 'selected');

  if (!fs.existsSync(selDir)) fs.mkdirSync(selDir, { recursive: true });

  const src = path.join(srcDir, imageFile);
  const dest = path.join(selDir, 'selected.jpg');

  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);

    // Update meta.json
    const metaPath = path.join(srcDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        meta.selected = imageFile;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch {}
    }
    return true;
  }
  return false;
});

// ── App Info ─────────────────────────────────────────────────
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  isPackaged: app.isPackaged,
  outputDir: OUTPUT_DIR,
  chromePath: chrome.findChromePath(),
}));

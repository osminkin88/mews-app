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
const config = require('./config-manager');

// ── Constants ────────────────────────────────────────────────
const IS_DEV = !app.isPackaged;
const APP_NAME = 'Higgsfield Studio';
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

ipcMain.handle('file:download-template', async () => {
  try {
    const templateSrc = path.join(__dirname, 'Шаблон_промптов.xlsx');
    if (!fs.existsSync(templateSrc)) {
      return { success: false, error: 'Файл шаблона не найден в папке приложения.' };
    }
    const desktopPath = require('electron').app.getPath('desktop');
    const destPath = path.join(desktopPath, 'Шаблон_промптов.xlsx');
    fs.copyFileSync(templateSrc, destPath);
    return { success: true, path: destPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// =============================================================
//  IPC HANDLERS — Generation
// =============================================================

ipcMain.handle('generate:start', async (event, { prompts, settings, projectId }) => {
  const { model, aspect, quality } = settings;

  // Route output to project's generated/ folder if projectId is set
  let baseOutputDir = config.ensureOutputDir();
  if (projectId) {
    const projects = loadProjects();
    const project = projects.find(p => p.id === projectId);
    if (project) {
      baseOutputDir = path.join(config.ensureOutputDir(), project.folderName || projectId, 'generated');
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

  // Check model supports Unlimited
  if (!engine.UNLIMITED_MODELS[model]) {
    const blockedName = engine.PAID_ONLY_MODELS[model] || model;
    return {
      success: false,
      error: `Модель "${blockedName}" не поддерживает Unlimited. Используйте: ${Object.values(engine.UNLIMITED_MODELS).map(m => m.name).join(', ')}`,
    };
  }

  // Process each prompt sequentially
  console.log(`[main] ═══ GENERATE:START received ═══`);
  console.log(`[main] Prompts received: ${prompts.length}`);
  console.log(`[main] projectId: ${projectId || 'NONE'}`);
  console.log(`[main] baseOutputDir: ${baseOutputDir}`);
  prompts.forEach((p, i) => {
    console.log(`[main] Prompt ${i + 1}: id=${p.id}, text="${(p.prompt || 'EMPTY!').substring(0, 80)}"`);
  });

  const results = [];
  for (let i = 0; i < prompts.length; i++) {
    if (!engine.getIsGenerating() && i > 0) break; // Stopped

    const prompt = prompts[i];
    const idx = i + 1;
    const promptDir = path.join(baseOutputDir, String(idx).padStart(3, '0'));
    console.log(`[main] ─── Processing prompt ${idx}/${prompts.length}: "${(prompt.prompt || 'EMPTY!').substring(0, 60)}" ───`);
    console.log(`[main] ─── Output dir: ${promptDir} ───`);

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

        // ── Generate + download images (engine handles both) ──
        const result = await engine.generatePrompt(prompt.prompt, {
          model,
          aspect,
          quality,
          outputDir: promptDir, // Engine saves directly here
          onProgress: (progress) => {
            sendToRenderer('generate:progress', {
              current: idx,
              total: prompts.length,
              prompt: prompt.prompt,
              ...progress,
            });
          },
        });

        // Engine returns { images, savedCount, errorCount, total }
        const savedImages = (result.images || []).filter(r => r.state === 'saved' && r.file);
        const files = savedImages.map(r => path.basename(r.file));
        console.log(`[main] Engine returned: savedCount=${result.savedCount}, files=[${files.join(', ')}]`);

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
          throw new Error('Ни одно изображение не сохранено');
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

function getProjectsFile() {
  return path.join(config.getOutputDir(), 'projects.json');
}

function loadProjects() {
  const file = getProjectsFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function saveProjects(projects) {
  const dir = config.ensureOutputDir();
  fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify(projects, null, 2), 'utf-8');
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
    status: 'draft',        // draft | in_progress | completed
    model: config.get('selectedModel') || 'nano_banana_pro',
    promptCount: 0,
    promptFile: null,
  };
  projects.unshift(project);
  saveProjects(projects);

  // Create project folder structure
  const projectDir = path.join(config.ensureOutputDir(), folderName);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  // Create subfolders
  const generatedDir = path.join(projectDir, 'generated');
  const selectedDir = path.join(projectDir, 'selected');
  if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true });
  if (!fs.existsSync(selectedDir)) fs.mkdirSync(selectedDir, { recursive: true });

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

  projects = projects.filter(p => p.id !== id);
  saveProjects(projects);
  return { success: true };
});

ipcMain.handle('projects:update', (event, { id, updates }) => {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return { success: false, error: 'Project not found' };
  Object.assign(projects[idx], updates);
  saveProjects(projects);
  return { success: true, project: projects[idx] };
});

// ── Save prompts to project folder ──
ipcMain.handle('projects:save-prompts', (event, { projectId, prompts, sourceFile }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, error: 'Project not found' };

  const projectDir = path.join(config.ensureOutputDir(), project.folderName || projectId);
  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  // Copy source CSV if available
  if (sourceFile && fs.existsSync(sourceFile)) {
    fs.copyFileSync(sourceFile, path.join(projectDir, 'prompts.csv'));
  }

  // Save parsed prompts as JSON for easy loading
  fs.writeFileSync(
    path.join(projectDir, 'prompts.json'),
    JSON.stringify(prompts, null, 2),
    'utf-8'
  );

  // Update project metadata
  project.promptCount = prompts.length;
  saveProjects(projects);

  return { success: true, count: prompts.length };
});

// ── Load prompts from project ──
ipcMain.handle('projects:load-prompts', (event, { projectId }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, prompts: [] };

  const projectDir = path.join(config.ensureOutputDir(), project.folderName || projectId);
  const promptsFile = path.join(projectDir, 'prompts.json');

  if (!fs.existsSync(promptsFile)) return { success: true, prompts: [] };

  try {
    const prompts = JSON.parse(fs.readFileSync(promptsFile, 'utf-8'));
    return { success: true, prompts };
  } catch {
    return { success: false, prompts: [] };
  }
});

// ── Get generated images for a prompt ──
ipcMain.handle('projects:get-images', (event, { projectId, promptIndex }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false, images: [] };

  const projectDir = path.join(config.ensureOutputDir(), project.folderName || projectId);
  const promptDir = path.join(projectDir, 'generated', String(promptIndex + 1).padStart(3, '0'));

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

// ── Save selection ──
ipcMain.handle('projects:save-selection', (event, { projectId, selections }) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { success: false };

  const projectDir = path.join(config.ensureOutputDir(), project.folderName || projectId);
  const selectedDir = path.join(projectDir, 'selected');
  if (!fs.existsSync(selectedDir)) fs.mkdirSync(selectedDir, { recursive: true });

  // selections = { promptIndex: imageIndex, ... }
  let copied = 0;
  for (const [promptIdx, imageIdx] of Object.entries(selections)) {
    const promptDir = path.join(projectDir, 'generated', String(Number(promptIdx) + 1).padStart(3, '0'));
    if (!fs.existsSync(promptDir)) continue;

    const files = fs.readdirSync(promptDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
    const sourceFile = files[imageIdx];
    if (!sourceFile) continue;

    const ext = path.extname(sourceFile);
    const destName = `${String(Number(promptIdx) + 1).padStart(3, '0')}${ext}`;
    fs.copyFileSync(path.join(promptDir, sourceFile), path.join(selectedDir, destName));
    copied++;
  }

  // Update project status
  project.status = 'completed';
  saveProjects(projects);

  return { success: true, copied };
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

ipcMain.handle('fs:select-image', async (event, { promptFolder, imageFile }) => {
  const srcDir = path.join(getOutputDir(), promptFolder);
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
  outputDir: getOutputDir(),
  chromePath: chrome.findChromePath(),
  appData: config.APP_DATA,
}));

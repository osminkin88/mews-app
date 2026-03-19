/* ============================================================
   HIGGSFIELD STUDIO — Preload Script
   Secure bridge between Node.js (main) and Browser (renderer)
   ============================================================ */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── Platform Detection ──
  isElectron: true,
  platform: process.platform,

  // ── Chrome Management ──
  chrome: {
    launch: () => ipcRenderer.invoke('chrome:launch'),
    connect: () => ipcRenderer.invoke('chrome:connect'),
    saveSession: () => ipcRenderer.invoke('chrome:save-session'),
    status: () => ipcRenderer.invoke('chrome:status'),
    checkAuth: () => ipcRenderer.invoke('chrome:check-auth'),
    checkInstalled: () => ipcRenderer.invoke('chrome:check-installed'),
    openModelPage: () => ipcRenderer.invoke('chrome:open-model-page'),
  },

  // ── File Import ──
  file: {
    select: () => ipcRenderer.invoke('file:select'),
    import: (filePath) => ipcRenderer.invoke('file:import', filePath),
    downloadTemplate: () => ipcRenderer.invoke('file:download-template'),
  },

  // ── Projects ──
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (name, icon) => ipcRenderer.invoke('projects:create', { name, icon }),
    delete: (id) => ipcRenderer.invoke('projects:delete', { id }),
    update: (id, updates) => ipcRenderer.invoke('projects:update', { id, updates }),
    savePrompts: (projectId, prompts, sourceFile) =>
      ipcRenderer.invoke('projects:save-prompts', { projectId, prompts, sourceFile }),
    loadPrompts: (projectId) =>
      ipcRenderer.invoke('projects:load-prompts', { projectId }),
    getImages: (projectId, promptIndex) =>
      ipcRenderer.invoke('projects:get-images', { projectId, promptIndex }),
    saveSelection: (projectId, selections) =>
      ipcRenderer.invoke('projects:save-selection', { projectId, selections }),
    getProjectPath: (projectId) =>
      ipcRenderer.invoke('projects:get-project-path', { projectId }),
    getSelectedImages: (projectId) =>
      ipcRenderer.invoke('projects:get-selected-images', { projectId }),
    exportSelected: (projectId) =>
      ipcRenderer.invoke('projects:export-selected', { projectId }),
    switchSet: (projectId, setId) =>
      ipcRenderer.invoke('projects:switch-set', { projectId, setId }),
    renameSet: (projectId, setId, newName) =>
      ipcRenderer.invoke('projects:rename-set', { projectId, setId, newName }),
    deleteSet: (projectId, setId) =>
      ipcRenderer.invoke('projects:delete-set', { projectId, setId }),
    duplicateSetAsActive: (projectId) =>
      ipcRenderer.invoke('projects:duplicate-set-as-active', { projectId }),
  },

  // ── Generation ──
  generate: {
    start: (prompts, settings, projectId) =>
      ipcRenderer.invoke('generate:start', { prompts, settings, projectId }),
    pause:  () => ipcRenderer.invoke('generate:pause'),
    cancel: () => ipcRenderer.invoke('generate:cancel'),
    stop:   () => ipcRenderer.invoke('generate:stop'),   // backward compat alias → pause
    onProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('generate:progress', handler);
      // Return cleanup function
      return () => ipcRenderer.removeListener('generate:progress', handler);
    },
    getResumeState: (projectId) =>
      ipcRenderer.invoke('generate:get-resume-state', { projectId }),
    clearResumeState: (projectId) =>
      ipcRenderer.invoke('generate:clear-resume-state', { projectId }),
  },

  // ── File System ──
  fs: {
    openFolder: (path) => ipcRenderer.invoke('fs:open-folder', path),
    readOutput: () => ipcRenderer.invoke('fs:read-output'),
    readImage: (imagePath) => ipcRenderer.invoke('fs:read-image', imagePath),
    selectImage: (promptFolder, imageFile) =>
      ipcRenderer.invoke('fs:select-image', { promptFolder, imageFile }),
  },

  // ── Config ──
  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, val) => ipcRenderer.invoke('config:set', { key, val }),
    getAll: () => ipcRenderer.invoke('config:get-all'),
    selectOutputDir: () => ipcRenderer.invoke('config:select-output-dir'),
  },

  // ── App Info ──
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    quit: () => ipcRenderer.invoke('app:quit'),
  },

  // ── Model Capabilities ──
  models: {
    getUnlimitedList: () => ipcRenderer.invoke('models:get-unlimited-list'),
    resolveSettings: (settings) => ipcRenderer.invoke('models:resolve-settings', settings),
  },
});

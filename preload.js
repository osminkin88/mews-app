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
  },

  // ── File Import ──
  file: {
    select: () => ipcRenderer.invoke('file:select'),
    import: (filePath) => ipcRenderer.invoke('file:import', filePath),
  },

  // ── Generation ──
  generate: {
    start: (prompts, settings) =>
      ipcRenderer.invoke('generate:start', { prompts, settings }),
    stop: () => ipcRenderer.invoke('generate:stop'),
    onProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('generate:progress', handler);
      // Return cleanup function
      return () => ipcRenderer.removeListener('generate:progress', handler);
    },
  },

  // ── File System ──
  fs: {
    openFolder: (path) => ipcRenderer.invoke('fs:open-folder', path),
    readOutput: () => ipcRenderer.invoke('fs:read-output'),
    readImage: (imagePath) => ipcRenderer.invoke('fs:read-image', imagePath),
    selectImage: (promptFolder, imageFile) =>
      ipcRenderer.invoke('fs:select-image', { promptFolder, imageFile }),
  },

  // ── App Info ──
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
});

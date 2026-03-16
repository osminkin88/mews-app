/* ============================================================
   V4 API — Thin adapter over window.electronAPI
   ============================================================
   Re-exports all IPC methods from preload.js.
   Adds fallback stubs for browser-only testing.
   Future: add data transforms here without touching preload.
   ============================================================ */

const isElectron = !!(window.electronAPI && window.electronAPI.isElectron);

// ── Fallback stubs for browser testing ──
const STUBS = {
  chrome: {
    launch: async () => ({ success: false, error: 'Stub: not in Electron' }),
    connect: async () => ({ success: false }),
    status: async () => ({ cdpConnected: false, chromeRunning: false }),
    checkAuth: async () => ({ authenticated: false }),
    checkInstalled: async () => ({ installed: false }),
    saveSession: async () => ({ success: false }),
  },
  file: {
    select: async () => null,
    import: async () => ({ success: false, prompts: [] }),
    downloadTemplate: async () => ({ success: false }),
  },
  projects: {
    list: async () => [],
    create: async () => ({ id: 'stub', name: 'Stub Project' }),
    delete: async () => ({ success: true }),
    update: async () => ({ success: true }),
    savePrompts: async () => ({ success: true }),
    loadPrompts: async () => ({ success: true, prompts: [] }),
    getImages: async () => ({ success: true, images: [] }),
    saveSelection: async () => ({ success: true }),
  },
  generate: {
    start: async () => ({ success: false }),
    stop: async () => ({ success: true }),
    onProgress: (cb) => () => {}, // returns cleanup fn
  },
  fs: {
    openFolder: async () => false,
    readOutput: async () => [],
    readImage: async () => null,
    selectImage: async () => ({ success: false }),
  },
  config: {
    get: async (key) => null,
    set: async () => ({ success: true }),
    getAll: async () => ({}),
    selectOutputDir: async () => null,
  },
};

// ── Export: real API or stubs ──
const api = isElectron ? window.electronAPI : STUBS;

export default api;
export { isElectron };

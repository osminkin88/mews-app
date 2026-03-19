import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

let mockIpcHandlers = {};
let mockShowOpenDialog = vi.fn();

const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'electron') {
    return {
      app: {
        getPath: vi.fn().mockReturnValue('/mock/app/data'),
        isPackaged: false,
        whenReady: vi.fn().mockResolvedValue(),
        on: vi.fn(),
        dock: { setIcon: vi.fn() }
      },
      dialog: { showOpenDialog: mockShowOpenDialog, showSaveDialog: vi.fn() },
      BrowserWindow: Object.assign(function() {
        this.once = vi.fn((event, cb) => cb && cb());
        this.on = vi.fn();
        this.loadFile = vi.fn().mockResolvedValue();
        this.show = vi.fn();
        this.isDestroyed = vi.fn().mockReturnValue(false);
        this.webContents = { send: vi.fn(), openDevTools: vi.fn(), setWindowOpenHandler: vi.fn() };
      }, {
        getAllWindows: vi.fn().mockReturnValue([{
          isDestroyed: () => false,
          webContents: { send: vi.fn() }
        }])
      }),
      ipcMain: {
        handle: (channel, cb) => { mockIpcHandlers[channel] = cb; },
        on: (channel, cb) => { mockIpcHandlers[channel] = cb; },
      },
      shell: { openExternal: vi.fn() },
      Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
    };
  }
  return origRequire.apply(this, arguments);
};

vi.mock('fs');

describe('IPC Contract — projects:export-selected', () => {
  let fs;

  beforeEach(async () => {
    mockIpcHandlers = {};
    mockShowOpenDialog.mockClear();

    fs = require('fs');
    fs.existsSync = vi.fn();
    fs.mkdirSync = vi.fn();
    fs.writeFileSync = vi.fn();
    fs.copyFileSync = vi.fn();
    fs.readdirSync = vi.fn().mockImplementation((dirPath) => {
      if (typeof dirPath === 'string' && dirPath.includes('selected')) return [];
      return ['test_project']; // for the root outputDir
    });
    fs.statSync = vi.fn().mockReturnValue({ isDirectory: () => true });

    vi.resetModules();
    await import('../main.js?v=' + Date.now());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails gracefully if selected folder does not exist', async () => {
    fs.readFileSync = vi.fn().mockImplementation((filePath) => {
      if (filePath.includes('projects.json')) return '[{"id":"proj_export"}]';
      return JSON.stringify({ id: 'proj_export', folderName: 'test', promptSets: [{id:'set_1'}], activePromptSetId: 'set_1' });
    });
    fs.existsSync.mockImplementation((pathStr) => {
      // return false only for the selected folder itself
      if (typeof pathStr === 'string' && pathStr.includes('selected')) return false;
      return true;
    });

    const handler = mockIpcHandlers['projects:export-selected'];
    const result = await handler({}, { projectId: 'proj_export' });
    
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/не найдена/i);
  });

  it('fails gracefully if selected folder is empty', async () => {
    fs.readFileSync = vi.fn().mockImplementation((filePath) => {
      if (filePath.includes('projects.json')) return '[{"id":"proj_export"}]';
      return JSON.stringify({ id: 'proj_export' });
    });
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dirPath) => {
      if (typeof dirPath === 'string' && dirPath.includes('selected')) return ['not_an_image.txt'];
      return ['test_project'];
    });
    
    const handler = mockIpcHandlers['projects:export-selected'];
    const result = await handler({}, { projectId: 'proj_export' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Нет файлов/i);
  });

  it('respects dialog cancellation', async () => {
    fs.readFileSync = vi.fn().mockImplementation((filePath) => {
      if (filePath.includes('projects.json')) return '[{"id":"proj_export"}]';
      return JSON.stringify({ id: 'proj_export' });
    });
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dirPath) => {
      if (typeof dirPath === 'string' && dirPath.includes('selected')) return ['gen_1.jpg'];
      return ['test_project'];
    });
    mockShowOpenDialog.mockResolvedValue({ canceled: true });

    const handler = mockIpcHandlers['projects:export-selected'];
    const result = await handler({}, { projectId: 'proj_export' });

    expect(result.success).toBe(false);
    expect(result.canceled).toBe(true);
    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  it('exports files successfully when dialog is approved', async () => {
    fs.readFileSync = vi.fn().mockImplementation((filePath) => {
      if (filePath.includes('projects.json')) return '[{"id":"proj_export"}]';
      return JSON.stringify({ id: 'proj_export' });
    });
    fs.existsSync.mockReturnValue(true);
    fs.readdirSync.mockImplementation((dirPath) => {
      if (typeof dirPath === 'string' && dirPath.includes('selected')) return ['1.png', 'gen_1.jpg', 'meta.json'];
      return ['test_project'];
    });
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/mock/Downloads'] });

    const handler = mockIpcHandlers['projects:export-selected'];
    const result = await handler({}, { projectId: 'proj_export' });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2); // Only png/jpg files
    expect(result.dest).toBe('/Users/mock/Downloads');
    // Ensure copyFileSync was called twice for the images
    expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
  });
});

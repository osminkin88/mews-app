import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

let mockIpcHandlers = {};

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
      dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
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

// ── Shared mock project factory ──
function makeProject(overrides = {}) {
  return {
    id: 'proj_cleanup',
    folderName: 'test_project',
    activePromptSetId: 'set_1',
    status: 'completed',
    promptSets: [{
      id: 'set_1',
      folderName: 'set_folder',
      name: 'Набор 1',
      status: 'completed',
      selections: { '0': 1, '1': 0 },
      generationCleaned: false,
      ...overrides.set,
    }],
    ...overrides.project,
  };
}

describe('IPC Contract — projects:cleanup-generated', () => {
  let fs;

  beforeEach(async () => {
    mockIpcHandlers = {};
    fs = require('fs');
    fs.existsSync = vi.fn().mockReturnValue(true);
    fs.mkdirSync = vi.fn();
    fs.writeFileSync = vi.fn();
    fs.renameSync = vi.fn(); // moveToTrash uses renameSync
    fs.readdirSync = vi.fn().mockReturnValue(['test_project']);
    fs.statSync = vi.fn().mockReturnValue({ isDirectory: () => true, mtimeMs: Date.now() });

    vi.resetModules();
    await import('../main.js?v=' + Date.now());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handler is registered', () => {
    expect(mockIpcHandlers['projects:cleanup-generated']).toBeDefined();
  });

  it('fails gracefully when project not found', async () => {
    fs.readFileSync = vi.fn().mockReturnValue('[]');
    const handler = mockIpcHandlers['projects:cleanup-generated'];
    const result = await handler({}, { projectId: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/не найден/i);
  });

  it('blocks cleanup if status is not completed', async () => {
    const project = makeProject({ set: { status: 'draft' } });
    fs.readFileSync = vi.fn().mockImplementation((fp) => {
      if (fp.endsWith('project.json')) return JSON.stringify(project);
      return JSON.stringify([{ id: 'proj_cleanup' }]);
    });

    const handler = mockIpcHandlers['projects:cleanup-generated'];
    const result = await handler({}, { projectId: 'proj_cleanup' });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not_completed');
  });

  it('returns alreadyClean if generationCleaned is already true', async () => {
    const project = makeProject({ set: { generationCleaned: true } });
    fs.readFileSync = vi.fn().mockImplementation((fp) => {
      if (fp.endsWith('project.json')) return JSON.stringify(project);
      return JSON.stringify([{ id: 'proj_cleanup' }]);
    });

    const handler = mockIpcHandlers['projects:cleanup-generated'];
    const result = await handler({}, { projectId: 'proj_cleanup' });
    expect(result.success).toBe(true);
    expect(result.alreadyClean).toBe(true);
  });

  it('blocks cleanup if selected/ is empty', async () => {
    const project = makeProject();
    fs.readFileSync = vi.fn().mockImplementation((fp) => {
      if (fp.endsWith('project.json')) return JSON.stringify(project);
      return JSON.stringify([{ id: 'proj_cleanup' }]);
    });
    // selected/ exists but has no image files
    fs.readdirSync = vi.fn().mockImplementation((dirPath) => {
      if (typeof dirPath === 'string' && dirPath.includes('selected')) return ['not_an_image.txt'];
      if (typeof dirPath === 'string' && dirPath.includes('generated')) return [];
      return ['test_project'];
    });

    const handler = mockIpcHandlers['projects:cleanup-generated'];
    const result = await handler({}, { projectId: 'proj_cleanup' });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_selected');
  });

  it('successfully moves generated/ to trash when all conditions met', async () => {
    const project = makeProject();
    fs.readFileSync = vi.fn().mockImplementation((fp) => {
      if (fp.endsWith('project.json')) return JSON.stringify(project);
      return JSON.stringify([{ id: 'proj_cleanup' }]);
    });
    fs.readdirSync = vi.fn().mockImplementation((dirPath) => {
      if (typeof dirPath === 'string' && dirPath.includes('selected')) return ['001.png', '002.png'];
      if (typeof dirPath === 'string' && dirPath.includes('generated')) return ['001', '002'];
      return ['test_project'];
    });
    // subdirs of generated return image files
    fs.statSync = vi.fn().mockImplementation((p) => {
      return { isDirectory: () => !p.endsWith('.png'), mtimeMs: Date.now() };
    });

    const handler = mockIpcHandlers['projects:cleanup-generated'];
    const result = await handler({}, { projectId: 'proj_cleanup' });

    expect(result.success).toBe(true);
    // renameSync should have been called (moveToTrash mechanism)
    expect(fs.renameSync).toHaveBeenCalled();
    // project.json should have been saved with generationCleaned flag
    const saveCall = fs.writeFileSync.mock.calls.find(c => c[0].endsWith('project.json'));
    expect(saveCall).toBeDefined();
    const saved = JSON.parse(saveCall[1]);
    const savedSet = saved.promptSets.find(s => s.id === 'set_1');
    expect(savedSet.generationCleaned).toBe(true);
    expect(savedSet.generationCleanedAt).toBeDefined();
  });

  it('marks generationCleaned if generated/ already missing', async () => {
    const project = makeProject();
    fs.readFileSync = vi.fn().mockImplementation((fp) => {
      if (fp.endsWith('project.json')) return JSON.stringify(project);
      return JSON.stringify([{ id: 'proj_cleanup' }]);
    });
    fs.readdirSync = vi.fn().mockImplementation((dirPath) => {
      if (typeof dirPath === 'string' && dirPath.includes('selected')) return ['001.png'];
      return ['test_project'];
    });
    fs.existsSync = vi.fn().mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('generated')) return false;
      return true;
    });

    const handler = mockIpcHandlers['projects:cleanup-generated'];
    const result = await handler({}, { projectId: 'proj_cleanup' });

    expect(result.success).toBe(true);
    expect(result.alreadyClean).toBe(true);
    // Should still save the flag
    const saveCall = fs.writeFileSync.mock.calls.find(c => c[0].endsWith('project.json'));
    expect(saveCall).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

let mockIpcHandlers = {};
let sendToRendererSpy = vi.fn();

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
          webContents: { send: (...args) => sendToRendererSpy(...args) }
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

describe('IPC Contract — projects:duplicate-set-as-active', () => {
  let fs;

  beforeEach(async () => {
    mockIpcHandlers = {};
    fs = require('fs');
    fs.existsSync = vi.fn().mockReturnValue(true);
    fs.mkdirSync = vi.fn();
    fs.writeFileSync = vi.fn();
    fs.renameSync = vi.fn();
    fs.readdirSync = vi.fn().mockReturnValue(['test_project']);
    fs.statSync = vi.fn().mockReturnValue({ isDirectory: () => true });

    vi.resetModules();
    await import('../main.js?v=' + Date.now());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('duplicates active set correctly without carrying over selections and keeps old set', async () => {
    const mockProject = {
      id: 'proj_123',
      folderName: 'test_project',
      activePromptSetId: 'set_1',
      status: 'in_progress',
      selections: { '0': 2 },
      selectionCurrentPrompt: 1,
      promptSets: [{
        id: 'set_1',
        name: 'My Set v1',
        folderName: 'my-set__v1',
        status: 'completed',
        prompts: [{ prompt: 'A' }, { prompt: 'B' }],
        selections: { '0': 1 },
        generationState: { stoppedAt: '123' }
      }]
    };

    fs.readFileSync = vi.fn().mockImplementation((filePath) => {
      if (filePath.includes('projects.json')) return '[{"id":"proj_123"}]';
      if (filePath.includes('project.json')) return JSON.stringify(mockProject);
      return '';
    });

    const handler = mockIpcHandlers['projects:duplicate-set-as-active'];
    expect(handler).toBeDefined();

    const result = await handler({}, { projectId: 'proj_123' });
    expect(result.success).toBe(true);
    expect(result.newSetId).toBeDefined();
    expect(result.newSetId).not.toBe('set_1');

    const projectSaveCall = fs.writeFileSync.mock.calls.find(c => c[0].endsWith('project.json'));
    expect(projectSaveCall).toBeDefined();

    const savedProjectJson = JSON.parse(projectSaveCall[1]);
    expect(savedProjectJson.promptSets.length).toBe(2);
    
    // New set checks
    const newSet = savedProjectJson.promptSets.find(s => s.id === result.newSetId);
    expect(newSet).toBeDefined();
    expect(newSet.name).toContain('My Set v'); 
    expect(newSet.status).toBe('draft');
    // Selections and generation state shouldn't be copied
    expect(Object.keys(newSet.selections).length).toBe(0);
    expect(newSet.generationState).toBeUndefined();
    // Prompts carry over
    expect(newSet.prompts.length).toBe(2);

    // Old set checks
    const oldSet = savedProjectJson.promptSets.find(s => s.id === 'set_1');
    expect(oldSet.status).toBe('completed');

    // Project state checks
    expect(savedProjectJson.activePromptSetId).toBe(result.newSetId);
    expect(Object.keys(savedProjectJson.selections).length).toBe(0); // cleared
  });

  it('fails if project is missing', async () => {
    fs.readFileSync = vi.fn().mockReturnValue('[]');
    const handler = mockIpcHandlers['projects:duplicate-set-as-active'];
    const result = await handler({}, { projectId: 'proj_404' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/не найден/i);
  });
});

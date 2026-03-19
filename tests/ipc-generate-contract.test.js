/* ============================================================
   UNIT TESTS — IPC Engine Actions Contract
   ============================================================ */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// 1. Mock Electron globally before requiring main.js
let mockIpcHandlers = {};
let sendToRendererSpy = vi.fn();

// We must intercept require directly because Vitest doesn't always mock external CJS packages by default.
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
      },
      dialog: { showOpenDialog: vi.fn() },
      BrowserWindow: Object.assign(function() {
        this.once = vi.fn((event, cb) => cb()); // Immediately trigger ready-to-show
        this.on = vi.fn();
        this.loadFile = vi.fn().mockResolvedValue();
        this.show = vi.fn();
        this.webContents = { send: vi.fn(), openDevTools: vi.fn(), setWindowOpenHandler: vi.fn() };
      }, {
        getAllWindows: vi.fn().mockReturnValue([{
          webContents: { send: (...args) => sendToRendererSpy(...args) }
        }])
      }),
      ipcMain: {
        handle: (channel, cb) => { mockIpcHandlers[channel] = cb; },
        on:     (channel, cb) => { mockIpcHandlers[channel] = cb; },
      },
      shell: { openExternal: vi.fn() },
      Menu: { 
        setApplicationMenu: vi.fn(),
        buildFromTemplate: vi.fn()
      },
    };
  }
  return origRequire.apply(this, arguments);
};

// We also mock fs heavily to test the project JSON mutation safely
vi.mock('fs');

describe('IPC Contract — generate:pause, cancel, stop & resume', () => {
let engine;
let engineSpyPause;
let engineSpyCancel;
let fs;

// We'll dynamically import main.js inside beforeEach

  beforeEach(() => {
    mockIpcHandlers = {};
    sendToRendererSpy.mockClear();

    engine = require('../higgsfield-engine.js');
    engineSpyPause = vi.spyOn(engine, 'pauseGeneration').mockImplementation(() => {});
    engineSpyCancel = vi.spyOn(engine, 'cancelGeneration').mockImplementation(() => {});

    fs = require('fs');
    fs.existsSync = vi.fn().mockReturnValue(true);
    fs.mkdirSync = vi.fn();
    fs.writeFileSync = vi.fn();
    fs.renameSync = vi.fn();
    fs.readdirSync = vi.fn().mockReturnValue([]);

    vi.resetModules();
  });

  // Dynamically import main.js to ensure mocks are fully applied
  beforeEach(async () => {
    await import('../main.js?v=' + Date.now()); // force reload
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generate:pause -> calls engine.pauseGeneration, NOT cancelGeneration', async () => {
    const handler = mockIpcHandlers['generate:pause'];
    expect(handler).toBeDefined();

    const result = await handler({}, {});
    
    expect(engineSpyPause).toHaveBeenCalledOnce();
    expect(engineSpyCancel).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('generate:cancel -> calls engine.cancelGeneration, NOT pauseGeneration', async () => {
    const handler = mockIpcHandlers['generate:cancel'];
    expect(handler).toBeDefined();

    const result = await handler({}, {});
    
    expect(engineSpyCancel).toHaveBeenCalledOnce();
    expect(engineSpyPause).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('generate:stop alias -> calls engine.pauseGeneration, NOT cancelGeneration', async () => {
    const handler = mockIpcHandlers['generate:stop'];
    expect(handler).toBeDefined();

    const result = await handler({}, {});
    
    expect(engineSpyPause).toHaveBeenCalledOnce();
    expect(engineSpyCancel).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('generate:clear-resume-state -> cleanly strips generationState from project JSON', async () => {
    // В main.js логика работы с состояниями опирается на project.json.
    // Настроим мок, чтобы он вернул 1 проект с активным сетом, у которого ЕСТЬ стейт паузы.
    fs.readdirSync.mockReturnValue(['test_project']);
    fs.statSync = vi.fn().mockReturnValue({ isDirectory: () => true });
    
    const mockProject = {
      id: 'proj_123',
      folderName: 'test_project',
      activePromptSetId: 'set_1',
      promptSets: [{
        id: 'set_1',
        status: 'paused',
        generationState: {
          stoppedAt: '2026-03-19T00:00:00Z',
          reason: 'paused'
        }
      }]
    };
    
    fs.readFileSync = vi.fn((filePath) => {
      // Avoid breaking if main.js reads something else
      if (filePath.includes('projects.json')) return '[]';
      return JSON.stringify(mockProject);
    });

    const handler = mockIpcHandlers['generate:clear-resume-state'];
    expect(handler).toBeDefined();

    const result = await handler({}, { projectId: 'proj_123' });
    expect(result.success).toBe(true);

    // Ищем именно тот вызов, где сохраняли project.json
    const projectSaveCall = fs.writeFileSync.mock.calls.find(c => c[0].endsWith('project.json'));
    expect(projectSaveCall).toBeDefined();
    
    // Проверяем, ЧТО именно было сохранено
    const savedProjectJson = JSON.parse(projectSaveCall[1]);
    
    const savedActiveSet = savedProjectJson.promptSets[0];
    expect(savedActiveSet.generationState).toBeUndefined();
    expect(savedActiveSet.status).toBe('draft'); // canceled resumes revert to draft behavior inside clear logic
  });
});

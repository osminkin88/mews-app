/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock app dependency
vi.mock('../v4/app.js', () => {
  return {
    api: {
      projects: {
        list: vi.fn(),
        getImages: vi.fn().mockResolvedValue({ images: [] }),
      },
      generate: {
        pause: vi.fn(),
        cancel: vi.fn(),
        onProgress: vi.fn((cb) => {
          // Store callback if needed or return a generic unsubscribe
          return () => {};
        })
      }
    },
    navigate: vi.fn(),
    state: {
      currentProject: { id: 'proj_active', name: 'My Active Project' }
    }
  };
});

describe('UI: Progress Isolation', () => {
  let progressModule;
  let container;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const appMod = await import('../v4/app.js');
    appMod.state.currentProject = { id: 'proj_active', name: 'My Active Project' };
    
    progressModule = (await import('../v4/screens/progress.js')).default;
  });

  it('shows foreign alert when activeRunProjectId mismatches and handles switch', async () => {
    // Inject the scrollIntoView if needed, though mostly selection needs it
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    const appMod = await import('../v4/app.js');
    let progressCb;
    appMod.api.generate.onProgress.mockImplementation((cb) => {
      progressCb = cb; return () => {}; 
    });

    await progressModule.mount(container);
    
    // Simulate generation starting in the backend
    progressCb({ step: 'session_start', projectId: 'proj_foreign', projectName: 'Foreign Project' });

    // User navigates away and back, triggering a re-mount
    await progressModule.unmount();
    await progressModule.mount(container);
    
    // Now render() is called with activeRunProjectId set to foreign
    const foreignAlert = container.querySelector('.foreign-alert');
    expect(foreignAlert).not.toBeNull();
    // Verify it isn't hidden by default classes
    expect(foreignAlert.classList.contains('hidden')).toBe(false);
  });
});


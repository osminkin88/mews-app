/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1. Mocking the v4 app.js context
vi.mock('../v4/app.js', () => {
  return {
    navigate: vi.fn(),
    state: {
      generationRequested: false,
      currentProject: { id: 'proj_123' },
      connectionStatus: 'ready'
    },
    api: {
      generate: {
        onProgress: vi.fn(),
        pause: vi.fn().mockResolvedValue(),
        cancel: vi.fn().mockResolvedValue(),
        start: vi.fn().mockResolvedValue({ success: true })
      },
      projects: {
        loadPrompts: vi.fn().mockResolvedValue({ prompts: [{ id: 'p1', text: 'test' }] })
      },
      config: {
        getAll: vi.fn().mockResolvedValue({})
      },
      models: {
        resolveSettings: vi.fn().mockResolvedValue({ blocked: false, effective: {} })
      }
    }
  };
});

import { navigate, state, api } from '../v4/app.js';
import progressScreen from '../v4/screens/progress.js';

describe('UI State Machine — progress.js', () => {
  let container;
  let updateProgressMock;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Set up a fresh DOM container
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);

    // Setup the mock to capture the the callback function passed to onProgress
    api.generate.onProgress.mockImplementation((cb) => {
      updateProgressMock = cb;
      return () => {}; // return cleanup function
    });

    // Reset module-level variables in progress.js by starting a new generation
    state.generationRequested = true;
    
    // Mount the screen
    await progressScreen.mount(container);
  });

  afterEach(() => {
    progressScreen.unmount();
  });

  it('1. Default generating state', () => {
    // The screen should render the default hero actions
    const heroActions = container.querySelector('#hero-actions');
    expect(heroActions.style.display).not.toBe('none');
    
    const pauseBtn = container.querySelector('#btn-pause');
    const cancelBtn = container.querySelector('#btn-cancel');
    
    expect(pauseBtn.disabled).toBe(false);
    expect(pauseBtn.textContent).toContain('Пауза');
    
    const cancelConfirm = container.querySelector('#cancel-confirm-strip');
    expect(cancelConfirm.style.display).toBe('none');
  });

  it('2. pauseRequested phase', async () => {
    const pauseBtn = container.querySelector('#btn-pause');
    const cancelBtn = container.querySelector('#btn-cancel');

    // Click pause
    await pauseBtn.click();

    expect(api.generate.pause).toHaveBeenCalledOnce();
    
    // UI changes immediately
    expect(pauseBtn.disabled).toBe(true);
    expect(pauseBtn.textContent).toContain('Останавливаю…');
    expect(cancelBtn.style.display).toBe('none'); // Cancel button hidden
    
    // Detail text updates to show orange warning
    const detailEl = container.querySelector('#ph-detail');
    expect(detailEl.textContent).toContain('дождитесь завершения текущего слота');
    expect(detailEl.style.color).toBe('var(--orange)');
  });

  it('3. paused phase (after status: complete)', async () => {
    const pauseBtn = container.querySelector('#btn-pause');
    await pauseBtn.click(); // uiPhase = 'pauseRequested'

    // Simulate engine finishing the current slot and returning 'complete'
    updateProgressMock({ status: 'complete' });

    // Ensure the `.progress-hero` has shifted to the `progress-paused` classes
    const heroEl = container.querySelector('.progress-hero');
    expect(heroEl.classList.contains('progress-paused')).toBe(true);

    // Ensure paused UI replaces generating UI entirely
    const pausedTitle = container.querySelector('.paused-title');
    expect(pausedTitle).toBeDefined();
    expect(pausedTitle.textContent).toBe('Генерация приостановлена');

    // Ensure resume button is rendered
    const resumeBtn = container.querySelector('#btn-paused-resume');
    expect(resumeBtn).not.toBeNull();
  });

  it('4. Continue after paused (Resume flow)', async () => {
    // Setup paused state
    const pauseBtn = container.querySelector('#btn-pause');
    await pauseBtn.click();
    updateProgressMock({ status: 'complete' });

    const resumeBtn = container.querySelector('#btn-paused-resume');
    expect(resumeBtn).not.toBeNull();

    // Click continue
    await resumeBtn.click();
    // The navigate action is executed to remount progress asynchronously
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('progress');
    });
  });

  it('5. cancelConfirm phase', async () => {
    const cancelBtn = container.querySelector('#btn-cancel');
    
    // Click cancel
    await cancelBtn.click();

    const heroActions = container.querySelector('#hero-actions');
    const confirmStrip = container.querySelector('#cancel-confirm-strip');

    // Original buttons disappear, confirm strip appears
    expect(heroActions.style.display).toBe('none');
    expect(confirmStrip.style.display).toBe('flex');
    expect(confirmStrip.textContent).toContain('Отменить генерацию?');
  });

  it('6. cancelling phase & Anti-regression for cancel complete', async () => {
    // Initiate cancel -> click 'Yes, cancel'
    await container.querySelector('#btn-cancel').click(); // uiPhase = 'cancelConfirm'
    await container.querySelector('#btn-cancel-confirm').click(); // uiPhase = 'cancelling'

    expect(api.generate.cancel).toHaveBeenCalledOnce();

    const confirmStrip = container.querySelector('#cancel-confirm-strip');
    const cancellingStrip = container.querySelector('#cancelling-strip');

    expect(confirmStrip.style.display).toBe('none');
    expect(cancellingStrip.style.display).toBe('block');
    expect(cancellingStrip.textContent).toContain('Отменяю…');

    // Simulate engine finishing the cancel abort and returning 'complete'
    updateProgressMock({ status: 'complete' });

    // ANTI-REGRESSION: Check that the paused screen is NOT rendered
    const heroEl = container.querySelector('.progress-hero');
    expect(heroEl).not.toBeNull(); // Ensure element still exists
    expect(heroEl.classList.contains('progress-paused')).toBe(false); // NO paused layout!
    
    const pausedTitle = container.querySelector('.paused-title');
    expect(pausedTitle).toBeNull(); // Absolute assurance it wasn't mounted
    
    const resumeBtn = container.querySelector('#btn-paused-resume');
    expect(resumeBtn).toBeNull(); // Resume button is absent

    // Ensure we are redirecting away instead. 
    // Defaults to settings for 0 saved frames.
    expect(navigate).toHaveBeenCalledWith('settings');
  });

});

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocking the v4 app.js context
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
        loadPrompts: vi.fn().mockResolvedValue({ prompts: [{ id: 'p1', text: 'test' }] }),
        getImages: vi.fn().mockResolvedValue({ images: [] })
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

describe('UI State Machine — Tile Stability & DOM Ordering', () => {
  let container;
  let updateProgressMock;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);

    api.generate.onProgress.mockImplementation((cb) => {
      updateProgressMock = cb;
      return () => {};
    });

    state.generationRequested = true;
    await progressScreen.mount(container);
  });

  afterEach(() => {
    progressScreen.unmount();
  });

  it('1. Stable tile sorting regardless of event arrival order', async () => {
    // Inject tiles out of order
    // prompt 2, slot 1
    updateProgressMock({ step: 'saved', promptIndex: 2, savedSlot: 1, previewDataUrl: 'url_2_1' });
    // prompt 1, slot 2
    updateProgressMock({ step: 'saved', promptIndex: 1, savedSlot: 2, previewDataUrl: 'url_1_2' });
    // prompt 1, slot 1
    updateProgressMock({ step: 'saved', promptIndex: 1, savedSlot: 1, previewDataUrl: 'url_1_1' });
    updateProgressMock({ step: 'generate', promptCurrent: 2, current: 2 });
    updateProgressMock({ step: 'slot_failed', promptCurrent: 2, failedSlot: 2, failedReason: 'Timeout' });
    
    const grid = container.querySelector('#live-grid');
    const tiles = Array.from(grid.querySelectorAll('.live-tile'));
    
    // There should be 4 tiles
    expect(tiles.length).toBe(4);
    
    // Check dataset.key mapped values, order MUST be: p1-s1, p1-s2, p2-s1, p2-s2
    const keys = tiles.map(t => t.dataset.key);
    expect(keys).toEqual([
      'p1-s1',
      'p1-s2',
      'p2-s1',
      'p2-s2-fail'
    ]);
  });
  
  it('2. Missing/Undefined tile properties gracefully handled', async () => {
    // Trigger terminal state to shift into Idle state
    updateProgressMock({ step: 'generate', promptCurrent: 1, current: 1 });
    updateProgressMock({ step: 'saved', promptIndex: 1, savedSlot: 1, previewDataUrl: 'url_x' });
    updateProgressMock({ status: 'complete' });
    
    // Ensure idle screen displays the summary cleanly without 'undefined' string
    const idleHero = container.querySelector('.progress-hero');
    expect(idleHero.innerHTML).not.toContain('undefined');
    
    // Verify a tile in the grid has correct structure
    const idleGrid = container.querySelector('#live-grid');
    const idleTiles = Array.from(idleGrid.querySelectorAll('.live-tile'));
    expect(idleTiles.length).toBeGreaterThan(0);
    // Verify one of the tiles has slot 1 with correct markup
    expect(idleTiles[0].innerHTML).toContain('1.1'); 
  });
});

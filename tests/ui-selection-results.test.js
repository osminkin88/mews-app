/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../v4/app.js', () => ({
  api: {
    projects: {
      loadPrompts: vi.fn().mockResolvedValue({ prompts: [{}] }),
      getImages: vi.fn().mockResolvedValue({ images: [] }),
      getSelectedImages: vi.fn().mockResolvedValue({ success: false, images: [] }),
      update: vi.fn()
    }
  },
  navigate: vi.fn(),
  showToast: vi.fn(),
  state: {
    currentProject: { id: 'proj_1', name: 'Test' },
    selections: {}
  }
}));

describe('UI UX Regressions (Selection & Results)', () => {
  let selectionModule;
  let resultsModule;
  let container;

  beforeEach(async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    selectionModule = (await import('../v4/screens/selection.js')).default;
    resultsModule = (await import('../v4/screens/results.js')).default;
  });

  it('Selection: button "Выбрать этот вариант" is rendered when variant is not selected', async () => {
    const app = await import('../v4/app.js');
    app.api.projects.getImages = vi.fn().mockResolvedValue({
      images: [{ dataUrl: '1' }, { dataUrl: '2' }]
    });

    await selectionModule.mount(container);
    
    // Should have 2 thumbnails in filmstrip
    expect(container.querySelectorAll('.film-thumb').length).toBe(2);
    
    // Button should be visible because viewingVariant (0) is not selected initially
    const btn = container.querySelector('#btn-select-variant');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Выбрать этот вариант');
    
    await selectionModule.unmount();
  });

  it('Results: shows incomplete overlay if hasSelectedImages is false', async () => {
    const app = await import('../v4/app.js');
    app.api.projects.loadPrompts = vi.fn().mockResolvedValue({ prompts: [{}] });
    app.api.projects.getImages = vi.fn().mockResolvedValue({ images: [{ dataUrl: 'test' }] });
    app.api.projects.getSelectedImages = vi.fn().mockResolvedValue({ success: true, images: [] }); // EMPTY!
    
    await resultsModule.mount(container);
    
    // Button "Продолжить отбор" should exist
    const btnGotoSelection = container.querySelector('#btn-goto-selection');
    expect(btnGotoSelection).not.toBeNull();
    expect(btnGotoSelection.textContent).toContain('Продолжить отбор');
    
    await resultsModule.unmount();
  });
  
  it('Results: header parses human-readable set name', async () => {
    const app = await import('../v4/app.js');
    app.state.currentProject = {
      id: 'proj_1',
      name: 'My Project',
      activePromptSetId: 'set_123',
      promptSets: [{ id: 'set_123', name: 'Cool Set v1' }]
    };
    app.api.projects.getSelectedImages = vi.fn().mockResolvedValue({ success: true, images: [{ dataUrl: '1' }] });

    await resultsModule.mount(container);
    
    const header = container.querySelector('.res-project-name');
    expect(header).not.toBeNull();
    expect(header.innerHTML).toContain('Cool Set v1'); // Human readable name
    
    await resultsModule.unmount();
  });
});

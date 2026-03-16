/* ============================================================
   UNIT TESTS — Persistence Logic
   Tests for session/project state save/restore helpers.
   ============================================================ */
// globals: true in vitest.config provides describe, it, expect
const utils = require('../utils');

// ── restoreSelectionsFromProject ────────────────────────────

describe('restoreSelectionsFromProject', () => {
  it('restores valid selections', () => {
    const project = {
      selections: { "0": 2, "3": 1, "5": 0 },
      selectionCurrentPrompt: 5,
    };
    const result = utils.restoreSelectionsFromProject(project);
    expect(result.selections).toEqual({ "0": 2, "3": 1, "5": 0 });
    expect(result.selectionCurrentPrompt).toBe(5);
  });

  it('returns empty for null project', () => {
    const result = utils.restoreSelectionsFromProject(null);
    expect(result.selections).toEqual({});
    expect(result.selectionCurrentPrompt).toBe(0);
  });

  it('returns empty for project without selections', () => {
    const result = utils.restoreSelectionsFromProject({ name: 'Test' });
    expect(result.selections).toEqual({});
    expect(result.selectionCurrentPrompt).toBe(0);
  });

  it('normalizes numeric keys to strings', () => {
    // JSON round-trip might preserve numeric keys in some cases
    const project = { selections: { 0: 3, 1: 2 } };
    const result = utils.restoreSelectionsFromProject(project);
    expect(result.selections['0']).toBe(3);
    expect(result.selections['1']).toBe(2);
  });

  it('defaults selectionCurrentPrompt to 0 for non-numeric', () => {
    const project = { selections: { "0": 1 }, selectionCurrentPrompt: 'invalid' };
    const result = utils.restoreSelectionsFromProject(project);
    expect(result.selectionCurrentPrompt).toBe(0);
  });

  it('preserves empty selections object', () => {
    const project = { selections: {} };
    const result = utils.restoreSelectionsFromProject(project);
    expect(result.selections).toEqual({});
  });
});

// ── buildSessionSnapshot ────────────────────────────────────

describe('buildSessionSnapshot', () => {
  it('builds correct snapshot', () => {
    const snap = utils.buildSessionSnapshot('proj-123', 'selection', 6);
    expect(snap).toEqual({
      lastActiveProjectId: 'proj-123',
      lastScreen: 'selection',
      lastImagesPerPrompt: 6,
    });
  });

  it('handles null values with defaults', () => {
    const snap = utils.buildSessionSnapshot(null, null, null);
    expect(snap.lastActiveProjectId).toBeNull();
    expect(snap.lastScreen).toBe('projects');
    expect(snap.lastImagesPerPrompt).toBe(4);
  });

  it('handles undefined values', () => {
    const snap = utils.buildSessionSnapshot();
    expect(snap.lastActiveProjectId).toBeNull();
    expect(snap.lastScreen).toBe('projects');
    expect(snap.lastImagesPerPrompt).toBe(4);
  });
});

// ── buildProjectStateSnapshot ───────────────────────────────

describe('buildProjectStateSnapshot', () => {
  it('captures full state', () => {
    const state = {
      selections: { "0": 2, "1": 0 },
      selectionCurrentPrompt: 1,
      selectedModel: 'gpt_image',
      selectedQuality: 'High',
      selectedRatio: '16:9',
      imagesPerPrompt: 2,
      currentScreen: 'selection',
    };
    const snap = utils.buildProjectStateSnapshot(state);
    expect(snap.selections).toEqual({ "0": 2, "1": 0 });
    expect(snap.selectedModel).toBe('gpt_image');
    expect(snap.selectedQuality).toBe('High');
    expect(snap.selectedRatio).toBe('16:9');
    expect(snap.imagesPerPrompt).toBe(2);
    expect(snap.lastScreen).toBe('selection');
    expect(snap.selectionCurrentPrompt).toBe(1);
  });

  it('fills defaults for empty state', () => {
    const snap = utils.buildProjectStateSnapshot({});
    expect(snap.selections).toEqual({});
    expect(snap.selectedModel).toBe('nano_banana_pro');
    expect(snap.selectedQuality).toBe('2K');
    expect(snap.selectedRatio).toBe('1:1');
    expect(snap.imagesPerPrompt).toBe(4);
    expect(snap.lastScreen).toBe('projects');
  });

  it('survives JSON round-trip', () => {
    const state = {
      selections: { "5": 3, "10": 0 },
      selectionCurrentPrompt: 10,
      selectedModel: 'flux_2_pro',
      selectedQuality: '1K',
      selectedRatio: '3:4',
      imagesPerPrompt: 1,
      currentScreen: 'progress',
    };
    const snap = utils.buildProjectStateSnapshot(state);
    const json = JSON.stringify(snap);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(snap);
  });
});

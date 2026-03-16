/* ============================================================
   HIGGSFIELD STUDIO — Shared Utilities
   Pure functions extracted from main.js / app.js for testability.
   ============================================================ */

/**
 * Sanitize project name for use as folder name.
 * Preserves Cyrillic, Latin, numbers. Strips unsafe chars.
 * Adds numeric suffix if name already exists.
 */
function sanitizeFolderName(name, existingFolderNames = []) {
  let safe = (name || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  if (!safe) safe = 'Проект';

  const existingSet = new Set(existingFolderNames);
  if (!existingSet.has(safe)) return safe;

  for (let i = 2; i < 100; i++) {
    const candidate = `${safe} (${i})`;
    if (!existingSet.has(candidate)) return candidate;
  }
  return `${safe}_${Date.now()}`;
}

/**
 * Russian plural suffix for "промпт"
 */
function pluralRu(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return '';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'а';
  return 'ов';
}

/**
 * Escape HTML entities.
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Lighten a hex color by a given percent.
 */
function lightenColor(hex, percent) {
  if (!hex || typeof hex !== 'string') return 'rgb(200, 200, 200)';
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return 'rgb(200, 200, 200)';
  const num = parseInt(cleaned, 16);
  if (isNaN(num)) return 'rgb(200, 200, 200)';
  const r = Math.min(255, (num >> 16) + percent);
  const g = Math.min(255, ((num >> 8) & 0x00FF) + percent);
  const b = Math.min(255, (num & 0x0000FF) + percent);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Shorten a path for display (replace /Users/xxx with ~).
 */
function shortenPath(p) {
  if (!p) return '—';
  return p.replace(/^\/Users\/[^/]+/, '~');
}

/**
 * Merge selections from project.json into the runtime state.
 * Returns { selections, selectionCurrentPrompt }.
 */
function restoreSelectionsFromProject(project) {
  if (project && project.selections && typeof project.selections === 'object') {
    // Normalize keys to strings (JSON serialization may alter types)
    const normalized = {};
    for (const [k, v] of Object.entries(project.selections)) {
      normalized[String(k)] = v;
    }
    return {
      selections: normalized,
      selectionCurrentPrompt: typeof project.selectionCurrentPrompt === 'number'
        ? project.selectionCurrentPrompt
        : 0,
    };
  }
  return { selections: {}, selectionCurrentPrompt: 0 };
}

/**
 * Build a session snapshot to save in config.json.
 */
function buildSessionSnapshot(activeProjectId, currentScreen, imagesPerPrompt) {
  return {
    lastActiveProjectId: activeProjectId || null,
    lastScreen: currentScreen || 'projects',
    lastImagesPerPrompt: imagesPerPrompt || 4,
  };
}

/**
 * Build a project-state snapshot to save in project.json.
 */
function buildProjectStateSnapshot(state) {
  return {
    selections: state.selections || {},
    selectionCurrentPrompt: state.selectionCurrentPrompt || 0,
    selectedModel: state.selectedModel || 'nano_banana_pro',
    selectedQuality: state.selectedQuality || '2K',
    selectedRatio: state.selectedRatio || '1:1',
    imagesPerPrompt: state.imagesPerPrompt || 4,
    lastScreen: state.currentScreen || 'projects',
  };
}

// ── Exports ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizeFolderName,
    pluralRu,
    escapeHtml,
    lightenColor,
    shortenPath,
    restoreSelectionsFromProject,
    buildSessionSnapshot,
    buildProjectStateSnapshot,
  };
}

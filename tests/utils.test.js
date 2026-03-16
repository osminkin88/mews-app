/* ============================================================
   UNIT TESTS — utils.js (Pure functions)
   ============================================================ */
// globals: true in vitest.config provides describe, it, expect
const utils = require('../utils');

// ── sanitizeFolderName ──────────────────────────────────────

describe('sanitizeFolderName', () => {
  it('passes through safe names unchanged', () => {
    expect(utils.sanitizeFolderName('My Project')).toBe('My Project');
    expect(utils.sanitizeFolderName('Мой Проект')).toBe('Мой Проект');
  });

  it('strips unsafe filesystem characters', () => {
    expect(utils.sanitizeFolderName('hello<world>')).toBe('helloworld');
    expect(utils.sanitizeFolderName('test/path')).toBe('testpath');
    expect(utils.sanitizeFolderName('file:name')).toBe('filename');
    expect(utils.sanitizeFolderName('a"b*c?d|e')).toBe('abcde');
  });

  it('collapses whitespace', () => {
    expect(utils.sanitizeFolderName('hello   world')).toBe('hello world');
    expect(utils.sanitizeFolderName('  spaces  ')).toBe('spaces');
  });

  it('returns default for empty/null input', () => {
    expect(utils.sanitizeFolderName('')).toBe('Проект');
    expect(utils.sanitizeFolderName(null)).toBe('Проект');
    expect(utils.sanitizeFolderName(undefined)).toBe('Проект');
  });

  it('truncates to 80 chars', () => {
    const long = 'A'.repeat(100);
    expect(utils.sanitizeFolderName(long).length).toBe(80);
  });

  it('adds suffix on collision', () => {
    const existing = ['My Project'];
    expect(utils.sanitizeFolderName('My Project', existing)).toBe('My Project (2)');
  });

  it('increments suffix to find unique name', () => {
    const existing = ['Proj', 'Proj (2)', 'Proj (3)'];
    expect(utils.sanitizeFolderName('Proj', existing)).toBe('Proj (4)');
  });
});

// ── pluralRu ────────────────────────────────────────────────

describe('pluralRu', () => {
  it('returns correct Russian suffixes', () => {
    expect(utils.pluralRu(1)).toBe('');      // промпт
    expect(utils.pluralRu(2)).toBe('а');     // промпта
    expect(utils.pluralRu(3)).toBe('а');     // промпта
    expect(utils.pluralRu(4)).toBe('а');     // промпта
    expect(utils.pluralRu(5)).toBe('ов');    // промптов
    expect(utils.pluralRu(10)).toBe('ов');
    expect(utils.pluralRu(11)).toBe('ов');   // 11 = ов (не "")
    expect(utils.pluralRu(12)).toBe('ов');
    expect(utils.pluralRu(21)).toBe('');     // 21 промпт
    expect(utils.pluralRu(22)).toBe('а');
    expect(utils.pluralRu(100)).toBe('ов');
  });
});

// ── escapeHtml ──────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes special HTML characters', () => {
    expect(utils.escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(utils.escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    expect(utils.escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('handles empty/null input', () => {
    expect(utils.escapeHtml('')).toBe('');
    expect(utils.escapeHtml(null)).toBe('');
    expect(utils.escapeHtml(undefined)).toBe('');
  });
});

// ── lightenColor ────────────────────────────────────────────

describe('lightenColor', () => {
  it('lightens a hex color', () => {
    const result = utils.lightenColor('#000000', 50);
    expect(result).toBe('rgb(50, 50, 50)');
  });

  it('clamps to 255', () => {
    const result = utils.lightenColor('#FFFFFF', 50);
    expect(result).toBe('rgb(255, 255, 255)');
  });

  it('returns fallback for invalid input', () => {
    expect(utils.lightenColor(null, 10)).toBe('rgb(200, 200, 200)');
    expect(utils.lightenColor('', 10)).toBe('rgb(200, 200, 200)');
    expect(utils.lightenColor('invalid', 10)).toBe('rgb(200, 200, 200)');
    expect(utils.lightenColor('#xyz', 10)).toBe('rgb(200, 200, 200)');
  });
});

// ── shortenPath ─────────────────────────────────────────────

describe('shortenPath', () => {
  it('replaces user home with ~', () => {
    expect(utils.shortenPath('/Users/john/Documents/Mews')).toBe('~/Documents/Mews');
  });

  it('returns dash for empty input', () => {
    expect(utils.shortenPath(null)).toBe('—');
    expect(utils.shortenPath('')).toBe('—');
  });

  it('preserves non-user paths', () => {
    expect(utils.shortenPath('/tmp/test')).toBe('/tmp/test');
  });
});

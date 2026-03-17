/* ============================================================
   UNIT TESTS — higgsfield-engine download validation
   Locks the regression fixes around false retries caused by
   overly strict file-size checks.
   ============================================================ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../higgsfield-engine');

const tmpDirs = [];

function makeTempFile(name, buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-validate-'));
  tmpDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  return file;
}

function makeJpegBuffer(size) {
  // Minimal JPEG-like buffer: SOI + payload + EOI.
  const payload = Buffer.alloc(Math.max(0, size - 4), 0xaa);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    payload,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function makeHtmlBuffer(size) {
  const text = '<!DOCTYPE html><html><body>error</body></html>';
  return Buffer.alloc(size, text);
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('validateDownload', () => {
  it('accepts a valid small jpeg as preview instead of failing under 1MB', () => {
    const file = makeTempFile('preview.jpg', makeJpegBuffer(250 * 1024));

    const result = engine.validateDownload(file, {
      success: true,
      size: 250 * 1024,
      method: 'node_fetch_small',
    });

    expect(result.ok).toBe(true);
    expect(result.quality).toBe('preview');
    expect(result.format).toBe('jpeg');
    expect(result.size).toBeGreaterThan(10_000);
  });

  it('accepts a 1.5MB jpeg as acceptable quality', () => {
    const file = makeTempFile('acceptable.jpg', makeJpegBuffer(1_500_000));

    const result = engine.validateDownload(file, {
      success: true,
      size: 1_500_000,
      method: 'api_fullres',
    });

    expect(result.ok).toBe(true);
    expect(result.quality).toBe('acceptable');
    expect(result.format).toBe('jpeg');
  });

  it('rejects tiny files as corrupt', () => {
    const file = makeTempFile('tiny.jpg', makeJpegBuffer(8_000));

    const result = engine.validateDownload(file, {
      success: true,
      size: 8_000,
      method: 'preview_fallback',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('corrupt_tiny');
  });

  it('rejects non-image payloads even when they are large enough', () => {
    const file = makeTempFile('error.html', makeHtmlBuffer(20 * 1024));

    const result = engine.validateDownload(file, {
      success: true,
      size: 20 * 1024,
      method: 'browser_fetch',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('invalid_image_format');
  });

  it('rejects unsuccessful download results before touching file content', () => {
    const file = makeTempFile('broken.jpg', makeJpegBuffer(250 * 1024));

    const result = engine.validateDownload(file, {
      success: false,
      method: 'api_fullres',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('download_failed');
  });
});

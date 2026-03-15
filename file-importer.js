/* ============================================================
   FILE IMPORTER
   Reads CSV / XLSX files and extracts {id, prompt} rows.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// ── Parse CSV with auto-detection ─────────────────────────────
function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath);
  const encodings = ['utf-8', 'utf-16le'];
  const separators = [';', '\t', ','];

  for (const enc of encodings) {
    let text;
    try {
      text = new TextDecoder(enc).decode(raw);
      // Remove BOM
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    } catch {
      continue;
    }

    for (const sep of separators) {
      const rows = parseCSVText(text, sep);
      if (rows.length > 0) return rows;
    }
  }

  throw new Error('Не удалось прочитать CSV. Проверьте формат файла.');
}

function parseCSVText(text, separator) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Parse header
  const headerLine = lines[0];
  const headers = headerLine.split(separator).map(h =>
    h.trim().toLowerCase().replace(/^["']|["']$/g, '')
  );

  // Check for required columns
  const idIdx = headers.findIndex(h => h === 'id');
  const promptIdx = headers.findIndex(h => h === 'prompt');

  if (idIdx === -1 || promptIdx === -1) return [];

  // Parse rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(separator).map(c =>
      c.trim().replace(/^["']|["']$/g, '')
    );

    const id = cols[idIdx] || '';
    const prompt = cols[promptIdx] || '';

    if (id && prompt && prompt.toLowerCase() !== 'nan') {
      rows.push({ id, prompt });
    }
  }

  return rows;
}

// ── Parse XLSX ────────────────────────────────────────────────
function parseXLSX(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);

  // Normalize headers
  const rows = [];
  for (const row of data) {
    const normalizedRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalizedRow[key.trim().toLowerCase()] = String(value).trim();
    }

    const id = normalizedRow['id'] || '';
    const prompt = normalizedRow['prompt'] || '';

    if (id && prompt && prompt.toLowerCase() !== 'nan') {
      rows.push({ id, prompt });
    }
  }

  return rows;
}

// ── Import File (auto-detect format) ──────────────────────────
function importFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  try {
    let rows;
    if (ext === '.xlsx' || ext === '.xls') {
      rows = parseXLSX(filePath);
    } else if (ext === '.csv') {
      rows = parseCSV(filePath);
    } else {
      return { success: false, error: `Неподдерживаемый формат: ${ext}` };
    }

    if (rows.length === 0) {
      return {
        success: false,
        error: 'Файл пустой или не содержит колонок "id" и "prompt"',
      };
    }

    return { success: true, rows, count: rows.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { importFile, parseCSV, parseXLSX };

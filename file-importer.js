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

  // Column name mapping
  const HEADER_MAP = {
    'id': 'id',
    'промпт': 'prompt', 'prompt': 'prompt',
    'категория': 'category', 'category': 'category', 'тег': 'category', 'tag': 'category',
    'стиль': 'style', 'style': 'style',
    'комментарий': 'comment', 'comment': 'comment',
  };

  const colMap = {};
  headers.forEach((h, idx) => {
    const mapped = HEADER_MAP[h];
    if (mapped) colMap[mapped] = idx;
  });

  // Need at least prompt column
  if (colMap['prompt'] === undefined) return [];

  // Parse rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(separator).map(c =>
      c.trim().replace(/^["']|["']$/g, '')
    );

    const id = colMap['id'] !== undefined ? (cols[colMap['id']] || '') : String(i).padStart(3, '0');
    let prompt = colMap['prompt'] !== undefined ? (cols[colMap['prompt']] || '') : '';
    const category = colMap['category'] !== undefined ? (cols[colMap['category']] || '') : '';
    const style = colMap['style'] !== undefined ? (cols[colMap['style']] || '') : '';
    const comment = colMap['comment'] !== undefined ? (cols[colMap['comment']] || '') : '';

    if (!prompt || prompt.toLowerCase() === 'nan') continue;

    // Style is stored as metadata, NOT appended to prompt text
    // (insertText with \n breaks React contenteditable)

    rows.push({ id: id || String(rows.length + 1).padStart(3, '0'), prompt, category, style, comment });
  }

  return rows;
}

// ── Parse XLSX ────────────────────────────────────────────────
function parseXLSX(filePath) {
  const workbook = XLSX.readFile(filePath);
  // Use first sheet, but skip "Инструкция" if multiple sheets
  let sheetName = workbook.SheetNames[0];
  if (workbook.SheetNames.length > 1) {
    const dataSheet = workbook.SheetNames.find(n => n.toLowerCase() !== 'инструкция');
    if (dataSheet) sheetName = dataSheet;
  }
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);

  // Column name mapping (Russian → English)
  const COLUMN_MAP = {
    'id': 'id',
    'промпт': 'prompt', 'prompt': 'prompt',
    'категория': 'category', 'category': 'category', 'тег': 'category', 'tag': 'category',
    'стиль': 'style', 'style': 'style',
    'комментарий': 'comment', 'comment': 'comment', 'заметка': 'comment', 'note': 'comment',
  };

  const rows = [];
  for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      const mapped = COLUMN_MAP[key.trim().toLowerCase()];
      if (mapped) normalized[mapped] = String(value).trim();
    }

    // Auto-generate ID if missing
    const id = normalized['id'] || String(rowIdx + 1).padStart(3, '0');
    let prompt = normalized['prompt'] || '';
    const category = normalized['category'] || '';
    const style = normalized['style'] || '';
    const comment = normalized['comment'] || '';

    if (!prompt || prompt.toLowerCase() === 'nan') continue;

    // Style is stored as metadata, NOT appended to prompt text

    rows.push({ id, prompt, category, style, comment });
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
        error: 'Файл пустой или не содержит колонки «Промпт» (или «prompt»). Скачайте шаблон для правильного формата.',
      };
    }

    return { success: true, rows, count: rows.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { importFile, parseCSV, parseXLSX };

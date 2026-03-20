/* ============================================================
   GOOGLE SHEETS IMPORTER
   Fetches prompts from a public Google Sheets via CSV export.
   No OAuth required — uses the public /export?format=csv endpoint.
   ============================================================ */

const SHEETS_URL_REGEX = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;
const GID_REGEX = /[#&?]gid=(\d+)/;

// Known prompt column names (case-insensitive)
const PROMPT_COLUMN_NAMES = ['prompt', 'промпт', 'prompts', 'промпты', 'text', 'текст'];

/**
 * Parse a Google Sheets URL into its components.
 * @param {string} url — any Google Sheets URL
 * @returns {{ valid: boolean, spreadsheetId?: string, gid?: number, exportUrl?: string, error?: string }}
 */
function parseUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'Вставьте ссылку на Google Sheets' };
  }

  const trimmed = url.trim();

  // Must be a Google Sheets URL
  if (!trimmed.includes('docs.google.com/spreadsheets')) {
    return { valid: false, error: 'Это не ссылка на Google Sheets' };
  }

  const idMatch = trimmed.match(SHEETS_URL_REGEX);
  if (!idMatch) {
    return { valid: false, error: 'Не удалось найти ID таблицы в ссылке' };
  }

  const spreadsheetId = idMatch[1];
  const gidMatch = trimmed.match(GID_REGEX);
  const gid = gidMatch ? parseInt(gidMatch[1], 10) : 0;

  const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;

  return { valid: true, spreadsheetId, gid, exportUrl };
}

/**
 * Fetch CSV data from the Google Sheets export endpoint.
 * @param {string} exportUrl — the /export?format=csv URL
 * @param {number} [timeoutMs=15000] — timeout in ms
 * @returns {Promise<{ success: boolean, csvText?: string, error?: string }>}
 */
async function fetchSheetCSV(exportUrl, timeoutMs = 15000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(exportUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mews/1.0',
      },
      redirect: 'follow',
    });

    clearTimeout(timer);

    if (!response.ok) {
      if (response.status === 403 || response.status === 401) {
        return {
          success: false,
          error: 'Таблица недоступна. Откройте доступ: Файл → Настройки доступа → «Все, у кого есть ссылка»',
        };
      }
      if (response.status === 404) {
        return { success: false, error: 'Таблица не найдена. Проверьте ссылку.' };
      }
      return { success: false, error: `Ошибка загрузки: HTTP ${response.status}` };
    }

    const csvText = await response.text();

    if (!csvText || csvText.trim().length === 0) {
      return { success: false, error: 'Таблица пуста' };
    }

    // Google sometimes returns HTML (login page) instead of CSV
    if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
      return {
        success: false,
        error: 'Таблица недоступна. Откройте доступ: Файл → Настройки доступа → «Все, у кого есть ссылка»',
      };
    }

    return { success: true, csvText };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Таймаут — таблица слишком долго отвечает' };
    }
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.message?.includes('fetch')) {
      return { success: false, error: 'Нет подключения к интернету' };
    }
    return { success: false, error: `Ошибка: ${err.message}` };
  }
}

/**
 * Parse CSV text into structured data with header detection.
 * @param {string} csvText — raw CSV string
 * @returns {{ headers: string[], rows: object[], promptColumn: string|null, allColumns: string[] }}
 */
function parseCSVFromSheets(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 1) {
    return { headers: [], rows: [], promptColumn: null, allColumns: [] };
  }

  // Parse header row (handle quoted values)
  const headers = parseCsvLine(lines[0]);
  const headersLower = headers.map(h => h.trim().toLowerCase());

  // Auto-detect prompt column
  let promptColIdx = -1;
  for (const name of PROMPT_COLUMN_NAMES) {
    const idx = headersLower.indexOf(name);
    if (idx !== -1) {
      promptColIdx = idx;
      break;
    }
  }

  // If no known column found, try to use the first non-empty text column
  if (promptColIdx === -1 && headers.length > 0) {
    // Check second row to find a column with long text
    if (lines.length > 1) {
      const sampleCols = parseCsvLine(lines[1]);
      for (let i = 0; i < sampleCols.length; i++) {
        if (sampleCols[i] && sampleCols[i].length > 10) {
          promptColIdx = i;
          break;
        }
      }
    }
  }

  const promptColumn = promptColIdx >= 0 ? headers[promptColIdx] : null;

  // Parse data rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] || '').trim();
    });
    rows.push(row);
  }

  return {
    headers,
    rows,
    promptColumn,
    allColumns: headers,
  };
}

/**
 * Parse a single CSV line respecting quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Extract prompts from parsed sheet data.
 * @param {object[]} rows — parsed rows from parseCSVFromSheets
 * @param {string} promptColumn — column name containing prompts
 * @returns {{ prompts: object[], skippedCount: number }}
 */
function extractPrompts(rows, promptColumn) {
  const COLUMN_MAP = {
    'id': 'id',
    'промпт': 'prompt', 'prompt': 'prompt', 'prompts': 'prompt', 'промпты': 'prompt',
    'text': 'prompt', 'текст': 'prompt',
    'категория': 'category', 'category': 'category', 'тег': 'category', 'tag': 'category',
    'стиль': 'style', 'style': 'style',
    'комментарий': 'comment', 'comment': 'comment', 'заметка': 'comment', 'note': 'comment',
  };

  const prompts = [];
  let skippedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const normalized = {};

    for (const [key, value] of Object.entries(row)) {
      const mapped = COLUMN_MAP[key.trim().toLowerCase()];
      if (mapped) {
        normalized[mapped] = String(value).trim();
      }
    }

    // Use the specified prompt column if mapping didn't work
    if (!normalized.prompt && promptColumn) {
      normalized.prompt = (row[promptColumn] || '').trim();
    }

    const id = normalized.id || String(i + 1).padStart(3, '0');
    const prompt = normalized.prompt || '';
    const category = normalized.category || '';
    const style = normalized.style || '';
    const comment = normalized.comment || '';

    if (!prompt || prompt.toLowerCase() === 'nan') {
      skippedCount++;
      continue;
    }

    prompts.push({ id, prompt, category, style, comment });
  }

  return { prompts, skippedCount };
}

/**
 * Full pipeline: validate URL → fetch → parse → extract prompts.
 * Used for preview and sync.
 * @param {string} url — Google Sheets URL
 * @param {string} [overrideColumn] — force a specific column name
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
async function fetchAndParse(url, overrideColumn) {
  // 1. Parse URL
  const parsed = parseUrl(url);
  if (!parsed.valid) {
    return { success: false, error: parsed.error };
  }

  // 2. Fetch CSV
  const fetched = await fetchSheetCSV(parsed.exportUrl);
  if (!fetched.success) {
    return { success: false, error: fetched.error };
  }

  // 3. Parse CSV
  const csvData = parseCSVFromSheets(fetched.csvText);
  if (csvData.headers.length === 0) {
    return { success: false, error: 'Таблица не содержит заголовков' };
  }

  // 4. Determine prompt column
  const promptColumn = overrideColumn || csvData.promptColumn;
  if (!promptColumn) {
    return {
      success: false,
      error: 'Не найдена колонка с промптами. Ожидается: «prompt» или «промпт»',
      columns: csvData.allColumns,
    };
  }

  // 5. Extract prompts
  const { prompts, skippedCount } = extractPrompts(csvData.rows, promptColumn);

  if (prompts.length === 0) {
    return {
      success: false,
      error: 'Не найдено ни одного промпта. Проверьте таблицу.',
    };
  }

  // 6. Build preview (first 3 prompts)
  const preview = prompts.slice(0, 3).map(p => p.prompt.substring(0, 100));

  return {
    success: true,
    data: {
      spreadsheetId: parsed.spreadsheetId,
      gid: parsed.gid,
      exportUrl: parsed.exportUrl,
      promptColumn,
      allColumns: csvData.allColumns,
      totalRows: csvData.rows.length,
      skippedCount,
      promptCount: prompts.length,
      preview,
      prompts,
    },
  };
}

module.exports = {
  parseUrl,
  fetchSheetCSV,
  parseCSVFromSheets,
  extractPrompts,
  fetchAndParse,
};

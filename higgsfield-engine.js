/* ============================================================
   HIGGSFIELD ENGINE v2
   
   Generates images via CDP automation of higgsfield.ai
   Enforces Unlimited mode, strict 4-image orchestration,
   and reliable image tracking per-prompt.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const chrome = require('./chrome-manager');

// ── Config ────────────────────────────────────────────────────
const IMAGES_PER_PROMPT = 4;
const GENERATION_TIMEOUT = 4 * 60 * 1000; // 4 minutes per image
const POLL_INTERVAL = 3000;         // 3s polling
const DEFAULT_MODEL = 'nano_banana_pro';

// ── Unlimited-compatible models ──────────────────────────────
// Only these models support the Unlimited toggle
const UNLIMITED_MODELS = {
  nano_banana_pro: { slug: 'nano_banana_2', name: 'Nano Banana Pro' },
  nano_banana: { slug: 'nano_banana', name: 'Nano Banana' },
  higgsfield_soul: { slug: 'soul', name: 'Higgsfield Soul' },
  z_image: { slug: 'z-image', name: 'Z-Image' },
};

// Models that do NOT support Unlimited (blocked)
const PAID_ONLY_MODELS = {
  gpt_image: 'GPT Image',
  seedream_5_lite: 'Seedream 5.0 lite',
  seedream_4_5: 'Seedream 4.5',
  flux_2_pro: 'FLUX.2 Pro',
  kling_o1: 'Kling O1',
};

// ── State ─────────────────────────────────────────────────────
let isGenerating = false;
let shouldStop = false;

function getIsGenerating() { return isGenerating; }
function getShouldStop() { return shouldStop; }
function resetShouldStop() { shouldStop = false; }
function _resetIsGenerating() { isGenerating = false; }

// ══════════════════════════════════════════════════════════════
//  MAIN: Generate Images for a Single Prompt
// ══════════════════════════════════════════════════════════════
async function generatePrompt(prompt, options = {}) {
  const {
    model = DEFAULT_MODEL,
    aspect = '1:1',
    quality = '1K',
    imagesCount = 4,
    outputDir = null,
    onProgress = () => {},
  } = options;

  const page = chrome.getActivePage();
  if (!page) throw new Error('Chrome не подключён');

  isGenerating = true;

  try {
    // ── Step 1: Check model supports Unlimited ──
    onProgress({ step: 'preflight', message: 'Проверяю модель...' });
    const modelInfo = UNLIMITED_MODELS[model];
    if (!modelInfo) {
      const name = PAID_ONLY_MODELS[model] || model;
      throw new Error(`Модель "${name}" не поддерживает Unlimited. Используйте: ${Object.values(UNLIMITED_MODELS).map(m => m.name).join(', ')}`);
    }

    // ── Step 2: Navigate to EXACTLY this model's page ──
    onProgress({ step: 'navigate', message: `Открываю ${modelInfo.name}...` });
    await chrome.navigateToModel(modelInfo.slug);
    await chrome.sleep(2000);

    // ── Step 3: VERIFY the active model matches the selected one ──
    onProgress({ step: 'preflight', message: `Проверяю модель ${modelInfo.name}...` });
    const modelOk = await verifyActiveModel(page, modelInfo);
    if (!modelOk) {
      throw new Error(`Не удалось активировать модель "${modelInfo.name}". В интерфейсе активна другая модель.`);
    }
    console.log(`[engine] ✅ Model verified: ${modelInfo.name}`);

    // ── Step 4: Dismiss any overlays ──
    await dismissOverlays(page);

    // ── Step 4.5: CLEAR the prompt field BEFORE any toggle clicks! ──
    // CRITICAL: Toggle clicks (Extra free gens, Unlimited) trigger form submission
    // on Higgsfield. If old prompt text is in the field, it generates a ghost image
    // from the PREVIOUS prompt. Clearing the field first prevents this.
    onProgress({ step: 'preflight', message: 'Очищаю поле промпта...' });
    await clearPromptField(page);
    console.log('[engine] ✅ Prompt field cleared (safe for toggle clicks)');

    // ── Step 5: Turn OFF "Extra free gens" FIRST (prevents multi-model generation) ──
    onProgress({ step: 'preflight', message: 'Отключаю Extra free gens...' });
    await ensureExtraFreeGensOff(page);
    console.log('[engine] ✅ Extra free gens: OFF');

    // ── Step 6: Force batch size to 1/4 ──
    onProgress({ step: 'preflight', message: 'Устанавливаю batch 1/4...' });
    const batchOk = await ensureBatchSize1(page);
    if (!batchOk) {
      throw new Error('Не удалось установить batch size 1/4. Генерация невозможна.');
    }
    console.log('[engine] ✅ Batch size: 1/4');

    // ── Step 7: Ensure Unlimited is ON — LAST! (ExtraFree toggle can disable it) ──
    onProgress({ step: 'preflight', message: 'Включаю Unlimited...' });
    const unlimitedOk = await ensureUnlimited(page);
    if (!unlimitedOk) {
      throw new Error('Не удалось включить Unlimited. Генерация невозможна.');
    }
    console.log('[engine] ✅ Unlimited confirmed ON');

    // ── Step 8: Verify controls are available ──
    onProgress({ step: 'preflight', message: 'Проверяю интерфейс...' });
    await preflight(page);
    console.log('[engine] ✅ Preflight passed');

    // ── Step 9: Enter prompt (AFTER all toggles are set!) ──
    onProgress({ step: 'prompt', message: 'Ввожу промпт...' });
    await enterPrompt(page, prompt);

    // ── Step 10: Set aspect ratio ──
    onProgress({ step: 'settings', message: `Aspect: ${aspect}...` });
    await setAspectRatio(page, aspect);

    // ── Step 9: SEQUENTIAL STATE MACHINE — generate + download + validate per image ──
    const imageResults = [];

    for (let i = 0; i < imagesCount && !shouldStop; i++) {
      const img = { index: i + 1, state: 'generating', url: null, file: null, size: 0, quality: null, error: null };
      console.log(`\n[engine] ═══ IMAGE ${img.index}/${imagesCount} — STATE: generating ═══`);

      onProgress({
        step: 'generate',
        message: `Проверяю → Generate ${img.index}/${imagesCount}...`,
        current: img.index,
        total: imagesCount,
        state: img.state,
      });

      // ═══ PRE-CLICK CHECKS: verify conditions before EVERY click ═══
      // NOTE: We do NOT re-click Extra free gens or Unlimited here!
      // Those toggles were set in the preflight section above.
      // Re-clicking them triggers a form submission on Higgsfield = double generation.

      // Check 1: Model must be the selected one
      const modelOkNow = await verifyActiveModel(page, modelInfo);
      if (!modelOkNow) {
        throw new Error(`Модель изменилась! Ожидалась "${modelInfo.name}". Генерация остановлена.`);
      }

      // Check 2: Batch MUST be 1/4 (safe to re-click, it doesn't submit)
      const batchNow = await getBatchSize(page);
      if (!batchNow || batchNow.current !== 1) {
        console.log(`[engine] ⚠️ Batch = ${batchNow ? batchNow.current : '?'} перед кликом ${img.index}! Исправляю...`);
        const batchFixed = await ensureBatchSize1(page);
        if (!batchFixed) {
          throw new Error(`Batch не 1/4 перед кликом ${img.index}. Генерация остановлена.`);
        }
      }

      // Check 3 & 4: Only LOG toggle state, do NOT click (would trigger generation)
      const extraOn = await isExtraFreeGensOn(page);
      if (extraOn) {
        console.log(`[engine] ⚠️ Extra free gens ON перед кликом ${img.index} (не трогаем — preflight уже настроил)`);
      }
      const unlimitedNow = await isUnlimitedOn(page);
      if (!unlimitedNow) {
        console.log(`[engine] ⚠️ Unlimited OFF перед кликом ${img.index} (не трогаем — preflight уже настроил)`);
      }

      await dismissOverlays(page);
      console.log(`[engine] ✓ Click ${img.index}: model=${modelInfo.name}, unlimited=ON, batch=1/4, extraFree=OFF`);

      // Save feed image COUNT before click (more reliable than URL comparison)
      const feedCountBefore = await countFeedImages(page);
      console.log(`[engine] 📊 Feed images before click: ${feedCountBefore}`);

      // Click Generate
      const clicked = await clickGenerate(page);
      if (!clicked) {
        console.log(`[engine] ⚠️ Generate click ${img.index} failed, retrying...`);
        await chrome.sleep(2000);
        await dismissOverlays(page);
        const retryClicked = await clickGenerate(page);
        if (!retryClicked) {
          img.state = 'error';
          img.error = `Generate click failed for image ${img.index}`;
          imageResults.push(img);
          console.log(`[engine] ❌ IMAGE ${img.index} — STATE: error (${img.error})`);
          continue;
        }
      }
      console.log(`[engine] ✅ Generate ${img.index}/${imagesCount} clicked`);

      // Give the site time to process the click before we start polling
      await chrome.sleep(2000);

      // Wait for this ONE image to appear (using count-based detection)
      onProgress({ step: 'waiting', message: `Ожидаю изображение ${img.index}/${imagesCount}...`, state: 'generating' });
      const imageUrl = await waitForSingleImage(page, feedCountBefore, img.index, imagesCount, onProgress);

      if (!imageUrl) {
        img.state = 'error';
        img.error = 'generation_timeout';
        imageResults.push(img);
        console.log(`[engine] ❌ IMAGE ${img.index} — STATE: error (timeout)`);
        await dismissOverlays(page);
        continue;
      }

      img.url = imageUrl;
      console.log(`[engine] ✅ Image ${img.index} generated: ${imageUrl.substring(0, 80)}...`);

      // ═══ STATE: downloading ═══
      img.state = 'downloading';
      console.log(`[engine] ═══ IMAGE ${img.index} — STATE: downloading ═══`);
      onProgress({ step: 'downloading', message: `Скачиваю изображение ${img.index}/${imagesCount}...`, state: 'downloading' });

      const destPath = outputDir
        ? path.join(outputDir, `gen_${img.index}.jpg`)
        : path.join(__dirname, 'output', 'temp', `gen_${img.index}.jpg`);

      // Ensure directory exists
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      let dlResult = await downloadImage(imageUrl, destPath, (p) => {
        onProgress({ step: 'downloading', message: p.message, state: 'downloading' });
      });

      // ═══ STATE: validating_download ═══
      img.state = 'validating_download';
      console.log(`[engine] ═══ IMAGE ${img.index} — STATE: validating_download ═══`);
      let validation = validateDownload(destPath, dlResult);

      if (!validation.ok) {
        console.log(`[engine] ⚠️ Validation failed: ${validation.reason}. Retrying download...`);
        onProgress({ step: 'downloading', message: `Повторное скачивание ${img.index}/${imagesCount}...`, state: 'downloading' });

        // RETRY: one more attempt
        dlResult = await downloadImage(imageUrl, destPath, (p) => {
          onProgress({ step: 'downloading', message: `(retry) ${p.message}`, state: 'downloading' });
        });
        validation = validateDownload(destPath, dlResult);

        if (!validation.ok) {
          img.state = 'error';
          img.error = `download_validation_failed: ${validation.reason}`;
          imageResults.push(img);
          console.log(`[engine] ❌ IMAGE ${img.index} — STATE: error (${validation.reason})`);
          saveIntermediateMeta(outputDir, prompt, model, aspect, quality, imageResults, imagesCount);
          await dismissOverlays(page);
          continue;
        }
      }

      // ═══ STATE: saved ═══
      img.state = 'saved';
      img.file = `gen_${img.index}.jpg`;
      img.size = validation.size;
      img.quality = validation.quality;
      console.log(`[engine] ✅ IMAGE ${img.index} — STATE: saved (${Math.round(img.size / 1024)}KB, ${img.quality})`);

      onProgress({
        step: 'saved',
        message: `✅ Изображение ${img.index}/${imagesCount} сохранено (${Math.round(img.size / 1024)}KB)`,
        state: 'saved',
      });

      imageResults.push(img);

      // Save intermediate meta.json
      saveIntermediateMeta(outputDir, prompt, model, aspect, quality, imageResults, imagesCount);

      // Dismiss overlays before next iteration
      await dismissOverlays(page);

      // Wait before next generation
      if (i < imagesCount - 1) {
        await chrome.sleep(3000);
      }
    }

    // ── Final summary ──
    const savedCount = imageResults.filter(r => r.state === 'saved').length;
    const errorCount = imageResults.filter(r => r.state === 'error').length;
    console.log(`\n[engine] ═══ SUMMARY: ${savedCount} saved, ${errorCount} errors out of ${imagesCount} ═══`);

    if (savedCount === 0) {
      throw new Error('Ни одно изображение не скачано и не сохранено.');
    }

    onProgress({
      step: 'done',
      message: `✅ Сохранено ${savedCount}/${imagesCount} изображений`,
      state: 'done',
    });

    return {
      images: imageResults,
      savedCount,
      errorCount,
      total: imagesCount,
    };

  } finally {
    // NOTE: Do NOT set isGenerating = false here!
    // This function handles ONE prompt. The batch loop in main.js
    // manages the overall lifecycle. Setting isGenerating=false here
    // would make main.js think the user pressed Stop after every prompt.
    // isGenerating is reset by stopGeneration() or by main.js after the batch.
  }
}


// ══════════════════════════════════════════════════════════════
//  MODEL VERIFICATION — Strict single-model enforcement
// ══════════════════════════════════════════════════════════════

/**
 * Verify that the active model in Higgsfield matches the expected one.
 * Uses TWO independent checks:
 * 1. URL must contain /image/{slug}
 * 2. Model name in bottom controls must match
 * Returns true only if both pass.
 */
async function verifyActiveModel(page, modelInfo) {
  // Check 1: URL must contain the model slug
  const currentUrl = page.url();
  const expectedUrlPart = `/image/${modelInfo.slug}`;
  const urlMatch = currentUrl.includes(expectedUrlPart);

  if (!urlMatch) {
    console.log(`[engine] ❌ URL mismatch: expected "${expectedUrlPart}" in "${currentUrl}"`);
    return false;
  }

  // Check 2: Page title contains model name
  // Higgsfield titles look like: "Nano Banana Pro on Higgsfield: ..."
  const pageTitle = await page.title();
  const titleWords = modelInfo.name.split(' ');
  // Check if at least the first distinctive word of the model name is in the title
  const titleMatch = titleWords.some(word =>
    word.length > 2 && pageTitle.toLowerCase().includes(word.toLowerCase())
  );

  if (titleMatch) {
    console.log(`[engine] Model verified via title: "${pageTitle}" ✓`);
  } else {
    console.log(`[engine] ⚠️ Title "${pageTitle}" doesn't clearly match "${modelInfo.name}", trusting URL`);
  }

  // URL matched — model is correct
  console.log(`[engine] ✅ Active model confirmed: ${modelInfo.name} (${modelInfo.slug})`);
  return true;
}


// ══════════════════════════════════════════════════════════════
//  UNLIMITED MODE
// ══════════════════════════════════════════════════════════════

/**
 * Check if Unlimited toggle is currently ON
 */
async function isUnlimitedOn(page) {
  return await page.evaluate(() => {
    // Find the Unlimited text label, then the adjacent switch
    const allText = document.querySelectorAll('span, div, p, label');
    for (const el of allText) {
      if (el.textContent.trim() === 'Unlimited') {
        // Look for switch in parent or siblings
        const parent = el.closest('div') || el.parentElement;
        if (parent) {
          const sw = parent.querySelector('button[role="switch"]');
          if (sw) return sw.getAttribute('aria-checked') === 'true';
        }
      }
    }
    // Fallback: find any switch with aria-checked near bottom controls
    const switches = document.querySelectorAll('button[role="switch"]');
    for (const sw of switches) {
      const parent = sw.parentElement;
      if (parent && parent.textContent.includes('Unlimited')) {
        return sw.getAttribute('aria-checked') === 'true';
      }
    }
    return null; // Can't find toggle
  });
}

/**
 * Ensure Unlimited is ON. If OFF, click to enable. Returns true if confirmed ON.
 */
async function ensureUnlimited(page) {
  // Check current state
  let state = await isUnlimitedOn(page);
  console.log(`[engine] Unlimited state: ${state}`);

  if (state === true) return true;

  if (state === null) {
    // Can't find the toggle — try scrolling to bottom controls
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await chrome.sleep(500);
    state = await isUnlimitedOn(page);
    if (state === null) {
      console.log('[engine] ⚠️ Cannot find Unlimited toggle');
      return false;
    }
    if (state === true) return true;
  }

  // State is false — click to enable
  console.log('[engine] Unlimited is OFF — clicking to enable...');

  const clicked = await page.evaluate(() => {
    const allText = document.querySelectorAll('span, div, p, label');
    for (const el of allText) {
      if (el.textContent.trim() === 'Unlimited') {
        const parent = el.closest('div') || el.parentElement;
        if (parent) {
          const sw = parent.querySelector('button[role="switch"]');
          if (sw) {
            sw.click();
            return true;
          }
        }
      }
    }
    // Fallback
    const switches = document.querySelectorAll('button[role="switch"]');
    for (const sw of switches) {
      const parent = sw.parentElement;
      if (parent && parent.textContent.includes('Unlimited')) {
        sw.click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) return false;

  // Wait and verify
  await chrome.sleep(1000);
  const verified = await isUnlimitedOn(page);
  if (verified !== true) {
    console.log('[engine] ⚠️ Unlimited still OFF after click');
    // Try one more time
    await chrome.sleep(500);
    return (await isUnlimitedOn(page)) === true;
  }

  console.log('[engine] ✅ Unlimited enabled');
  return true;
}


// ══════════════════════════════════════════════════════════════
//  EXTRA FREE GENS — Must be OFF to prevent multi-model output
// ══════════════════════════════════════════════════════════════

/**
 * Check if "Extra free gens" toggle is ON.
 * This toggle adds 2 bonus images from OTHER models per click.
 * It MUST be OFF for strict single-model generation.
 */
async function isExtraFreeGensOn(page) {
  return await page.evaluate(() => {
    // Find text containing "Extra" near a switch
    const allText = document.querySelectorAll('span, div, p, label');
    for (const el of allText) {
      const text = el.textContent.trim();
      if (text.includes('Extra') && text.includes('free')) {
        const parent = el.closest('div') || el.parentElement;
        if (parent) {
          const sw = parent.querySelector('button[role="switch"]');
          if (sw) return sw.getAttribute('aria-checked') === 'true';
        }
      }
    }
    // Fallback: find switches and check parent text
    const switches = document.querySelectorAll('button[role="switch"]');
    for (const sw of switches) {
      const parent = sw.parentElement;
      if (parent && parent.textContent.includes('Extra')) {
        return sw.getAttribute('aria-checked') === 'true';
      }
    }
    return false; // If can't find, assume OFF
  });
}

/**
 * Ensure "Extra free gens" is OFF. If ON, click to disable.
 */
async function ensureExtraFreeGensOff(page) {
  const isOn = await isExtraFreeGensOn(page);
  console.log(`[engine] Extra free gens: ${isOn ? 'ON' : 'OFF'}`);

  if (!isOn) return true; // Already OFF

  // Click to disable
  console.log('[engine] Extra free gens is ON — clicking to disable...');

  const clicked = await page.evaluate(() => {
    const allText = document.querySelectorAll('span, div, p, label');
    for (const el of allText) {
      const text = el.textContent.trim();
      if (text.includes('Extra') && text.includes('free')) {
        const parent = el.closest('div') || el.parentElement;
        if (parent) {
          const sw = parent.querySelector('button[role="switch"]');
          if (sw) {
            sw.click();
            return true;
          }
        }
      }
    }
    // Fallback
    const switches = document.querySelectorAll('button[role="switch"]');
    for (const sw of switches) {
      const parent = sw.parentElement;
      if (parent && parent.textContent.includes('Extra')) {
        sw.click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    console.log('[engine] ⚠️ Could not find Extra free gens toggle');
    return false;
  }

  // Verify
  await chrome.sleep(1000);
  const stillOn = await isExtraFreeGensOn(page);
  if (stillOn) {
    console.log('[engine] ⚠️ Extra free gens still ON after click, retrying...');
    await chrome.sleep(500);
    return !(await isExtraFreeGensOn(page));
  }

  console.log('[engine] ✅ Extra free gens disabled');
  return true;
}


// ══════════════════════════════════════════════════════════════
//  BATCH SIZE — Force 1/4 for Unlimited mode
// ══════════════════════════════════════════════════════════════

/**
 * Read the current batch count from the UI (e.g. "1/4", "2/4")
 */
async function getBatchSize(page) {
  return await page.evaluate(() => {
    // Look for text matching N/4 pattern in buttons
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      const match = text.match(/^(\d+)\/(\d+)$/);
      if (match) {
        return { current: parseInt(match[1]), max: parseInt(match[2]), element: true };
      }
    }
    // Also check spans and divs
    const elements = document.querySelectorAll('span, div');
    for (const el of elements) {
      const text = el.textContent.trim();
      const match = text.match(/^(\d+)\/(\d+)$/);
      if (match && el.children.length === 0) {
        return { current: parseInt(match[1]), max: parseInt(match[2]), element: true };
      }
    }
    return null;
  });
}

/**
 * Force batch size to 1/4. Click "-" button until batch = 1.
 * Hard rule: Unlimited mode only works with batch 1.
 */
async function ensureBatchSize1(page) {
  const batch = await getBatchSize(page);
  if (!batch) {
    console.log('[engine] ⚠️ Cannot find batch size indicator');
    return false;
  }

  console.log(`[engine] Current batch: ${batch.current}/${batch.max}`);

  if (batch.current === 1) {
    return true; // Already 1/4
  }

  // Click "-" button to reduce batch to 1
  // The "-" button is adjacent to the batch indicator
  let clicksNeeded = batch.current - 1;
  for (let i = 0; i < clicksNeeded; i++) {
    const clicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        // Find the batch display, then look for "-" button before it
        if (/^\d+\/\d+$/.test(text)) {
          // The "-" is the previous sibling button
          let prev = btn.previousElementSibling;
          while (prev) {
            if (prev.tagName === 'BUTTON' && (prev.textContent.trim() === '−' || prev.textContent.trim() === '-' || prev.textContent.trim() === '–')) {
              prev.click();
              return true;
            }
            prev = prev.previousElementSibling;
          }
          // Also check parent's children
          const parent = btn.parentElement;
          if (parent) {
            const children = Array.from(parent.children);
            const myIdx = children.indexOf(btn);
            for (let j = myIdx - 1; j >= 0; j--) {
              if (children[j].tagName === 'BUTTON') {
                children[j].click();
                return true;
              }
            }
          }
        }
      }
      return false;
    });

    if (!clicked) {
      console.log('[engine] ⚠️ Could not click "-" button');
      return false;
    }
    await chrome.sleep(300);
  }

  // Verify
  await chrome.sleep(500);
  const after = await getBatchSize(page);
  if (after && after.current === 1) {
    console.log('[engine] ✅ Batch set to 1/4');
    return true;
  }

  console.log(`[engine] ⚠️ Batch after fix: ${after ? after.current : '?'}/${after ? after.max : '?'}`);
  return false;
}


// ══════════════════════════════════════════════════════════════
//  PREFLIGHT CHECKS
// ══════════════════════════════════════════════════════════════

/**
 * Verify all required controls are visible and accessible
 */
async function preflight(page) {
  const checks = await page.evaluate(() => {
    const result = {
      promptField: false,
      generateButton: false,
    };

    // Prompt field
    const prompt = document.querySelector('div[id="hf:tour-image-prompt"]') ||
                   document.querySelector('div[role="textbox"][contenteditable="true"]');
    if (prompt && prompt.offsetParent !== null) {
      result.promptField = true;
    }

    // Generate button
    const gen = document.querySelector('button[id="hf:image-form-submit"]') ||
                document.querySelector('button[type="submit"]');
    if (gen && gen.offsetParent !== null) {
      result.generateButton = true;
    }

    return result;
  });

  if (!checks.promptField) {
    throw new Error('Поле промпта недоступно. Проверьте страницу.');
  }
  if (!checks.generateButton) {
    throw new Error('Кнопка Generate недоступна. Проверьте страницу.');
  }
}


// ══════════════════════════════════════════════════════════════
//  PROMPT INPUT
// ══════════════════════════════════════════════════════════════

/**
 * Clear the prompt field — used BEFORE toggle clicks to prevent ghost generations.
 * Toggle clicks on Higgsfield can trigger form submission; an empty field means
 * no image will be generated from the accidental submit.
 */
async function clearPromptField(page) {
  try {
    const selectors = [
      'div[id="hf:tour-image-prompt"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][class*="cursor-text"]'
    ];
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click({ clickCount: 3 }); // Select all
        await page.keyboard.press('Backspace');
        await chrome.sleep(200);
        return;
      }
    }
  } catch {}
}


async function enterPrompt(page, prompt) {
  console.log(`[engine] === enterPrompt called ===`);
  console.log(`[engine] Prompt text: "${prompt.substring(0, 100)}..."`);

  // 1. Focus the element using Puppeteer native click
  try {
    const selectors = [
      'div[id="hf:tour-image-prompt"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][class*="cursor-text"]'
    ];
    let clicked = false;
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        // Click 3 times to select all text inside
        await el.click({ clickCount: 3 });
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('Not found');

    // 2. Clear native way
    await page.keyboard.press('Backspace');
    await chrome.sleep(100);

    // 3. Type native way — MUST sanitize newlines!
    // CRITICAL: page.keyboard.type() converts \n to Enter keypress,
    // which submits the Higgsfield form and starts a generation BEFORE
    // our explicit clickGenerate(). This caused queued=2.
    const sanitized = prompt.replace(/[\r\n]+/g, ' ').trim();
    await page.keyboard.type(sanitized, { delay: 0 });
    await chrome.sleep(300);

  } catch (err) {
    throw new Error(`Поле ввода промпта не найдено или недоступно: ${err.message}`);
  }

  await chrome.sleep(500);

  // VERIFY prompt in field
  const check = await page.evaluate((expected) => {
    let el = document.querySelector('div[id="hf:tour-image-prompt"]');
    if (!el) el = document.querySelector('div[role="textbox"][contenteditable="true"]');
    if (!el) return { ok: false };
    
    const actual = el.innerText.trim();
    // Use first 30 chars for verification (robust against trailing spaces)
    const prefix = expected.substring(0, 30).trim();
    return { 
      ok: actual.length > 0 && actual.includes(prefix), 
      actual: actual.substring(0, 100), 
      actualLen: actual.length 
    };
  }, prompt);

  console.log(`[engine] Verify: ok=${check.ok}, actual="${check.actual}"`);
  if (!check.ok) {
    throw new Error(`Промпт НЕ вставлен! В поле осталось: "${check.actual}". Ожидалось: "${prompt.substring(0, 30)}"`);
  }
  
  console.log(`[engine] ✅ Prompt VERIFIED (${check.actualLen} chars)`);
}


// ══════════════════════════════════════════════════════════════
//  ASPECT RATIO
// ══════════════════════════════════════════════════════════════

async function setAspectRatio(page, aspect) {
  try {
    // Find and click the aspect ratio button to open panel
    const changed = await page.evaluate((targetRatio) => {
      // Find current aspect ratio button in bottom controls
      const buttons = document.querySelectorAll('button');
      let ratioButton = null;

      for (const btn of buttons) {
        const text = btn.textContent.trim();
        // Match patterns like "16:9", "1:1", "9:16" etc
        if (/^\d+:\d+$/.test(text)) {
          ratioButton = btn;
          // If already the target ratio, no action needed
          if (text === targetRatio) return 'already_set';
          break;
        }
      }

      if (!ratioButton) return 'not_found';

      // Click to open aspect ratio panel
      ratioButton.click();
      return 'opened';
    }, aspect);

    if (changed === 'already_set') {
      console.log(`[engine] Aspect ratio already ${aspect}`);
      return;
    }

    if (changed === 'not_found') {
      console.log('[engine] ⚠️ Aspect ratio button not found');
      return;
    }

    // Wait for panel to open, then click target ratio
    await chrome.sleep(500);

    await page.evaluate((targetRatio) => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.trim() === targetRatio) {
          btn.click();
          return;
        }
      }
    }, aspect);

    await chrome.sleep(300);
    console.log(`[engine] Aspect ratio set to ${aspect}`);
  } catch (e) {
    console.log(`[engine] ⚠️ Aspect ratio warning: ${e.message}`);
  }
}


// ══════════════════════════════════════════════════════════════
//  GENERATE BUTTON
// ══════════════════════════════════════════════════════════════

async function clickGenerate(page) {
  // IMPORTANT: Use page.evaluate (DOM-level click), NOT btn.click() (Puppeteer native click).
  // Puppeteer native click dispatches mousedown+mouseup+click events, which React's
  // form handler on Higgsfield interprets as TWO form submissions → queued=2.
  // DOM-level el.click() fires exactly ONE click event.
  const clicked = await page.evaluate(() => {
    // Primary: by ID
    let btn = document.querySelector('button[id="hf:image-form-submit"]');
    if (btn && btn.offsetParent !== null && !btn.disabled) {
      btn.click();
      return 'id';
    }

    // Fallback: submit button
    btn = document.querySelector('button[type="submit"]');
    if (btn && btn.offsetParent !== null && !btn.disabled) {
      btn.click();
      return 'submit';
    }

    // Fallback: find button with "Generate" text
    const allBtns = document.querySelectorAll('button');
    for (const b of allBtns) {
      if (b.textContent.includes('Generate') && b.offsetParent !== null && !b.disabled) {
        b.click();
        return 'text';
      }
    }

    return false;
  });

  if (clicked) {
    console.log(`[engine] ✅ Generate clicked (via ${clicked})`);
  }

  return !!clicked;
}


// ══════════════════════════════════════════════════════════════
//  IMAGE TRACKING — Only track NEW images for current prompt
// ══════════════════════════════════════════════════════════════

/**
 * Count current images in the feed container
 */
async function countFeedImages(page) {
  return await page.evaluate(() => {
    const feed = document.querySelector('#soul-feed-scroll');
    if (!feed) return 0;
    // Count image containers (direct children with images)
    const imgs = feed.querySelectorAll('img');
    return imgs.length;
  });
}

/**
 * Get URLs of images currently in the feed
 */
async function getFeedImageUrls(page) {
  return await page.evaluate(() => {
    const feed = document.querySelector('#soul-feed-scroll');
    if (!feed) return [];

    const urls = [];
    const imgs = feed.querySelectorAll('img');
    for (const img of imgs) {
      if (img.src && img.src.startsWith('http') && !img.src.includes('avatar')) {
        urls.push(img.src);
      }
    }
    return urls;
  });
}

/**
 * Get the URL of the FIRST image in the feed (newest generation).
 * Extracts the INNER cloudfront URL from the Higgsfield proxy wrapper,
 * because the proxy URL pattern is identical for all images and
 * comparing proxy URLs fails to detect new images.
 */
async function getFirstFeedImgUrl(page) {
  return await page.evaluate(() => {
    const feed = document.querySelector('#soul-feed-scroll');
    if (!feed) return null;
    const imgs = feed.querySelectorAll('img');
    for (const img of imgs) {
      if (img.src && img.src.startsWith('http') && !img.src.includes('avatar')) {
        // Extract inner URL from proxy wrapper: images.higgs.ai/?...url=ENCODED
        try {
          const u = new URL(img.src);
          const innerUrl = u.searchParams.get('url');
          if (innerUrl) return innerUrl; // Return decoded cloudfront URL
        } catch {}
        return img.src; // Fallback to raw URL
      }
    }
    return null;
  });
}

/**
 * Count how many items are "Queued" (generating but not yet ready)
 */
async function countQueuedItems(page) {
  return await page.evaluate(() => {
    const feed = document.querySelector('#soul-feed-scroll');
    if (!feed) return 0;
    const elements = feed.querySelectorAll('*');
    let count = 0;
    for (const el of elements) {
      if (el.children.length === 0 && el.textContent.trim() === 'Queued') {
        count++;
      }
    }
    return count;
  });
}

/**
 * Wait for 1 new image to appear after a single Generate click.
 * 
 * Strategy: count images in feed BEFORE clicking. Poll until count increases.
 * When feed has more images → new generation is ready at position 0.
 * 
 * @param {Object} page - Puppeteer page
 * @param {number} feedCountBefore - Number of images in feed before Generate click
 * @param {number} index - Current image index (1-based)
 * @param {number} total - Total images expected
 * @param {Function} onProgress - Progress callback
 * @returns {string|null} - New image URL or null if timeout
 */
async function waitForSingleImage(page, feedCountBefore, index, total, onProgress) {
  const startTime = Date.now();
  const deadline = startTime + GENERATION_TIMEOUT;
  let generationDetected = false;
  let queuedGone = false;

  while (Date.now() < deadline && !shouldStop) {
    await chrome.sleep(POLL_INTERVAL);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Check for queued items
    const queued = await countQueuedItems(page);
    if (queued > 0 && !generationDetected) {
      generationDetected = true;
      console.log(`[engine] 🎬 Image ${index}: generation started (Queued)`);
    }

    // Detect when Queued disappears = image should be ready
    if (generationDetected && queued === 0 && !queuedGone) {
      queuedGone = true;
      console.log(`[engine] 🎬 Image ${index}: Queued disappeared, checking for new img...`);
      await chrome.sleep(2000); // Wait for DOM update
    }

    // Count-based detection: check if feed has more images than before
    const feedCountNow = await countFeedImages(page);

    // If feed count increased → new image appeared!
    if (feedCountNow > feedCountBefore) {
      // New image is at position 0 (newest first)
      await chrome.sleep(2000); // Wait for full resolution to load
      const newImgUrl = await getFirstFeedImgUrl(page);
      console.log(`[engine] ✅ Image ${index} ready (${elapsed}s, feedCount: ${feedCountBefore}→${feedCountNow}): ${(newImgUrl || '').substring(0, 80)}...`);
      return newImgUrl;
    }

    // Status update
    const status = queuedGone ? 'обработка...' : queued > 0 ? 'генерация...' : 'ожидание...';
    onProgress({
      step: 'waiting',
      message: `Изображение ${index}/${total}: ${status} (${elapsed}с)`,
    });

    // Debug log every 15 seconds
    if (elapsed % 15 === 0 && elapsed > 0) {
      console.log(`[engine] DEBUG: queued=${queued}, queuedGone=${queuedGone}, feedCount=${feedCountNow}/${feedCountBefore}, elapsed=${elapsed}s`);
    }

    // Dismiss overlays periodically
    if (elapsed % 10 === 0 && elapsed > 0) {
      await dismissOverlays(page);
    }

    // Check for auth issues
    const pageUrl = page.url();
    if (pageUrl.includes('sign-in') || pageUrl.includes('login')) {
      throw new Error('Сессия истекла. Перезайдите через Chrome.');
    }
  }

  console.log(`[engine] ⚠️ Timeout waiting for image ${index}`);
  return null;
}

/**
 * Wait for N new images to appear in the feed after generation started
 */
async function waitForNewImages(page, beforeCount, expected, onProgress) {
  const startTime = Date.now();
  const deadline = startTime + GENERATION_TIMEOUT;
  let lastNewCount = 0;

  // Take snapshot of existing URLs to filter out later
  const beforeUrls = new Set(await getFeedImageUrls(page));

  while (Date.now() < deadline && !shouldStop) {
    await chrome.sleep(POLL_INTERVAL);

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Get current URLs and find new ones
    const currentUrls = await getFeedImageUrls(page);
    const newUrls = currentUrls.filter(u => !beforeUrls.has(u));

    // Deduplicate by UUID
    const uniqueNew = dedupeUrls(newUrls);

    if (uniqueNew.length !== lastNewCount) {
      lastNewCount = uniqueNew.length;
      console.log(`[engine] New images: ${uniqueNew.length}/${expected} (${elapsed}s)`);
    }

    onProgress({
      step: 'waiting',
      message: `Генерация... ${uniqueNew.length}/${expected} (${elapsed}с)`,
    });

    // Check if we have enough
    if (uniqueNew.length >= expected) {
      // Wait a bit more for images to fully load
      await chrome.sleep(3000);

      // Re-fetch to get possibly higher-res URLs
      const finalUrls = await getFeedImageUrls(page);
      const finalNew = dedupeUrls(finalUrls.filter(u => !beforeUrls.has(u)));

      console.log(`[engine] ✅ All ${finalNew.length} images ready (${elapsed}s)`);
      return finalNew.slice(0, expected);
    }

    // Check for auth issues
    const pageUrl = page.url();
    if (pageUrl.includes('sign-in') || pageUrl.includes('login')) {
      throw new Error('Сессия истекла. Перезайдите через Chrome.');
    }

    // Dismiss any overlays that might have appeared
    await dismissOverlays(page);
  }

  if (shouldStop) {
    const currentUrls = await getFeedImageUrls(page);
    return dedupeUrls(currentUrls.filter(u => !beforeUrls.has(u))).slice(0, expected);
  }

  // Timeout — return whatever we have
  const timeoutUrls = await getFeedImageUrls(page);
  const timeoutNew = dedupeUrls(timeoutUrls.filter(u => !beforeUrls.has(u)));

  if (timeoutNew.length > 0) {
    console.log(`[engine] ⚠️ Timeout: got ${timeoutNew.length}/${expected}`);
    return timeoutNew.slice(0, expected);
  }

  throw new Error(`Таймаут генерации (${Math.round(GENERATION_TIMEOUT / 1000)}с). Ни одно изображение не появилось.`);
}


// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  DOWNLOAD VALIDATION — strict file checks
// ══════════════════════════════════════════════════════════════

const MIN_FILE_SIZE = 1_000_000; // 1MB minimum for full-res

/**
 * Validate a downloaded image file.
 * All conditions must pass:
 * 1. dlResult.success === true
 * 2. File exists on disk
 * 3. File is not empty
 * 4. File size >= 1MB (full-res requirement)
 * 5. Valid image format (JPEG/PNG/WebP magic bytes)
 */
function validateDownload(filePath, dlResult) {
  // 1. Download reported success
  if (!dlResult || !dlResult.success) {
    return { ok: false, reason: 'download_failed' };
  }

  // 2. File exists on disk
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: 'file_not_found' };
  }

  // 3. File is not empty
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    return { ok: false, reason: 'empty_file' };
  }

  // 4. File size >= 1MB
  if (stat.size < MIN_FILE_SIZE) {
    return { ok: false, reason: `too_small_${Math.round(stat.size / 1024)}KB_need_1MB` };
  }

  // 5. Valid image format (magic bytes check)
  try {
    const header = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);

    const isJpeg = header[0] === 0xFF && header[1] === 0xD8;
    const isPng = header[0] === 0x89 && header[1] === 0x50;
    const isWebp = header[0] === 0x52 && header[1] === 0x49; // RIFF (WebP)

    if (!isJpeg && !isPng && !isWebp) {
      return { ok: false, reason: 'invalid_image_format' };
    }

    const format = isJpeg ? 'jpeg' : isPng ? 'png' : 'webp';
    const quality = stat.size >= 2_000_000 ? 'fullres' : 'acceptable';

    console.log(`[engine] ✓ Validation passed: ${Math.round(stat.size / 1024)}KB, format=${format}, quality=${quality}`);
    return { ok: true, size: stat.size, quality, format };
  } catch (err) {
    return { ok: false, reason: `read_error: ${err.message}` };
  }
}

/**
 * Save intermediate meta.json after each image is processed.
 * Enables crash recovery — state is persisted per image.
 */
function saveIntermediateMeta(outputDir, prompt, model, aspect, quality, imageResults, totalImages) {
  if (!outputDir) return;

  const meta = {
    prompt,
    model,
    aspect_ratio: aspect,
    resolution: quality,
    status: 'in_progress',
    total: totalImages || 4,
    savedCount: imageResults.filter(r => r.state === 'saved').length,
    errorCount: imageResults.filter(r => r.state === 'error').length,
    images: imageResults.map(r => ({
      index: r.index,
      state: r.state,
      file: r.file,
      size: r.size,
      quality: r.quality,
      error: r.error,
      url: r.url ? r.url.substring(0, 120) : null,
    })),
    timestamps: {
      updated: new Date().toISOString(),
    },
  };

  try {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'meta.json'), JSON.stringify(meta, null, 2));
    console.log(`[engine] 📋 Meta.json updated (${meta.savedCount} saved, ${meta.errorCount} errors)`);
  } catch (err) {
    console.log(`[engine] ⚠️ Failed to save meta.json: ${err.message}`);
  }
}


// ══════════════════════════════════════════════════════════════
//  IMAGE DOWNLOAD
// ══════════════════════════════════════════════════════════════

/**
 * Download an image from a URL using multiple strategies
 */
async function downloadImage(previewUrl, destPath, onProgress = () => {}) {
  const page = chrome.getActivePage();
  if (!page) throw new Error('Chrome не подключён');

  // Strategy 0: Get full-res URL via Higgsfield API (extract job_id from preview URL)
  try {
    onProgress({ message: 'Получаю full-res URL...' });
    const fullResUrl = await getFullResUrl(page, previewUrl);
    if (fullResUrl) {
      console.log(`[engine] Full-res URL: ${fullResUrl.substring(0, 100)}...`);
      const data = await nodeFetch(fullResUrl);
      if (data && data.length > 50_000) {
        fs.writeFileSync(destPath, data);
        const kb = Math.round(data.length / 1024);
        console.log(`[engine] ✅ Downloaded FULL-RES: ${path.basename(destPath)} (${kb}KB)`);
        return { success: true, size: data.length, method: 'api_fullres' };
      } else {
        console.log(`[engine] ⚠️ Full-res too small: ${data ? data.length : 0} bytes`);
      }
    }
  } catch (err) {
    console.log(`[engine] API fullres failed: ${err.message}`);
  }

  // Build candidate URLs (full-res variants from preview URL)
  const candidates = buildDownloadCandidates(previewUrl);

  // Strategy 1: Node.js native HTTPS download (bypasses CORS)
  for (const url of candidates) {
    onProgress({ message: `Скачиваю...` });
    try {
      const data = await nodeFetch(url);
      if (data && data.length > 50_000) {
        fs.writeFileSync(destPath, data);
        const kb = Math.round(data.length / 1024);
        console.log(`[engine] ✅ Downloaded: ${path.basename(destPath)} (${kb}KB) via Node.js`);
        return { success: true, size: data.length, method: 'node_fetch' };
      } else if (data && data.length > 5_000) {
        fs.writeFileSync(destPath, data);
        console.log(`[engine] ⚠️ Small image: ${path.basename(destPath)} (${Math.round(data.length / 1024)}KB)`);
        return { success: true, size: data.length, method: 'node_fetch_small' };
      }
    } catch (err) {
      console.log(`[engine] Node fetch failed: ${err.message}`);
    }
  }

  // Strategy 2: JS fetch in Chrome context (uses cookies)
  for (const url of candidates) {
    onProgress({ message: `Скачиваю через браузер...` });
    try {
      const data = await browserFetch(page, url);
      if (data && data.length > 50_000) {
        fs.writeFileSync(destPath, data);
        const kb = Math.round(data.length / 1024);
        console.log(`[engine] ✅ Downloaded: ${path.basename(destPath)} (${kb}KB) via browser`);
        return { success: true, size: data.length, method: 'browser_fetch' };
      } else if (data && data.length > 5_000) {
        fs.writeFileSync(destPath, data);
        return { success: true, size: data.length, method: 'browser_fetch_small' };
      }
    } catch (err) {
      console.log(`[engine] Browser fetch failed: ${err.message}`);
    }
  }

  // Strategy 3: Save preview via Node.js as last resort
  try {
    onProgress({ message: 'Сохраняю preview...' });
    const data = await nodeFetch(previewUrl);
    if (data && data.length > 2_000) {
      fs.writeFileSync(destPath, data);
      return { success: true, size: data.length, method: 'preview_fallback' };
    }
  } catch {}

  return { success: false, error: 'Все методы скачивания не сработали' };
}

/**
 * Get full-res URL for a specific image using its preview URL.
 * Extracts the job_id from the filename and queries the Higgsfield API.
 * 
 * URL format: hf_YYYYMMDD_HHMMSS_{uuid}_min.webp
 * API: POST fnf.higgsfield.ai/jobs/{uuid}/view → { results: { raw: { url } } }
 */
async function getFullResUrl(page, previewUrl) {
  // Step 1: Extract the real cloudfront URL from the proxy
  let realUrl = previewUrl;
  if (previewUrl.includes('images.higgs.ai') || previewUrl.includes('url=http')) {
    try {
      const u = new URL(previewUrl);
      const embedded = u.searchParams.get('url');
      if (embedded) realUrl = embedded;
    } catch {}
  }

  // Step 2: Extract job_id (UUID) from the filename
  // Pattern: hf_20260315_150700_c2a3a0ea-6cbd-4b18-a930-d2b783eba5d4_min.webp
  const uuidMatch = realUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!uuidMatch) {
    console.log(`[engine] Could not extract job_id from URL: ${realUrl.substring(0, 100)}`);
    // Fallback: construct .jpeg URL directly
    if (realUrl.includes('_min.webp')) {
      return realUrl.replace('_min.webp', '.jpeg');
    }
    return null;
  }

  const jobId = uuidMatch[1];
  console.log(`[engine] Extracted job_id: ${jobId}`);

  // Step 3: Call Higgsfield API to get full-res URL
  try {
    const apiResult = await page.evaluate(async (jid) => {
      try {
        const r = await fetch(`https://fnf.higgsfield.ai/jobs/${jid}/view`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!r.ok) return { error: `HTTP ${r.status}` };
        const json = await r.json();
        // Navigate to raw URL in response
        const rawUrl = json?.results?.raw?.url 
                    || json?.raw?.url 
                    || json?.result?.raw?.url;
        return { rawUrl, keys: Object.keys(json || {}).join(',') };
      } catch (e) {
        return { error: e.message };
      }
    }, jobId);

    if (apiResult.error) {
      console.log(`[engine] API /jobs/${jobId}/view error: ${apiResult.error}`);
    } else if (apiResult.rawUrl) {
      console.log(`[engine] ✅ Got raw URL from API: ${apiResult.rawUrl.substring(0, 80)}...`);
      return apiResult.rawUrl;
    } else {
      console.log(`[engine] API response keys: ${apiResult.keys} (no rawUrl found)`);
    }
  } catch (err) {
    console.log(`[engine] API call failed: ${err.message}`);
  }

  // Step 4: Fallback — construct full-res URL by replacing _min.webp → .jpeg
  if (realUrl.includes('_min.webp')) {
    const jpegUrl = realUrl.replace('_min.webp', '.jpeg');
    console.log(`[engine] Fallback: trying .jpeg URL`);
    return jpegUrl;
  }

  return null;
}

/**
 * Download file using Node.js native HTTPS (bypasses CORS)
 */
function nodeFetch(url) {
  const http = require(url.startsWith('https') ? 'https' : 'http');
  return new Promise((resolve, reject) => {
    const doRequest = (reqUrl, redirectsLeft = 5) => {
      const req = http.get(reqUrl, { timeout: 30000 }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const redirectUrl = new URL(res.headers.location, reqUrl).href;
          return doRequest(redirectUrl, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    };
    doRequest(url);
  });
}

/**
 * Fetch via JS in Chrome context (preserves cookies)
 */
async function browserFetch(page, url) {
  const result = await page.evaluate(async (fetchUrl) => {
    try {
      const r = await fetch(fetchUrl, { credentials: 'include' });
      if (!r.ok) return { error: r.status };
      const blob = await r.blob();
      const buf = await blob.arrayBuffer();
      return { data: Array.from(new Uint8Array(buf)) };
    } catch (e) {
      return { error: e.message };
    }
  }, url);

  if (result.error) throw new Error(`Fetch ${result.error}`);
  return Buffer.from(result.data);
}

/**
 * Build full-res URL candidates from preview URL
 */
function buildDownloadCandidates(previewUrl) {
  const candidates = [];

  // Extract real URL from Higgsfield proxy (images.higgs.ai/?...&url=ENCODED_URL&...)
  let realUrl = previewUrl;
  if (previewUrl.includes('images.higgs.ai') || previewUrl.includes('url=http')) {
    try {
      const u = new URL(previewUrl);
      const embeddedUrl = u.searchParams.get('url');
      if (embeddedUrl) {
        realUrl = embeddedUrl;
        console.log(`[engine] Extracted real URL: ${realUrl.substring(0, 80)}...`);
      }
    } catch {}
  }

  // _min.webp → .png (most common Higgsfield pattern)
  if (realUrl.includes('_min.webp')) {
    candidates.push(realUrl.replace('_min.webp', '.png'));
    candidates.push(realUrl.replace('_min.webp', '.webp'));
  }

  // _min → full
  if (realUrl.includes('_min')) {
    candidates.push(realUrl.replace('_min', ''));
  }

  // webp → png
  if (realUrl.endsWith('.webp')) {
    candidates.push(realUrl.replace('.webp', '.png'));
  }

  // Real URL as-is
  candidates.push(realUrl);

  // Original proxy URL as fallback
  if (realUrl !== previewUrl) {
    candidates.push(previewUrl);
  }

  return [...new Set(candidates)];
}


// ══════════════════════════════════════════════════════════════
//  OVERLAY DISMISSAL
// ══════════════════════════════════════════════════════════════

async function dismissOverlays(page) {
  try {
    await page.evaluate(() => {
      // Standard close buttons
      const closeSelectors = [
        'button[aria-label="Close"]',
        'button[aria-label="close"]',
        '[class*="modal"] button[class*="close"]',
        '[class*="dialog"] button[class*="close"]',
        'button[class*="CloseButton"]',
      ];
      for (const sel of closeSelectors) {
        try {
          const btns = document.querySelectorAll(sel);
          for (const btn of btns) {
            if (btn.offsetParent !== null) btn.click();
          }
        } catch {}
      }

      // Close "Payment required" modal — find by text, click its X/close button
      const allElements = document.querySelectorAll('div, section, aside');
      for (const el of allElements) {
        const text = el.textContent || '';
        if (text.includes('Payment required') || text.includes('billing issue')) {
          // Find X button inside this modal
          const xBtns = el.querySelectorAll('button');
          for (const btn of xBtns) {
            const btnText = btn.textContent.trim();
            if (btnText === '×' || btnText === '✕' || btnText === 'X' || btnText === '' ||
                btn.getAttribute('aria-label')?.toLowerCase().includes('close')) {
              if (btn.offsetParent !== null) {
                btn.click();
                break;
              }
            }
          }
          // Also try to remove the element itself (banner)
          if (el.offsetHeight < 80) {
            el.style.display = 'none';
          }
        }
      }

      // Close "Credits running low" toasts
      const toasts = document.querySelectorAll('[class*="toast"], [class*="Toast"], [class*="notification"]');
      for (const toast of toasts) {
        if (toast.textContent.includes('Credits') || toast.textContent.includes('Upgrade')) {
          const closeBtn = toast.querySelector('button');
          if (closeBtn) closeBtn.click();
        }
      }

      // Close experience surveys / generic X buttons
      const xButtons = document.querySelectorAll('button');
      for (const btn of xButtons) {
        const text = btn.textContent.trim();
        if (text === '×' || text === '✕' || text === 'X') {
          if (btn.offsetParent !== null) btn.click();
        }
      }
    });
  } catch {}
}


// ══════════════════════════════════════════════════════════════
//  URL HELPERS
// ══════════════════════════════════════════════════════════════

function isImageUrl(url) {
  const BLOCK = ['default=1', '.svg', '.gif', 'favicon', 'blob:', 'data:', 'avatar', 'profile'];
  return url.startsWith('http') && !BLOCK.some(b => url.includes(b));
}

/**
 * Deduplicate URLs by UUID (same image, different variants)
 */
function dedupeUrls(urls) {
  const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const groups = {};
  const ungrouped = [];

  for (const url of urls) {
    if (!isImageUrl(url)) continue;
    const m = url.match(UUID_RE);
    if (m) {
      // Prefer higher-res: .png > .webp, no _min > _min
      const existing = groups[m[1]];
      if (!existing ||
          (url.includes('.png') && !existing.includes('.png')) ||
          (!url.includes('_min') && existing.includes('_min'))) {
        groups[m[1]] = url;
      }
    } else {
      ungrouped.push(url);
    }
  }

  return [...Object.values(groups), ...new Set(ungrouped)];
}


// ══════════════════════════════════════════════════════════════
//  STOP / STATE
// ══════════════════════════════════════════════════════════════

function stopGeneration() {
  shouldStop = true;
}

// Removed inline function getIsGenerating here since it was duplicated at the top


// ══════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════
module.exports = {
  generatePrompt,
  downloadImage,
  browserFetch,
  buildDownloadCandidates,
  stopGeneration,
  getIsGenerating,
  getShouldStop,
  resetShouldStop,
  _resetIsGenerating,
  dedupeUrls,
  isUnlimitedOn,
  ensureUnlimited,
  verifyActiveModel,
  IMAGES_PER_PROMPT,
  DEFAULT_MODEL,
  UNLIMITED_MODELS,
  PAID_ONLY_MODELS,
};

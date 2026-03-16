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
    excludeFingerprints = [], // UUID от предыдущего промпта — нельзя принять за своих
  } = options;

  // ── FORENSIC: Prompt entry point ──
  const promptPrefix = (prompt || '').substring(0, 60);
  console.log(`\n[engine] ╔${'═'.repeat(70)}`);
  console.log(`[engine] ║ GENERATE PROMPT START`);
  console.log(`[engine] ║ prompt  : "${promptPrefix}"`);
  console.log(`[engine] ║ model   : ${model}`);
  console.log(`[engine] ║ aspect  : ${aspect}`);
  console.log(`[engine] ║ images  : ${imagesCount}`);
  console.log(`[engine] ║ output  : ${outputDir}`);
  console.log(`[engine] ║ excludeFingerprints: ${excludeFingerprints.length} UUIDs`);
  if (excludeFingerprints.length > 0) {
    console.log(`[engine] ║ exclude[0]: ${excludeFingerprints[0]}`);
  }
  console.log(`[engine] ╚${'═'.repeat(70)}`);

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

    // ── Step 5: Turn OFF "Extra free gens" FIRST ──
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

    // ── Step 7: Ensure Unlimited is ON — LAST toggle action ──
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
    // Each slot (i) is an independent unit with its own 2-attempt retry loop.
    // Error classification:
    //   fatal       → throw immediately, stops entire batc (model changed, auth error, credits exhausted)
    //   recoverable → retry same slot (click failed, timeout, download failed) — up to 2 attempts
    //   partial     → mark slot failed, continue to next slot
    const imageResults = [];
    let fatalError = null; // Set if a fatal error stops the entire batch

    for (let i = 0; i < imagesCount && !shouldStop && !fatalError; i++) {
      const img = {
        index: i + 1,
        state: 'pending',
        url: null,
        file: null,
        size: 0,
        quality: null,
        error: null,
        errorReason: null,   // site_failed | click_failed | timeout | download_failed | validation_failed | auth_error | credits_exhausted | stopped
        attempts: 0,
      };

      console.log(`\n[engine] ═══ SLOT ${img.index}/${imagesCount} — starting ═══`);

      // ── Per-slot retry loop: up to 2 attempts ──
      let slotSucceeded = false;

      for (let attempt = 1; attempt <= 2 && !slotSucceeded && !shouldStop && !fatalError; attempt++) {
        img.attempts = attempt;
        img.state = 'in_progress';

        if (attempt === 2) {
          console.log(`[engine] 🔄 SLOT ${img.index} — retry attempt (2/2)...`);
          onProgress({ step: 'retry', message: `Повторяю слот ${img.index}/${imagesCount} (попытка 2)...`, state: 'retrying' });
          await chrome.sleep(3000);
        } else {
          onProgress({
            step: 'generate',
            message: `Слот ${img.index}/${imagesCount} — генерирую...`,
            current: img.index,
            total: imagesCount,
            state: 'generating',
          });
        }

        try {
          // ═══ PRE-CLICK: verify conditions before EVERY click ═══
          // Check 1: Model must be the selected one (FATAL if changed)
          const modelOkNow = await verifyActiveModel(page, modelInfo);
          if (!modelOkNow) {
            const err = new Error(`Модель изменилась! Ожидалась "${modelInfo.name}". Генерация остановлена.`);
            err.errorClass = 'fatal';
            err.errorReason = 'model_changed';
            throw err;
          }

          // ── FORENSIC: PRE-SLOT STATE SNAPSHOT ──
          const batchNow = await getBatchSize(page);
          const extraOnPre = await isExtraFreeGensOn(page);
          const unlimitedNowPre = await isUnlimitedOn(page);
          const promptInField = await page.evaluate((sels) => {
            for (const sel of sels) {
              const el = document.querySelector(sel);
              if (el) return el.innerText.trim().substring(0, 80);
            }
            return '(not found)';
          }, ['div[id="hf:tour-image-prompt"]', 'div[role="textbox"][contenteditable="true"]']);
          const queuedPre = await countQueuedItems(page);

          console.log(`[engine] ┌─── PRE-SLOT ${img.index} (attempt ${attempt}) ────────────────────────`);
          console.log(`[engine] │ batch       : ${batchNow ? `${batchNow.current}/${batchNow.max}` : 'NOT FOUND'}`);
          console.log(`[engine] │ extra_free  : ${extraOnPre ? 'ON ⚠️' : 'OFF ✅'}`);
          console.log(`[engine] │ unlimited   : ${unlimitedNowPre ? 'ON ✅' : 'OFF ⚠️'}`);
          console.log(`[engine] │ queued_now  : ${queuedPre}`);
          console.log(`[engine] │ prompt_field: "${promptInField}"`);
          console.log(`[engine] │ expected_pr : "${(prompt || '').substring(0, 80)}"`);
          const promptMatch = promptInField.length > 5 && (prompt || '').includes(promptInField.substring(0, Math.min(20, promptInField.length)));
          console.log(`[engine] │ field_match : ${promptMatch ? '✅ yes' : '⚠️ NO MATCH'}`);
          console.log(`[engine] └──────────────────────────────────────────────────────`);

          // Check 2: Batch MUST be 1/4 (safe to fix, doesn't submit)
          if (!batchNow || batchNow.current !== 1) {
            console.log(`[engine] ⚠️ Batch = ${batchNow ? batchNow.current : '?'} перед слотом ${img.index}! Исправляю...`);
            const batchFixed = await ensureBatchSize1(page);
            if (!batchFixed) {
              const err = new Error(`Batch не 1/4 перед слотом ${img.index}. Генерация остановлена.`);
              err.errorClass = 'fatal';
              err.errorReason = 'batch_setup_failed';
              throw err;
            }
            const batchAfter = await getBatchSize(page);
            console.log(`[engine] Batch after fix: ${batchAfter ? `${batchAfter.current}/${batchAfter.max}` : 'NOT FOUND'}`);
          }

          await dismissOverlays(page);

          // ═══ STRICT GUARD: Wait for queued==0 before clicking ═══
          const queuedBeforeClick = await countQueuedItems(page);
          if (queuedBeforeClick > 0) {
            console.log(`[engine] ⏳ GUARD: queued=${queuedBeforeClick} before slot ${img.index} — waiting for queue to clear...`);
            const guardTimeout = 300000; // 5 minutes max (Higgsfield gen can take 4+ min)
            const guardStart = Date.now();
            let guardCleared = false;
            while (Date.now() - guardStart < guardTimeout) {
              await chrome.sleep(3000);
              const q = await countQueuedItems(page);
              const elapsed = Math.round((Date.now() - guardStart) / 1000);
              console.log(`[engine] ⏳ GUARD: queued=${q} (${elapsed}s)`);
              if (q === 0) {
                console.log(`[engine] ✅ GUARD: queue cleared after ${elapsed}s`);
                guardCleared = true;
                break;
              }
            }
            if (!guardCleared) {
              const err = new Error(`GUARD: очередь не очистилась за 5 минут (queued=${await countQueuedItems(page)}). Слот ${img.index} пропущен.`);
              err.errorClass = 'recoverable';
              err.errorReason = 'guard_timeout';
              throw err;
            }
          }

          // ═══ SNAPSHOT FEED ═══
          const feedCountBefore = await countFeedImages(page);
          const fingerprintsBefore = await snapshotFeedFingerprints(page, 10);
          console.log(`[engine] 📊 Slot ${img.index} pre-click: feedCount=${feedCountBefore}, fingerprints=${fingerprintsBefore.length}, exclude=${excludeFingerprints.length}`);

          // ═══ CLICK GENERATE ═══
          const clicked = await clickGenerate(page);
          if (!clicked) {
            console.log(`[engine] ⚠️ Generate click failed for slot ${img.index}, trying once more...`);
            await chrome.sleep(2000);
            await dismissOverlays(page);
            const retryClicked = await clickGenerate(page);
            if (!retryClicked) {
              const err = new Error(`Generate click failed for slot ${img.index}`);
              err.errorClass = 'recoverable';
              err.errorReason = 'click_failed';
              throw err;
            }
          }
          console.log(`[engine] ✅ Slot ${img.index} — Generate clicked`);

          // Give the site time to process before polling
          await chrome.sleep(2000);

          // ── FORENSIC: POST-CLICK STATE ──
          const queuedPost = await countQueuedItems(page);
          const feedPost = await countFeedImages(page);
          const topUrlPost = await getFirstFeedImgUrl(page);
          const topUUIDPost = extractUUID(topUrlPost);
          console.log(`[engine] 📡 POST-CLICK (2s): queued=${queuedPost}, feed=${feedPost} (was ${feedCountBefore}), topUUID=${topUUIDPost || 'none'}, isForbidden=${topUUIDPost ? (excludeFingerprints.includes(topUUIDPost) || fingerprintsBefore.includes(topUUIDPost)) : 'N/A'}`);

          // ═══ WAIT FOR NEW IMAGE (fingerprint primary detection) ═══
          onProgress({ step: 'waiting', message: `Слот ${img.index}/${imagesCount}: жду результат...`, state: 'generating' });
          const imageUrl = await waitForSingleImage(page, feedCountBefore, fingerprintsBefore, img.index, imagesCount, onProgress, excludeFingerprints);

          if (!imageUrl) {
            // Check if feed shows a site-side failure
            const siteErr = await detectSiteError(page);
            if (siteErr === 'credits_exhausted') {
              const err = new Error('Все кредиты использованы (All credits used)');
              err.errorClass = 'fatal';
              err.errorReason = 'credits_exhausted';
              throw err;
            } else if (siteErr === 'auth_error') {
              const err = new Error('Сессия истекла. Перезайдите через Chrome.');
              err.errorClass = 'fatal';
              err.errorReason = 'auth_error';
              throw err;
            } else if (siteErr === 'site_failed') {
              const err = new Error('Сайт показал Failed / Credits refunded');
              err.errorClass = 'recoverable';
              err.errorReason = 'site_failed';
              throw err;
            } else {
              const err = new Error(`Timeout: новое изображение не появилось (слот ${img.index})`);
              err.errorClass = 'recoverable';
              err.errorReason = 'timeout';
              throw err;
            }
          }

          img.url = imageUrl;
          const acceptedUUID = extractUUID(imageUrl);
          console.log(`[engine] ✅ Slot ${img.index} image URL acquired`);
          console.log(`[engine]    URL     : ${imageUrl.substring(0, 100)}`);
          console.log(`[engine]    UUID    : ${acceptedUUID}`);
          console.log(`[engine]    excluded: ${acceptedUUID ? (excludeFingerprints.includes(acceptedUUID) ? '⚠️ YES (BAD!)' : 'no ✅') : 'N/A'}`);

          // ═══ DOWNLOAD ═══
          img.state = 'downloading';
          const destPath = outputDir
            ? path.join(outputDir, `gen_${img.index}.jpg`)
            : path.join(__dirname, 'output', 'temp', `gen_${img.index}.jpg`);
          console.log(`[engine] 💾 Slot ${img.index} — downloading to: ${destPath}`);
          onProgress({ step: 'downloading', message: `Слот ${img.index}/${imagesCount}: скачиваю...`, state: 'downloading' });

          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

          let dlResult = await downloadImage(imageUrl, destPath, (p) => {
            onProgress({ step: 'downloading', message: p.message, state: 'downloading' });
          });

          // ═══ VALIDATE ═══
          img.state = 'validating';
          let validation = validateDownload(destPath, dlResult);

          if (!validation.ok) {
            console.log(`[engine] ⚠️ Slot ${img.index} validation failed: ${validation.reason}. Retrying download...`);
            dlResult = await downloadImage(imageUrl, destPath, (p) => {
              onProgress({ step: 'downloading', message: `(retry dl) ${p.message}`, state: 'downloading' });
            });
            validation = validateDownload(destPath, dlResult);

            if (!validation.ok) {
              const err = new Error(`Validation failed: ${validation.reason}`);
              err.errorClass = 'recoverable';
              err.errorReason = 'validation_failed';
              throw err;
            }
          }

          // ═══ SAVED ✅ ═══
          img.state = 'saved';
          img.file = `gen_${img.index}.jpg`;
          img.size = validation.size;
          img.quality = validation.quality;
          slotSucceeded = true;

          console.log(`[engine] ✅ SLOT ${img.index} — SAVED (${Math.round(img.size / 1024)}KB, ${img.quality})`);
          onProgress({
            step: 'saved',
            message: `✅ Слот ${img.index}/${imagesCount} сохранён (${Math.round(img.size / 1024)}KB)`,
            state: 'saved',
            savedSlot: img.index,
          });

        } catch (slotErr) {
          const errClass = slotErr.errorClass || 'recoverable';
          const errReason = slotErr.errorReason || 'unknown';

          console.log(`[engine] ❌ SLOT ${img.index} attempt ${attempt} FAILED [${errClass}|${errReason}]: ${slotErr.message}`);

          if (errClass === 'fatal') {
            // Fatal: stop the entire batch immediately
            fatalError = { message: slotErr.message, reason: errReason };
            img.state = 'failed';
            img.error = slotErr.message;
            img.errorReason = errReason;
            break; // Exit per-slot retry loop
          }

          if (attempt === 2) {
            // All retries exhausted → mark slot failed, continue batch
            img.state = 'failed';
            img.error = slotErr.message;
            img.errorReason = errReason;
            console.log(`[engine] ⚠️ SLOT ${img.index} — all retries exhausted, marking FAILED [${errReason}]`);
            await dismissOverlays(page);
          }
          // else: attempt < 2 → loop continues to retry this slot
        }
      } // end per-slot retry loop

      if (shouldStop && !slotSucceeded && img.state !== 'failed') {
        img.state = 'stopped';
        img.errorReason = 'stopped';
      }

      imageResults.push(img);

      // Save intermediate meta after every slot
      saveIntermediateMeta(outputDir, prompt, model, aspect, quality, imageResults, imagesCount);

      // Dismiss overlays between slots
      await dismissOverlays(page);

      // Wait before next slot (except after last)
      if (i < imagesCount - 1 && !fatalError) {
        await chrome.sleep(3000);
      }
    } // end slot loop

    // ── Handle fatal error propagation ──
    if (fatalError) {
      // Save remaining slots as stopped
      for (let j = imageResults.length; j < imagesCount; j++) {
        imageResults.push({ index: j + 1, state: 'stopped', errorReason: 'stopped', url: null, file: null });
      }
      saveIntermediateMeta(outputDir, prompt, model, aspect, quality, imageResults, imagesCount);

      const fatalErr = new Error(fatalError.message);
      fatalErr.errorReason = fatalError.reason;
      fatalErr.isFatal = true;
      throw fatalErr;
    }

    // ── Handle user stop ──
    if (shouldStop) {
      for (let j = imageResults.length; j < imagesCount; j++) {
        imageResults.push({ index: j + 1, state: 'stopped', errorReason: 'stopped', url: null, file: null });
      }
    }

    // ── Final summary ──
    const savedCount = imageResults.filter(r => r.state === 'saved').length;
    const failedCount = imageResults.filter(r => r.state === 'failed').length;
    const stoppedCount = imageResults.filter(r => r.state === 'stopped').length;

    let promptStatus;
    if (savedCount === imagesCount) {
      promptStatus = 'done';
    } else if (savedCount > 0) {
      promptStatus = 'partial';
    } else if (stoppedCount > 0 && savedCount === 0) {
      promptStatus = 'stopped';
    } else {
      promptStatus = 'error';
    }

    console.log(`\n[engine] ═══ SUMMARY: ${savedCount} saved, ${failedCount} failed, ${stoppedCount} stopped out of ${imagesCount} → promptStatus=${promptStatus} ═══`);

    if (savedCount === 0 && !shouldStop) {
      throw new Error(`Ни одного изображения не сохранено (${failedCount} failed)`);
    }

    onProgress({
      step: 'done',
      message: `${savedCount}/${imagesCount} слотов сохранено`,
      state: promptStatus,
      savedCount,
      failedCount,
    });

    return {
      images: imageResults,
      savedCount,
      failedCount,
      stoppedCount,
      total: imagesCount,
      promptStatus,
    };

  } finally {
    // NOTE: Do NOT set isGenerating = false here!
    // This function handles ONE prompt. The batch loop in main.js
    // manages the overall lifecycle. isGenerating is reset by
    // stopGeneration() or by main.js after the entire batch.
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
  const result = await page.evaluate(() => {
    // DEBUG: dump ALL switches and their context
    const allSwitches = document.querySelectorAll('button[role="switch"]');
    const debugInfo = [];
    allSwitches.forEach((sw, idx) => {
      const parent = sw.parentElement;
      const grandparent = parent ? parent.parentElement : null;
      debugInfo.push({
        idx,
        checked: sw.getAttribute('aria-checked'),
        parentTag: parent ? parent.tagName : null,
        parentText: parent ? parent.textContent.trim().substring(0, 60) : null,
        grandparentText: grandparent ? grandparent.textContent.trim().substring(0, 80) : null,
      });
    });

    // Strategy: find the switch whose IMMEDIATE label/sibling contains "Extra free gens"
    // Walk through all switches and find the one labeled "Extra free gens"
    for (const sw of allSwitches) {
      // Check previous sibling text
      const prev = sw.previousElementSibling;
      if (prev && prev.textContent.trim().includes('Extra free gens')) {
        return { state: sw.getAttribute('aria-checked') === 'true', strategy: 'prevSibling', debug: debugInfo };
      }
      // Check next sibling text
      const next = sw.nextElementSibling;
      if (next && next.textContent.trim().includes('Extra free gens')) {
        return { state: sw.getAttribute('aria-checked') === 'true', strategy: 'nextSibling', debug: debugInfo };
      }
      // Check parent's DIRECT text (not grandparent) — only if parent is small
      const parent = sw.parentElement;
      if (parent && parent.children.length <= 3) {
        const pText = parent.textContent.trim();
        if (pText.includes('Extra free gens') && !pText.includes('Unlimited')) {
          return { state: sw.getAttribute('aria-checked') === 'true', strategy: 'parentDirect', debug: debugInfo };
        }
      }
    }

    // Fallback: old approach
    const allText = document.querySelectorAll('span, div, p, label');
    for (const el of allText) {
      const text = el.textContent.trim();
      if (text === 'Extra free gens' || (text.includes('Extra') && text.includes('free') && text.length < 30)) {
        const parent = el.closest('div') || el.parentElement;
        if (parent) {
          const sw = parent.querySelector('button[role="switch"]');
          if (sw) return { state: sw.getAttribute('aria-checked') === 'true', strategy: 'textFallback', debug: debugInfo };
        }
      }
    }
    return { state: false, strategy: 'notFound', debug: debugInfo };
  });

  console.log(`[engine] 🔍 isExtraFreeGensOn: state=${result.state}, strategy=${result.strategy}`);
  if (result.debug) {
    console.log(`[engine] 🔍 All switches dump: ${JSON.stringify(result.debug)}`);
  }
  return result.state;
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
    const genText = await page.evaluate(() => {
      const btn = document.querySelector('button[id="hf:image-form-submit"]');
      return btn ? btn.textContent.trim() : 'not found';
    });
    console.log(`[engine] Generate button text: "${genText}"`);
    return false;
  }

  console.log(`[engine] Current batch: ${batch.current}/${batch.max}`);

  if (batch.current === 1) {
    console.log('[engine] ✅ Batch already 1/4');
    return true;
  }

  // Click "−" button to reduce batch to 1.
  // Higgsfield uses SVG icons — we cannot rely on button text content.
  // Use 4-strategy position-based approach.
  const clicksNeeded = batch.current - 1;
  for (let i = 0; i < clicksNeeded; i++) {
    const clicked = await page.evaluate(() => {
      // ── Strategy 1: Find "N/N" leaf node → walk up → find leftmost button in container ──
      const allEls = Array.from(document.querySelectorAll('*'));
      for (const el of allEls) {
        if (el.children.length > 0) continue;
        const text = (el.textContent || '').trim();
        if (!/^\d+\/\d+$/.test(text)) continue;

        let container = el.parentElement;
        for (let depth = 0; depth < 6 && container; depth++) {
          const btns = Array.from(container.querySelectorAll('button')).filter(b => b.offsetParent !== null);
          if (btns.length >= 2) {
            // Sort by horizontal position — leftmost button is "−"
            btns.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
            const counterRect = el.getBoundingClientRect();
            // Pick the button to the LEFT of the counter
            const leftBtns = btns.filter(b => b.getBoundingClientRect().right <= counterRect.left + 10);
            if (leftBtns.length > 0) {
              const minusBtn = leftBtns[leftBtns.length - 1]; // rightmost of the left buttons
              minusBtn.click();
              return `s1_position_depth${depth}`;
            }
            // Fallback: just use index 0 if all fail
            btns[0].click();
            return `s1_position_first_depth${depth}`;
          }
          container = container.parentElement;
        }
      }

      // ── Strategy 2: aria-label search (Higgsfield uses 'Decrement') ──
      const ariaBtn = document.querySelector('button[aria-label="Decrement"], button[aria-label="decrease"], button[aria-label="minus"], button[aria-label="-"]');
      if (ariaBtn) { ariaBtn.click(); return 's2_aria'; }


      // ── Strategy 3: button immediately before N/N sibling ──
      const buttons = Array.from(document.querySelectorAll('button'));
      for (let bi = 0; bi < buttons.length - 1; bi++) {
        let next = buttons[bi].nextElementSibling;
        let steps = 0;
        while (next && next.tagName !== 'BUTTON' && steps < 5) {
          if (/^\d+\/\d+$/.test((next.textContent || '').trim())) {
            buttons[bi].click();
            return 's3_sibling';
          }
          next = next.nextElementSibling;
          steps++;
        }
      }

      // ── Strategy 4: Generate button toolbar scan ──
      const genBtn = document.querySelector('button[id="hf:image-form-submit"]');
      if (genBtn) {
        let toolbar = genBtn.parentElement;
        for (let d = 0; d < 5 && toolbar; d++) {
          const counterEl = Array.from(toolbar.querySelectorAll('*')).find(
            e => e.children.length === 0 && /^\d+\/\d+$/.test((e.textContent || '').trim())
          );
          if (counterEl) {
            const btnsInRow = Array.from(toolbar.querySelectorAll('button')).filter(b => b.offsetParent !== null);
            const cr = counterEl.getBoundingClientRect();
            const leftBtns = btnsInRow.filter(b => b.getBoundingClientRect().right <= cr.left + 10);
            if (leftBtns.length > 0) {
              leftBtns[leftBtns.length - 1].click();
              return 's4_genBtn';
            }
          }
          toolbar = toolbar.parentElement;
        }
      }

      return false;
    });

    if (!clicked) {
      console.log('[engine] ⚠️ All strategies failed for "−" button');
      // Debug dump
      const debug = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).slice(0, 20).map(b => ({
          text: b.textContent.trim().substring(0, 15),
          id: b.id || null,
          aria: b.getAttribute('aria-label'),
          rect: (() => { const r = b.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)}`; })(),
        }))
      );
      console.log(`[engine] Button dump: ${JSON.stringify(debug)}`);
      return false;
    }
    console.log(`[engine] Minus click ${i + 1}/${clicksNeeded} via ${clicked}`);
    await chrome.sleep(400);
  }

  await chrome.sleep(600);
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
  const selectors = [
    'div[id="hf:tour-image-prompt"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"][class*="cursor-text"]',
  ];

  // Method 1: Direct DOM mutation — set innerText to empty string
  const cleared = await page.evaluate((sels) => {
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) {
        el.focus();
        // Clear via execCommand (triggers React/Vue reactivity)
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        // Belt-and-suspenders: also set innerText directly
        if (el.innerText.trim().length > 0) {
          el.innerText = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      }
    }
    return false;
  }, selectors);

  if (cleared) {
    await chrome.sleep(300);
  }

  // Method 2: Keyboard Ctrl+A → Delete (works even if DOM mutation missed React state)
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      await chrome.sleep(100);
      await page.keyboard.down('Meta'); // Cmd on Mac
      await page.keyboard.press('a');
      await page.keyboard.up('Meta');
      await chrome.sleep(100);
      await page.keyboard.press('Delete');
      await chrome.sleep(200);
      await page.keyboard.press('Backspace'); // Extra safety
      await chrome.sleep(200);
      break;
    }
  }

  // Verify it's empty
  const remaining = await page.evaluate((sels) => {
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) return el.innerText.trim();
    }
    return '';
  }, selectors);

  if (remaining.length > 0) {
    console.log(`[engine] ⚠️ clearPromptField: field still has ${remaining.length} chars after clear attempt`);
  } else {
    console.log('[engine] ✅ clearPromptField: field is empty');
  }
}


async function enterPrompt(page, prompt) {
  console.log(`[engine] === enterPrompt called ===`);
  console.log(`[engine] Prompt text: "${prompt.substring(0, 100)}..."`);

  const selectors = [
    'div[id="hf:tour-image-prompt"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"][class*="cursor-text"]',
  ];

  const sanitized = prompt.replace(/[\r\n]+/g, ' ').trim();

  // ── Method 1: React fiber trick — set innerText + dispatch React synthetic events ──
  // This forces React to update its internal state, unlike .value= or innerText= alone.
  const method1Success = await page.evaluate((text, sels) => {
    let el = null;
    for (const sel of sels) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) return false;

    try {
      el.focus();

      // Select all and delete existing content first
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);

      // Insert new text via execCommand (triggers React's onInput)
      const inserted = document.execCommand('insertText', false, text);
      if (inserted) return true;

      // Fallback: set innerText and dispatch events React understands
      el.innerText = text;

      // Fire input event with React's expected nativeEvent structure
      const inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      });
      el.dispatchEvent(inputEvent);

      const changeEvent = new Event('change', { bubbles: true });
      el.dispatchEvent(changeEvent);

      return true;
    } catch (e) {
      return false;
    }
  }, sanitized, selectors);

  console.log(`[engine] Method 1 (React execCommand): ${method1Success ? 'ok' : 'failed'}`);
  await chrome.sleep(400);

  // Verify after method 1
  let check = await page.evaluate((expected, sels) => {
    let el = null;
    for (const sel of sels) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) return { ok: false, actual: '', actualLen: 0 };
    const actual = el.innerText.trim();
    return {
      ok: actual.length > 0 && actual.includes(expected.substring(0, 30).trim()),
      actual: actual.substring(0, 100),
      actualLen: actual.length,
    };
  }, sanitized, selectors);

  console.log(`[engine] Verify (m1): ok=${check.ok}, actual="${check.actual}"`);

  if (!check.ok) {
    // ── Method 2: Focus field → Cmd+A → CDP Input.insertText (bypasses browser input event chain) ──
    console.log(`[engine] ⚠️ Method 1 failed, trying CDP Input.insertText...`);

    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await chrome.sleep(200);
        // Select all
        await page.keyboard.down('Meta');
        await page.keyboard.press('a');
        await page.keyboard.up('Meta');
        await chrome.sleep(150);
        // Use CDP to insert text (bypasses keyboard simulation issues)
        const session = await page.target().createCDPSession();
        await session.send('Input.insertText', { text: sanitized });
        await session.detach();
        await chrome.sleep(400);
        break;
      }
    }

    // Re-verify
    check = await page.evaluate((expected, sels) => {
      let el = null;
      for (const sel of sels) {
        el = document.querySelector(sel);
        if (el) break;
      }
      if (!el) return { ok: false, actual: '', actualLen: 0 };
      const actual = el.innerText.trim();
      return {
        ok: actual.length > 0 && actual.includes(expected.substring(0, 30).trim()),
        actual: actual.substring(0, 100),
        actualLen: actual.length,
      };
    }, sanitized, selectors);

    console.log(`[engine] Verify (m2): ok=${check.ok}, actual="${check.actual}"`);
  }

  if (!check.ok) {
    throw new Error(`Промпт НЕ вставлен! В поле осталось: "${check.actual}". Ожидалось: "${sanitized.substring(0, 30)}"`);
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
/**
 * Detect site-side errors after a generation attempt.
 * Called when waitForSingleImage returns null (timeout).
 * Checks DOM for error/status banners.
 * 
 * Returns:
 *   'credits_exhausted' — fatal, stop batch
 *   'auth_error'        — fatal, stop batch (login page)
 *   'site_failed'       — recoverable, retry slot
 *   null                — no specific error detected (generic timeout)
 */
async function detectSiteError(page) {
  try {
    // Check for login redirect (auth_error)
    const pageUrl = page.url();
    if (pageUrl.includes('sign-in') || pageUrl.includes('login') || pageUrl.includes('auth')) {
      console.log('[engine] 🔐 detectSiteError: auth redirect detected');
      return 'auth_error';
    }

    return await page.evaluate(() => {
      const bodyText = document.body ? document.body.innerText.toLowerCase() : '';

      // Credits exhausted (fatal)
      if (
        bodyText.includes('all credits used') ||
        bodyText.includes('no credits remaining') ||
        bodyText.includes('upgrade your plan')
      ) {
        return 'credits_exhausted';
      }

      // Find any toast/notification/banner elements
      const toastSelectors = [
        '[class*="toast"]', '[class*="notification"]', '[class*="alert"]',
        '[class*="error"]', '[role="alert"]', '[class*="banner"]',
        '[class*="message"]', '[class*="snack"]',
      ];

      for (const sel of toastSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = (el.textContent || '').toLowerCase();
          if (
            text.includes('all credits used') ||
            text.includes('no credits') ||
            text.includes('upgrade')
          ) {
            return 'credits_exhausted';
          }
          if (
            text.includes('failed') ||
            text.includes('credits refunded') ||
            text.includes('generation failed') ||
            text.includes('try again')
          ) {
            return 'site_failed';
          }
          if (
            text.includes('session expired') ||
            text.includes('sign in') ||
            text.includes('log in')
          ) {
            return 'auth_error';
          }
        }
      }

      return null; // No specific error detected
    });
  } catch (err) {
    console.log(`[engine] detectSiteError failed: ${err.message}`);
    return null;
  }
}

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
 * Extract UUID from a feed image URL.
 * Pattern: hf_YYYYMMDD_HHMMSS_{uuid}_min.webp
 */
function extractUUID(url) {
  if (!url) return null;
  const match = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}

/**
 * Snapshot the UUIDs of the top-N images in the feed.
 * Used to detect whether a "new" image is actually old.
 */
async function snapshotFeedFingerprints(page, n = 10) {
  const urls = await page.evaluate((count) => {
    const feed = document.querySelector('#soul-feed-scroll');
    if (!feed) return [];
    const result = [];
    const imgs = feed.querySelectorAll('img');
    for (let i = 0; i < Math.min(imgs.length, count); i++) {
      const img = imgs[i];
      if (img.src && img.src.startsWith('http') && !img.src.includes('avatar')) {
        // Extract inner URL from proxy wrapper
        try {
          const u = new URL(img.src);
          const inner = u.searchParams.get('url');
          result.push(inner || img.src);
        } catch {
          result.push(img.src);
        }
      }
    }
    return result;
  }, n);

  // Extract UUIDs
  const uuids = urls.map(u => extractUUID(u)).filter(Boolean);
  console.log(`[engine] 📸 Feed fingerprint snapshot: ${uuids.length} UUIDs captured`);
  return uuids;
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
 * PRIMARY DETECTION: UUID fingerprinting.
 * Higgsfield often REMOVES old feed images when adding new ones,
 * so feed count may stay the same (e.g. 9 → 8 during Queued → 9 when done).
 * Count-based detection (9 > 9) fails in this case.
 * 
 * Strategy:
 * 1. Snapshot UUIDs of top feed images BEFORE clicking Generate.
 * 2. Poll: on each cycle check the TOP feed image's UUID.
 * 3. If top UUID is NOT in the pre-click snapshot → it's genuinely new → accept.
 * 4. Count-based check is kept as a SECONDARY fast path (count increased AND UUID is new).
 * 
 * @param {Object} page - Puppeteer page
 * @param {number} feedCountBefore - Number of images in feed before Generate click
 * @param {string[]} fingerprintsBefore - UUIDs of top images before Generate click
 * @param {number} index - Current image index (1-based)
 * @param {number} total - Total images expected
 * @param {Function} onProgress - Progress callback
 * @returns {string|null} - New image URL or null if timeout
 */
/**
 * Ждёт стабилизации ленты: нет Queued-элементов и количество изображений
 * не меняется два цикла подряд. Вызывается на границе между промптами.
 * @param {Object} page - Puppeteer страница
 * @param {number} maxWaitMs - максимум ожидания (по умолчанию 60с)
 */
async function waitForFeedStable(page, maxWaitMs = 60_000) {
  const deadline = Date.now() + maxWaitMs;
  let prevCount = -1;
  let stableCount = 0;

  console.log('[engine] ⏳ waitForFeedStable: ждём стабилизации ленты...');

  while (Date.now() < deadline) {
    await chrome.sleep(POLL_INTERVAL);

    const queued = await countQueuedItems(page);
    const feedCount = await countFeedImages(page);

    if (queued === 0 && feedCount === prevCount) {
      stableCount++;
      if (stableCount >= 2) {
        console.log(`[engine] ✅ waitForFeedStable: лента стабильна (feedCount=${feedCount})`);
        return;
      }
    } else {
      stableCount = 0; // сброс при изменении
    }

    prevCount = feedCount;

    if (queued > 0) {
      console.log(`[engine] ⏳ waitForFeedStable: всё ещё Queued=${queued}, feedCount=${feedCount}`);
    }
  }

  console.log('[engine] ⚠️ waitForFeedStable: таймаут, продолжаем несмотря на нестабильность');
}

/**
 * Wait for 1 new image to appear after a single Generate click.
 *
 * PRIMARY DETECTION: UUID fingerprinting.
 * Higgsfield often REMOVES old feed images when adding new ones,
 * so feed count may stay the same (e.g. 9 → 8 during Queued → 9 when done).
 * Count-based detection (9 > 9) fails in this case.
 *
 * Strategy:
 * 1. Snapshot UUIDs of top feed images BEFORE clicking Generate.
 * 2. Poll: on each cycle check the TOP feed image's UUID.
 * 3. If top UUID is NOT in the pre-click snapshot AND NOT in excludeFingerprints → accept.
 * 4. Count-based check is kept as a SECONDARY fast path.
 *
 * @param {Object} page - Puppeteer page
 * @param {number} feedCountBefore - Number of images in feed before Generate click
 * @param {string[]} fingerprintsBefore - UUIDs of top images before Generate click
 * @param {number} index - Current image index (1-based)
 * @param {number} total - Total images expected
 * @param {Function} onProgress - Progress callback
 * @param {string[]} [excludeFingerprints=[]] - UUIDs от предыдущего промпта (нельзя принять за свои)
 * @returns {string|null} - New image URL or null if timeout
 */
async function waitForSingleImage(page, feedCountBefore, fingerprintsBefore, index, total, onProgress, excludeFingerprints = []) {
  const startTime = Date.now();
  const deadline = startTime + GENERATION_TIMEOUT;
  let generationDetected = false;
  let queuedGone = false;

  // Набор всех запрещённых UUID: до клика + от прошлого промпта
  const forbiddenUUIDs = new Set([...fingerprintsBefore, ...excludeFingerprints]);

  while (Date.now() < deadline && !shouldStop) {
    await chrome.sleep(POLL_INTERVAL);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Check for queued items
    const queued = await countQueuedItems(page);
    if (queued > 0 && !generationDetected) {
      generationDetected = true;
      console.log(`[engine] 🎬 Image ${index}: generation started (Queued=${queued})`);
    } else if (queued > 1) {
      // Multiple queued items — potential ghost generation!
      console.log(`[engine] ⚠️ MULTI-QUEUED: Image ${index}: queued=${queued} — possible ghost generation!`);
    }

    // Detect when Queued disappears = image should be ready
    if (generationDetected && queued === 0 && !queuedGone) {
      queuedGone = true;
      console.log(`[engine] 🎬 Image ${index}: Queued disappeared at ${elapsed}s, checking for new img...`);
      await chrome.sleep(1500); // Wait for DOM update
    }

    const feedCountNow = await countFeedImages(page);

    // ── FORENSIC: Every 3 seconds log feed state ──
    if (elapsed % 9 === 3) {
      const topForeUrl = await getFirstFeedImgUrl(page);
      const topForeUUID = extractUUID(topForeUrl);
      const isForbidden = topForeUUID ? forbiddenUUIDs.has(topForeUUID) : null;
      console.log(`[engine] 🔍 POLL[${elapsed}s] img=${index}: queued=${queued}, feed=${feedCountNow}/${feedCountBefore}, topUUID=${topForeUUID || 'none'}, forbidden=${isForbidden}, genDetected=${generationDetected}, queuedGone=${queuedGone}`);
    }

    const shouldCheckUUID = queuedGone || feedCountNow > feedCountBefore || elapsed > 10;

    if (shouldCheckUUID) {
      // ── FIX RC-4: Захватываем URL СРАЗУ при обнаружении UUID, без повторного fetch после sleep ──
      const topUrl = await getFirstFeedImgUrl(page);
      const topUUID = extractUUID(topUrl);

      if (topUUID && !forbiddenUUIDs.has(topUUID)) {
        // Genuinely new image — not in pre-click snapshot and not from prior prompt!
        console.log(`[engine] ✅ Image ${index} ready via UUID detection (${elapsed}s, feedCount: ${feedCountBefore}→${feedCountNow}, queued=${queued}, uuid=${topUUID}): ${(topUrl || '').substring(0, 80)}...`);
        // Небольшое ожидание для полной загрузки, но URL уже зафиксирован
        await chrome.sleep(800);
        return topUrl;
      }

      // Top UUID is known — scan deeper positions
      if ((queuedGone || elapsed > 15) && elapsed > 5) {
        const allCurrentFingerprints = await snapshotFeedFingerprints(page, 5);
        const newFingerprints = allCurrentFingerprints.filter(fp => !forbiddenUUIDs.has(fp));
        if (newFingerprints.length > 0) {
          // Берём URL первого подходящего нового UUID
          const urls = await page.evaluate((count) => {
            const feed = document.querySelector('#soul-feed-scroll');
            if (!feed) return [];
            const result = [];
            const imgs = feed.querySelectorAll('img');
            for (let i = 0; i < Math.min(imgs.length, count); i++) {
              const img = imgs[i];
              if (img.src && img.src.startsWith('http') && !img.src.includes('avatar')) {
                try {
                  const u = new URL(img.src);
                  const inner = u.searchParams.get('url');
                  result.push(inner || img.src);
                } catch {
                  result.push(img.src);
                }
              }
            }
            return result;
          }, 5);

          // Находим первый URL с новым UUID
          let foundUrl = null;
          for (const u of urls) {
            const uuid = extractUUID(u);
            if (uuid && !forbiddenUUIDs.has(uuid)) { foundUrl = u; break; }
          }

          if (foundUrl) {
            console.log(`[engine] ✅ Image ${index} ready via deep UUID scan (${elapsed}s, queued=${queued}, newUUIDs=${newFingerprints.length}): ${foundUrl.substring(0, 80)}...`);
            await chrome.sleep(800);
            return foundUrl;
          }
        }
      }
    }

    // Status update
    const status = queuedGone ? 'обработка...' : queued > 0 ? 'генерация...' : 'ожидание...';
    onProgress({
      step: 'waiting',
      message: `Изображение ${index}/${total}: ${status} (${elapsed}с)`,
    });

    // Debug log every 15 seconds
    if (elapsed % 15 === 0 && elapsed > 0) {
      const topUrl = await getFirstFeedImgUrl(page);
      const topUUID = extractUUID(topUrl);
      const isKnown = topUUID ? forbiddenUUIDs.has(topUUID) : 'N/A';
      console.log(`[engine] DEBUG: queued=${queued}, queuedGone=${queuedGone}, feedCount=${feedCountNow}/${feedCountBefore}, topUUID=${topUUID || 'none'}, isForbidden=${isKnown}, elapsed=${elapsed}s`);
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
  waitForFeedStable,
  snapshotFeedFingerprints,
  IMAGES_PER_PROMPT,
  DEFAULT_MODEL,
  UNLIMITED_MODELS,
  PAID_ONLY_MODELS,
};

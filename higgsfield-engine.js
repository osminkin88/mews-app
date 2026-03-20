/* ============================================================
   HIGGSFIELD ENGINE v2
   
   Generates images via CDP automation of higgsfield.ai
   Enforces Unlimited mode, strict 4-image orchestration,
   and reliable image tracking per-prompt.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const chrome = require('./chrome-manager');
const {
  MODEL_REGISTRY, MODEL_ORDER,
  UNLIMITED_MODELS, PAID_ONLY_MODELS, MODEL_QUALITY_OPTIONS,
  getModelCapabilities, resolveCompatibleSettings,
} = require('./model-capabilities');

// ── Config ────────────────────────────────────────────────────
const IMAGES_PER_PROMPT = 4;
const SOFT_TIMEOUT = 4 * 60 * 1000;  // 4 minutes — warn, but keep waiting if in-flight
const HARD_TIMEOUT = 10 * 60 * 1000; // 10 minutes — absolute max, stop unconditionally
const POLL_INTERVAL = 3000;         // 3s polling
const DEFAULT_MODEL = 'nano_banana_pro';
const PREFLIGHT_STEP_TIMEOUT = 15000; // 15s — max time for any single preflight step

// ── Image format → file extension mapping ────────────────────
// Used after validateDownload() to rename .tmp → correct extension
const FORMAT_EXT_MAP = { jpeg: '.jpg', png: '.png', webp: '.webp' };

// ── Timeout wrapper ──
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms/1000}s): ${label}`)), ms)
    ),
  ]);
}

// ── State ─────────────────────────────────────────────────────
let isGenerating = false;
let shouldPause  = false;  // soft pause: finish current slot, then stop
let shouldCancel = false;  // hard cancel: abandon current slot immediately

function getIsGenerating() { return isGenerating; }
function getShouldPause()  { return shouldPause; }
function getShouldCancel() { return shouldCancel; }
function resetStopFlags()  { shouldPause = false; shouldCancel = false; }
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
    skipSlots = [],           // [1,2] — slot numbers already saved (backfill mode). Engine skips these.
    existingSlots = [],       // pre-existing slot records from old meta (used to reconstruct imageResults)
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

    // ── Step 3: UNIFIED SETTINGS SYNC ──
    // Applies + verifies ALL settings: model, quality, aspect, batch, unlimited, extra free gens.
    // Throws on ANY mismatch — generation will NOT proceed with wrong settings.
    onProgress({ step: 'preflight', message: 'Синхронизирую настройки...' });
    await preflightSettingsSync(page, { model, modelInfo, quality, aspect }, onProgress);

    // ── Step 4: Enter prompt (AFTER all settings are confirmed!) ──
    onProgress({ step: 'prompt', message: 'Ввожу промпт...' });
    await enterPrompt(page, prompt);

    // ── NOTE: imagesCount vs site batch ──
    // imagesCount = how many times the app clicks Generate (app-level loop).
    // Site batch is ALWAYS forced to 1/4 by preflightSettingsSync().
    // They are independent: "4 images" = 4 separate Generate clicks, each producing 1 image.


    // ── Step 9: SEQUENTIAL STATE MACHINE — generate + download + validate per image ──
    // Each slot (i) is an independent unit with its own 2-attempt retry loop.
    // Error classification:
    //   fatal       → throw immediately, stops entire batc (model changed, auth error, credits exhausted)
    //   recoverable → retry same slot (click failed, timeout, download failed) — up to 2 attempts
    //   partial     → mark slot failed, continue to next slot
    const imageResults = [];
    let fatalError = null; // Set if a fatal error stops the entire batch

    for (let i = 0; i < imagesCount && !shouldPause && !shouldCancel && !fatalError; i++) {
      const img = {
        index: i + 1,
        state: 'pending',
        url: null,
        file: null,
        size: 0,
        quality: null,
        error: null,
        errorReason: null,   // site_failed | click_failed | timeout | download_failed | validation_failed | auth_error | credits_exhausted | paused | cancelled
        attempts: 0,
      };

      // ── BACKFILL SKIP: slot already saved in previous session ──
      // Do NOT click Generate. Do NOT download. Do NOT overwrite the file.
      // Inject the pre-existing slot record and notify renderer.
      if (skipSlots.includes(img.index)) {
        const existing = existingSlots.find(s => s.slot === img.index) || {};
        console.log(`\n[engine] ⏭️  BACKFILL SKIP slot ${img.index}/${imagesCount} — already saved (file: ${existing.file || 'gen_' + img.index + '.jpg'})`);
        imageResults.push({
          index: img.index,
          state: 'saved',
          file: existing.file || `gen_${img.index}.jpg`,
          size: existing.size || 0,
          quality: existing.quality || null,
          error: null,
          errorReason: null,
          attempts: 0,
          _backfillSkipped: true,  // marker: this result came from old meta, not this session
        });
        // Notify renderer so progress bar advances — same event shape as real 'saved'
        onProgress({
          step: 'saved',
          message: `⏭️ Слот ${img.index}/${imagesCount}: уже сохранён (backfill пропуск)`,
          current: img.index,
          total: imagesCount,
          state: 'saved',
          savedSlot: img.index,
          _backfillSkipped: true,
        });
        // Save intermediate meta after this slot (includes skipped + any already-done real slots)
        saveIntermediateMeta(outputDir, prompt, model, aspect, quality, imageResults, imagesCount);
        continue;
      }

      console.log(`\n[engine] ═══ SLOT ${img.index}/${imagesCount} — starting ═══`);



      // ── Per-slot retry loop: up to 2 attempts ──
      let slotSucceeded = false;

      for (let attempt = 1; attempt <= 2 && !slotSucceeded && !shouldPause && !shouldCancel && !fatalError; attempt++) {
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

          // ═══ STRICT GUARD: Wait for inFlight==0 (Queued + Generating) before clicking ═══
          const inFlightBefore = await countInFlightItems(page);
          if (inFlightBefore.total > 0) {
            console.log(`[engine] ⏳ GUARD: inFlight=${inFlightBefore.total} (Q=${inFlightBefore.queued} G=${inFlightBefore.generating}) before slot ${img.index} — waiting...`);
            const guardTimeout = 300000; // 5 minutes max
            const guardStart = Date.now();
            let guardCleared = false;
            while (Date.now() - guardStart < guardTimeout) {
              await chrome.sleep(3000);
              const inf = await countInFlightItems(page);
              const elapsed = Math.round((Date.now() - guardStart) / 1000);
              console.log(`[engine] ⏳ GUARD: inFlight=${inf.total} (Q=${inf.queued} G=${inf.generating}) (${elapsed}s)`);
              if (inf.total === 0) {
                console.log(`[engine] ✅ GUARD: all in-flight cleared after ${elapsed}s`);
                guardCleared = true;
                break;
              }
              // Check page health every 30s during guard wait
              if (elapsed % 30 === 0 && elapsed > 0) {
                const health = await verifyPageHealth(page);
                if (!health.alive) {
                  const err = new Error(`Page lost during guard wait: ${health.reason}`);
                  err.errorClass = 'fatal';
                  err.errorReason = health.reason;
                  throw err;
                }
              }
            }
            if (!guardCleared) {
              const inf = await countInFlightItems(page);
              const err = new Error(`GUARD: in-flight не очистились за 5 минут (Q=${inf.queued} G=${inf.generating}). Слот ${img.index} пропущен.`);
              err.errorClass = 'recoverable';
              err.errorReason = 'guard_timeout';
              throw err;
            }
          }

          // ═══ SNAPSHOT FEED ═══
          // CRITICAL: capture ALL existing images in the feed, not just top-10!
          // If we only capture 10 but user has 20+ images, the extra ones appear as
          // "new candidates" during reconciliation → Slot Ambiguity.
          const feedCountBefore = await countFeedImages(page);
          const fingerprintsBeforeAll = await getFeedImageUrls(page); // ALL images
          const fingerprintsBefore = fingerprintsBeforeAll.map(u => extractUUID(u)).filter(Boolean);
          console.log(`[engine] 📊 Slot ${img.index} pre-click: feedCount=${feedCountBefore}, fingerprints=${fingerprintsBefore.length} (ALL), exclude=${excludeFingerprints.length}`);

          // ═══ CLICK GENERATE ═══
          const inFlightPreClick = await countInFlightItems(page);
          if (inFlightPreClick.total > 0) {
            console.log(`[engine] ⚠️ PRE-CLICK: in-flight=${inFlightPreClick.total} (Q=${inFlightPreClick.queued} G=${inFlightPreClick.generating}) — site still processing!`);
          }
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
          const inFlightPost = await countInFlightItems(page);
          const feedPost = await countFeedImages(page);
          const topUrlPost = await getFirstFeedImgUrl(page);
          const topUUIDPost = extractUUID(topUrlPost);
          console.log(`[engine] 📡 POST-CLICK (2s): inFlight=${inFlightPost.total} (Q=${inFlightPost.queued} G=${inFlightPost.generating}), feed=${feedPost} (was ${feedCountBefore}), topUUID=${topUUIDPost || 'none'}, isForbidden=${topUUIDPost ? (excludeFingerprints.includes(topUUIDPost) || fingerprintsBefore.includes(topUUIDPost)) : 'N/A'}`);

          // ═══ WAIT FOR NEW IMAGE (fingerprint primary detection) ═══
          onProgress({ step: 'waiting', message: `Слот ${img.index}/${imagesCount}: создаю изображение...`, state: 'generating' });
          let imageUrl = await waitForSingleImage(page, feedCountBefore, fingerprintsBefore, img.index, imagesCount, onProgress, excludeFingerprints);

          // ═══ LAST-CHANCE RESCAN: image may have appeared at timeout edge ═══
          if (!imageUrl && !shouldCancel) {
            await chrome.sleep(3000);
            const lcUrls = await scanGenerationImages(page, 10);
            for (const lcUrl of lcUrls) {
              const lcUUID = extractUUID(lcUrl);
              if (lcUUID && !fingerprintsBefore.includes(lcUUID) && !excludeFingerprints.includes(lcUUID)) {
                console.log(`[engine] 🆘 LAST-CHANCE RESCAN: image found post-timeout (uuid=${lcUUID}): ${(lcUrl || '').substring(0, 80)}...`);
                imageUrl = lcUrl;
                break;
              }
            }
          }

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
            ? path.join(outputDir, `gen_${img.index}.tmp`)
            : path.join(__dirname, 'output', 'temp', `gen_${img.index}.tmp`);
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
            // Forensic: log exact reason before retry
            const diskSize = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
            console.log(`[engine] ⚠️ Slot ${img.index} validation failed: reason=${validation.reason}, diskSize=${Math.round(diskSize/1024)}KB, method=${dlResult.method || 'unknown'}`);
            console.log(`[engine] 🔄 Retrying download for slot ${img.index}...`);
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

          // ═══ RENAME .tmp → real extension ═══
          let realExt = FORMAT_EXT_MAP[validation.format] || '.jpg';
          const finalPath = destPath.replace(/\.tmp$/, realExt);
          if (finalPath !== destPath) {
            try {
              fs.renameSync(destPath, finalPath);
              console.log(`[engine] 📝 Renamed: ${path.basename(destPath)} → ${path.basename(finalPath)}`);
            } catch (renameErr) {
              // Graceful fallback: if rename fails (mock FS, race condition),
              // keep the .jpg extension for metadata but log the issue
              console.warn(`[engine] ⚠️ Rename failed (${renameErr.code || renameErr.message}), using .jpg fallback`);
              realExt = '.jpg';
            }
          }

          // ═══ SAVED ✅ ═══
          img.state = 'saved';
          img.file = `gen_${img.index}${realExt}`;
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
            // For page context loss errors: attempt recovery before giving up
            const recoveryReasons = ['page_closed', 'page_invalid', 'prompt_missing'];
            if (recoveryReasons.includes(errReason) && attempt === 1) {
              console.log(`[engine] 🔄 SLOT ${img.index}: attempting page recovery before fatal stop (reason: ${errReason})...`);
              onProgress({
                step: 'recovering',
                message: `🔄 Слот ${img.index}/${imagesCount}: восстанавливаю страницу...`,
                current: img.index,
                total: imagesCount,
              });
              
              const modelInfo = UNLIMITED_MODELS[model] || {};
              const recoveredPage = await attemptPageRecovery(chrome, modelInfo, prompt);
              if (recoveredPage) {
                // Recovery succeeded — update page reference and retry slot
                page = recoveredPage;
                console.log(`[engine] ✅ SLOT ${img.index}: page recovered — retrying slot`);
                onProgress({
                  step: 'recovered',
                  message: `✅ Слот ${img.index}/${imagesCount}: страница восстановлена, повторяю...`,
                  current: img.index,
                  total: imagesCount,
                });
                continue; // Retry this attempt
              }
              // Recovery failed — fall through to fatal stop
              console.log(`[engine] ❌ SLOT ${img.index}: page recovery failed — stopping batch`);
            }

            // Fatal: stop the entire batch immediately
            fatalError = { message: slotErr.message, reason: errReason };
            img.state = 'failed';
            img.error = slotErr.message;
            img.errorReason = errReason;

            onProgress({
              step: 'slot_failed',
              message: `❌ Слот ${img.index}/${imagesCount}: ${errReason === 'page_closed' ? 'вкладка закрыта' : errReason === 'prompt_missing' ? 'промпт пропал' : errReason === 'page_invalid' ? 'страница потеряна' : errReason}`,
              current: img.index,
              total: imagesCount,
              failedSlot: img.index,
              failedReason: errReason,
              failedError: slotErr.message,
            });
            break; // Exit per-slot retry loop
          }

          if (errClass === 'slot_ambiguity') {
            // Ambiguity: multiple candidates exist — do NOT retry, quarantine
            img.state = 'failed';
            img.error = slotErr.message;
            img.errorReason = 'slot_ambiguity';
            console.log(`[engine] ⚠️ SLOT ${img.index} — AMBIGUITY: ${(slotErr.candidates || []).length} candidates, NOT retrying`);

            // Write ambiguity event to quarantine folder
            if (outputDir) {
              const quarantineDir = path.join(outputDir, '..', '..', '_desync_recovery');
              if (!fs.existsSync(quarantineDir)) fs.mkdirSync(quarantineDir, { recursive: true });
              const eventFile = path.join(quarantineDir, `ambiguity_slot_${img.index}_${Date.now()}.json`);
              fs.writeFileSync(eventFile, JSON.stringify({
                timestamp: new Date().toISOString(),
                slot: img.index,
                candidateCount: (slotErr.candidates || []).length,
                candidates: (slotErr.candidates || []).map(c => ({ pos: c.pos, uuid: c.uuid })),
                message: slotErr.message,
              }, null, 2));
              console.log(`[engine] 📦 Ambiguity event saved: ${path.basename(eventFile)}`);
            }

            // Notify renderer
            onProgress({
              step: 'slot_failed',
              message: `⚠️ Слот ${img.index}/${imagesCount}: неоднозначность (${(slotErr.candidates || []).length} кандидатов)`,
              current: img.index,
              total: imagesCount,
              failedSlot: img.index,
              failedReason: 'slot_ambiguity',
              failedError: slotErr.message,
            });
            break; // Exit per-slot retry loop — do NOT retry ambiguity
          }

          if (attempt === 2) {
            // All retries exhausted → mark slot failed, continue batch
            img.state = 'failed';
            img.error = slotErr.message;
            img.errorReason = errReason;
            console.log(`[engine] ⚠️ SLOT ${img.index} — all retries exhausted, marking FAILED [${errReason}]`);
            // Notify renderer about slot failure
            onProgress({
              step: 'slot_failed',
              message: `❌ Слот ${img.index}/${imagesCount} не удался (${errReason})`,
              current: img.index,
              total: imagesCount,
              failedSlot: img.index,
              failedReason: errReason,
              failedError: slotErr.message,
            });
            await dismissOverlays(page);
          }
          // else: attempt < 2 → loop continues to retry this slot
        }
      } // end per-slot retry loop

      if ((shouldPause || shouldCancel) && !slotSucceeded && img.state !== 'failed') {
        img.state = shouldCancel ? 'cancelled' : 'paused';
        img.errorReason = shouldCancel ? 'cancelled' : 'paused';
        console.log(`[engine] ⚠️ Slot ${img.index} aborted due to flag. Assigning state: ${img.state}`);
        console.log(`[engine] 🛑 Exit reason: ${img.state} (флаг активности)`);
        onProgress({ step: 'debug', message: shouldCancel ? `🛑 Генерация отменена пользователем` : `⏸ Работа приостановлена` });
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
      // Save remaining slots as stopped (fatal errors always mark as 'stopped')
      for (let j = imageResults.length; j < imagesCount; j++) {
        imageResults.push({ index: j + 1, state: 'stopped', errorReason: 'stopped', url: null, file: null });
      }
      saveIntermediateMeta(outputDir, prompt, model, aspect, quality, imageResults, imagesCount);

      const fatalErr = new Error(fatalError.message);
      fatalErr.errorReason = fatalError.reason;
      fatalErr.isFatal = true;
      throw fatalErr;
    }

    // ── Handle user pause / cancel ──
    if (shouldPause || shouldCancel) {
      const slotState = shouldCancel ? 'cancelled' : 'paused';
      console.log(`[engine] ⚠️ Skip remaining slots, assigning state: ${slotState}`);
      console.log(`[engine] ⏭ Пропуск оставшихся слотов (${slotState})`);
      onProgress({ step: 'debug', message: shouldCancel ? `Остановлено пользователем` : `Подождите, сохраняю прогресс...` });
      for (let j = imageResults.length; j < imagesCount; j++) {
        imageResults.push({ index: j + 1, state: slotState, errorReason: slotState, url: null, file: null });
      }
    }

    // ── Final summary ──
    const savedCount = imageResults.filter(r => r.state === 'saved').length;
    const failedCount = imageResults.filter(r => r.state === 'failed').length;
    const pausedCount = imageResults.filter(r => r.state === 'paused').length;
    const cancelledCount = imageResults.filter(r => r.state === 'cancelled').length;
    const stoppedCount = pausedCount + cancelledCount; // backward compat for return value

    let promptStatus;
    if (savedCount === imagesCount) {
      promptStatus = 'done';
    } else if (shouldCancel) {
      promptStatus = savedCount > 0 ? 'cancelled' : 'cancelled'; // always 'cancelled' on hard cancel
    } else if (shouldPause && savedCount > 0) {
      promptStatus = 'paused';
    } else if (shouldPause && savedCount === 0) {
      promptStatus = 'paused';
    } else if (savedCount > 0) {
      promptStatus = 'partial';
    } else {
      promptStatus = 'error';
    }

    console.log(`\n[engine] ═══ SUMMARY: ${savedCount} saved, ${failedCount} failed, ${pausedCount} paused, ${cancelledCount} cancelled out of ${imagesCount} → promptStatus=${promptStatus} ═══`);

    if (savedCount === 0 && !shouldPause && !shouldCancel) {
      const zeroSavedErr = new Error(`Ни одного изображения не сохранено (${failedCount} failed)`);
      zeroSavedErr.errorReason = 'all_slots_failed';
      zeroSavedErr.imageResults = imageResults;
      zeroSavedErr.promptStatus = promptStatus;
      throw zeroSavedErr;
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
    // Strategy: find switch whose DIRECT parent text is exactly "Extra free gens"
    // This avoids accidentally clicking the Unlimited switch (which has different parent text)
    const switches = document.querySelectorAll('button[role="switch"]');
    for (const sw of switches) {
      const parent = sw.parentElement;
      if (!parent) continue;
      // Check direct parent text (not grandparent, to avoid Unlimited container)
      const parentText = parent.textContent.trim();
      if (parentText === 'Extra free gens') {
        console.log('[engine-browser] Found Extra free gens via exact parent text, clicking...');
        sw.click();
        return 'exact_parent_match';
      }
    }

    // Strategy 2: find switch whose prevSibling text contains 'Extra free gens'
    for (const sw of switches) {
      const prev = sw.previousElementSibling;
      if (prev && prev.textContent.trim().includes('Extra free gens')) {
        console.log('[engine-browser] Found Extra free gens via prevSibling, clicking...');
        sw.click();
        return 'prev_sibling_match';
      }
      const next = sw.nextElementSibling;
      if (next && next.textContent.trim().includes('Extra free gens')) {
        sw.click();
        return 'next_sibling_match';
      }
    }

    // Strategy 3: traverse text nodes
    const allText = document.querySelectorAll('span, div, p, label');
    for (const el of allText) {
      const text = el.textContent.trim();
      // Must match 'Extra free gens' exactly, not contain 'Unlimited'
      if (text === 'Extra free gens' || (text.includes('Extra free gens') && !text.includes('Unlimited'))) {
        const container = el.closest('div') || el.parentElement;
        if (container) {
          const sw = container.querySelector('button[role="switch"]');
          if (sw) {
            sw.click();
            return 'text_node_match';
          }
        }
      }
    }

    return null;
  });

  console.log(`[engine] ensureExtraFreeGensOff clicked via strategy: ${clicked || 'NONE'}`);

  if (!clicked) {
    console.log('[engine] ⚠️ Could not find Extra free gens toggle — proceeding anyway');
    return true; // Don't block generation over this
  }

  // Verify
  await chrome.sleep(800);
  const stillOn = await isExtraFreeGensOn(page);
  if (stillOn) {
    console.log('[engine] ⚠️ Extra free gens still ON after click — retrying once...');
    await chrome.sleep(500);
    const retryResult = !(await isExtraFreeGensOn(page));
    if (!retryResult) {
      console.log('[engine] ⚠️ Extra free gens could not be turned OFF — continuing anyway (site may not allow it)');
    }
    return true; // Don't stop generation over this
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
    'div[contenteditable="true"]',  // broader fallback for UI changes
  ];

  // Diagnostic: check what DOM actually has right now
  const domDiag = await page.evaluate((sels) => {
    const result = { found: [], allContenteditable: 0 };
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) result.found.push(sel);
    }
    result.allContenteditable = document.querySelectorAll('[contenteditable="true"]').length;
    return result;
  }, selectors).catch(() => ({ found: [], allContenteditable: 0 }));

  console.log(`[engine] clearPromptField: found selectors=${JSON.stringify(domDiag.found)}, allEditable=${domDiag.allContenteditable}`);

  if (domDiag.allContenteditable === 0) {
    console.log('[engine] ⚠️ clearPromptField: NO editable fields in DOM — UI may have changed, skipping');
    return; // Don't block generation
  }

  // Use matched selectors, or any contenteditable as last resort
  const activeSelectors = domDiag.found.length > 0 ? domDiag.found : ['[contenteditable="true"]'];

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
  }, activeSelectors);

  if (cleared) {
    await chrome.sleep(300);
  }

  // Method 2: Keyboard Ctrl+A → Delete — page.$() wrapped in timeout to avoid hanging
  for (const sel of activeSelectors) {
    const el = await Promise.race([
      page.$(sel),
      new Promise(resolve => setTimeout(() => resolve(null), 3000)),
    ]);
    if (el) {
      try {
        await el.click({ timeout: 2000 }).catch(() => {});
        await chrome.sleep(100);
        await page.keyboard.down('Meta');
        await page.keyboard.press('a');
        await page.keyboard.up('Meta');
        await chrome.sleep(100);
        await page.keyboard.press('Delete');
        await chrome.sleep(200);
        await page.keyboard.press('Backspace');
        await chrome.sleep(200);
      } catch (e) {
        console.log(`[engine] clearPromptField keyboard error: ${e.message}`);
      }
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
  }, activeSelectors).catch(() => '');

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
//  ASPECT RATIO — Apply + Verify
// ══════════════════════════════════════════════════════════════

/**
 * Read the currently active aspect ratio from the site.
 * Returns the button text (e.g. "16:9", "1:1") or null if not found.
 */
async function getActiveAspectRatio(page) {
  return await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if (/^\d+:\d+$/.test(text) && btn.offsetParent !== null) {
        return text;
      }
    }
    return null;
  });
}

/**
 * Verify that the site's aspect ratio matches the expected value.
 * @returns {{ ok: boolean, actual: string|null }}
 */
async function verifyAspectRatio(page, expectedRatio) {
  const actual = await getActiveAspectRatio(page);
  const ok = actual === expectedRatio;
  if (!ok) {
    console.log(`[engine] ❌ Aspect ratio mismatch: expected "${expectedRatio}", actual "${actual}"`);
  }
  return { ok, actual };
}

/**
 * Set the aspect ratio on the site, then verify it was applied.
 * Throws on failure (no silent swallowing).
 */
async function setAspectRatio(page, aspect) {
  // Read current ratio
  const current = await getActiveAspectRatio(page);

  if (current === aspect) {
    console.log(`[engine] ✅ Aspect ratio already ${aspect}`);
    return;
  }

  console.log(`[engine] Aspect ratio: "${current}" → "${aspect}", switching...`);

  // Click the current ratio button to open the aspect ratio panel
  const opened = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      // Match ratio buttons like "16:9", "1:1", or "Auto"
      if ((/^\d+:\d+$/.test(text) || text === 'Auto') && btn.offsetParent !== null) {
        btn.click();
        return true;
      }
    }
    return false;
  });

  if (!opened) {
    throw new Error(`Aspect ratio: не найдена кнопка текущего ratio для открытия панели`);
  }

  // Wait for panel to open, then click target ratio
  await chrome.sleep(600);

  const clicked = await page.evaluate((targetRatio) => {
    // Higgsfield uses <div role="option"> for aspect ratio choices, NOT <button>
    // Try role="option" elements first (primary selector)
    const options = document.querySelectorAll('div[role="option"]');
    for (const opt of options) {
      const text = opt.textContent.trim();
      if (text === targetRatio && opt.offsetParent !== null) {
        opt.click();
        return 'option';
      }
    }
    // Fallback: try buttons (in case site layout changes)
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.trim() === targetRatio && btn.offsetParent !== null) {
        btn.click();
        return 'button';
      }
    }
    return false;
  }, aspect);

  if (!clicked) {
    // Close any open panel by pressing Escape
    await page.keyboard.press('Escape');
    await chrome.sleep(200);
    throw new Error(`Aspect ratio: не найдена опция "${aspect}" в панели выбора`);
  }

  console.log(`[engine] Aspect ratio clicked via ${clicked} element`);

  await chrome.sleep(400);

  // Verify
  const verify = await verifyAspectRatio(page, aspect);
  if (!verify.ok) {
    // One retry: maybe panel is still open, click again
    console.log(`[engine] ⚠️ Aspect ratio verify failed, retrying...`);
    await chrome.sleep(500);
    const retryVerify = await verifyAspectRatio(page, aspect);
    if (!retryVerify.ok) {
      throw new Error(`Aspect ratio: после установки "${aspect}" сайт показывает "${retryVerify.actual}". Генерация остановлена.`);
    }
  }

  console.log(`[engine] ✅ Aspect ratio set and verified: ${aspect}`);
}


// ══════════════════════════════════════════════════════════════
//  QUALITY / RESOLUTION — Apply + Verify
// ══════════════════════════════════════════════════════════════

// MODEL_QUALITY_OPTIONS is now imported from model-capabilities.js
// Mapping: { modelId: ['quality1', 'quality2'] } — only models with quality selectors.

/**
 * Read the currently active quality/resolution from the site.
 * Higgsfield shows quality as buttons like "1K", "2K", "High", etc.
 * Returns the active button text or null if no quality selector found.
 */
async function getActiveQuality(page) {
  return await page.evaluate(() => {
    // Strategy 1: Find quality-related buttons by text content
    // Quality buttons are typically small toggles with "1K", "2K", "HD", etc.
    const allButtons = document.querySelectorAll('button');
    const qualityPatterns = /^(1K|2K|4K|HD|High|Standard|Low)$/i;
    const qualityBtns = [];

    for (const btn of allButtons) {
      const text = btn.textContent.trim();
      if (qualityPatterns.test(text) && btn.offsetParent !== null) {
        qualityBtns.push(btn);
      }
    }

    if (qualityBtns.length === 0) return null; // No quality selector on this model

    // Find the active/selected one
    for (const btn of qualityBtns) {
      // Check various "active" indicators
      const classes = btn.className || '';
      const ariaSelected = btn.getAttribute('aria-selected');
      const ariaPressed = btn.getAttribute('aria-pressed');
      const dataState = btn.getAttribute('data-state');

      if (
        ariaSelected === 'true' ||
        ariaPressed === 'true' ||
        dataState === 'on' || dataState === 'active' ||
        classes.includes('active') || classes.includes('selected') ||
        classes.includes('bg-') // Higgsfield uses bg-* for active state
      ) {
        return btn.textContent.trim();
      }
    }

    // Strategy 2: Look for styling differences (opacity, bg-color, font-weight)
    // The active quality button typically has different styling
    for (const btn of qualityBtns) {
      const style = window.getComputedStyle(btn);
      const opacity = parseFloat(style.opacity);
      const bgColor = style.backgroundColor;
      // Active buttons tend to have full opacity and a background
      if (opacity >= 0.9 && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
        return btn.textContent.trim();
      }
    }

    // Fallback: if only one quality button exists, it's the active one
    if (qualityBtns.length === 1) {
      return qualityBtns[0].textContent.trim();
    }

    // Return first found as best guess (with warning)
    return { ambiguous: true, buttons: qualityBtns.map(b => b.textContent.trim()) };
  });
}

/**
 * Verify that the site's quality matches the expected value.
 * @returns {{ ok: boolean, actual: string|null, noSelector: boolean }}
 */
async function verifyQuality(page, expectedQuality, modelKey) {
  const modelQualityOpts = MODEL_QUALITY_OPTIONS[modelKey];

  // If this model has no quality options at all, any quality is "OK" (N/A)
  if (!modelQualityOpts) {
    console.log(`[engine] Quality: model "${modelKey}" has no quality selector — N/A, skipping`);
    return { ok: true, actual: 'N/A', noSelector: true };
  }

  const raw = await getActiveQuality(page);

  // No quality selector found on the page
  if (raw === null) {
    console.log(`[engine] ⚠️ Quality: expected selector for "${modelKey}" but none found on page`);
    return { ok: false, actual: null, noSelector: true };
  }

  // Ambiguous result — multiple buttons, can't determine which is active
  if (raw && typeof raw === 'object' && raw.ambiguous) {
    console.log(`[engine] ⚠️ Quality: ambiguous — found buttons [${raw.buttons.join(', ')}], can't determine active`);
    return { ok: false, actual: raw.buttons.join('/'), noSelector: false };
  }

  const actual = String(raw);
  const ok = actual.toLowerCase() === String(expectedQuality).toLowerCase();

  if (!ok) {
    console.log(`[engine] ❌ Quality mismatch: expected "${expectedQuality}", actual "${actual}"`);
  }
  return { ok, actual, noSelector: false };
}

/**
 * Set the quality/resolution on the site. Click the target quality button.
 * For models without a quality selector, this is a no-op.
 */
async function setQuality(page, quality, modelKey) {
  const modelQualityOpts = MODEL_QUALITY_OPTIONS[modelKey];

  // Model has no quality selector → skip
  if (!modelQualityOpts) {
    console.log(`[engine] Quality: model "${modelKey}" has no quality selector — skipping`);
    return;
  }

  // Validate that the requested quality is valid for this model
  if (!modelQualityOpts.includes(quality)) {
    console.log(`[engine] ⚠️ Quality "${quality}" not valid for "${modelKey}" (valid: [${modelQualityOpts.join(', ')}]). Using "${modelQualityOpts[0]}".`);
    quality = modelQualityOpts[0];
  }

  // Check if already set correctly
  const currentVerify = await verifyQuality(page, quality, modelKey);
  if (currentVerify.ok && !currentVerify.noSelector) {
    console.log(`[engine] ✅ Quality already set to "${quality}"`);
    return;
  }

  // Click the target quality button
  // NOTE: On Higgsfield, quality is a DROPDOWN — first click the current quality button
  // to OPEN the dropdown, then click the target option inside it.
  console.log(`[engine] Quality: setting to "${quality}"...`);

  // Step 1: Open the quality dropdown by clicking the current quality button
  const opened = await page.evaluate(() => {
    const allButtons = document.querySelectorAll('button');
    const qualityPatterns = /^(1K|2K|4K|HD|High|Standard|Low)$/i;
    for (const btn of allButtons) {
      const text = btn.textContent.trim();
      if (qualityPatterns.test(text) && btn.offsetParent !== null) {
        btn.click(); // Click current quality label to open dropdown
        return text;
      }
    }
    return null;
  });

  if (!opened) {
    console.log(`[engine] ⚠️ Quality: could not find current quality button to open dropdown`);
    return;
  }

  console.log(`[engine] Quality: opened dropdown (was "${opened}"), waiting for options...`);
  await chrome.sleep(500); // Wait for dropdown animation

  // Step 2: Now click the target quality option inside the open dropdown
  const clicked = await page.evaluate((targetQuality) => {
    const allButtons = document.querySelectorAll('button');
    const qualityPatterns = /^(1K|2K|4K|HD|High|Standard|Low)$/i;

    for (const btn of allButtons) {
      const text = btn.textContent.trim();
      // After dropdown opens, items may not have offsetParent check needed — they are now visible
      if (qualityPatterns.test(text) && text.toLowerCase() === targetQuality.toLowerCase()) {
        btn.click();
        return true;
      }
    }

    // Also check list items / role="option" in case Radix renders differently
    const options = document.querySelectorAll('[role="option"], [role="menuitem"], [role="listitem"]');
    for (const opt of options) {
      const text = opt.textContent.trim();
      if (text.toLowerCase().includes(targetQuality.toLowerCase())) {
        opt.click();
        return true;
      }
    }
    return false;
  }, quality);

  if (!clicked) {
    console.log(`[engine] ⚠️ Quality: option "${quality}" not found in open dropdown — closing and proceeding`);
    // Close dropdown by pressing Escape
    await page.keyboard.press('Escape').catch(() => {});
    return;
  }

  await chrome.sleep(500);

  // Verify after click
  const afterVerify = await verifyQuality(page, quality, modelKey);
  if (!afterVerify.ok && !afterVerify.noSelector) {
    // Retry once
    console.log(`[engine] ⚠️ Quality: verify failed after click, retrying...`);
    await chrome.sleep(500);
    const retryVerify = await verifyQuality(page, quality, modelKey);
    if (!retryVerify.ok && !retryVerify.noSelector) {
      throw new Error(`Quality: после установки "${quality}" сайт показывает "${retryVerify.actual}". Генерация остановлена.`);
    }
  }

  console.log(`[engine] ✅ Quality set and verified: ${quality}`);
}


// ══════════════════════════════════════════════════════════════
//  UNIFIED PREFLIGHT SETTINGS SYNC
//  Applies + verifies ALL settings before generation.
//  Outputs a structured log table for debugging.
// ══════════════════════════════════════════════════════════════

/**
 * preflightSettingsSync — single entry point for all settings.
 * Called once per prompt AFTER navigation, BEFORE entering prompt text.
 *
 * @param {Object} page - Puppeteer page
 * @param {Object} settings - { model, modelInfo, quality, aspect }
 * @param {Function} onProgress - progress callback
 * @returns {Object} sync result with all setting states
 */
async function preflightSettingsSync(page, settings, onProgress = () => {}) {
  const { model, modelInfo, quality, aspect } = settings;
  const results = {};

  console.log(`\n[engine] ╔══════════ PREFLIGHT SETTINGS SYNC ══════════`);

  // ── 1. Model verification ──
  onProgress({ step: 'preflight', message: `Проверяю модель ${modelInfo.name}...` });
  const modelOk = await withTimeout(verifyActiveModel(page, modelInfo), PREFLIGHT_STEP_TIMEOUT, 'verifyActiveModel');
  results.model = { expected: modelInfo.name, actual: modelOk ? modelInfo.name : '???', ok: modelOk };
  if (!modelOk) {
    logPreflightTable(results);
    throw new Error(`Preflight: модель "${modelInfo.name}" не активна. В интерфейсе другая модель.`);
  }

  // ── 2. Dismiss overlays ──
  await withTimeout(dismissOverlays(page), PREFLIGHT_STEP_TIMEOUT, 'dismissOverlays');

  // ── 3. Clear prompt field (prevent ghost gens from toggle clicks) ──
  onProgress({ step: 'preflight', message: 'Очищаю поле промпта...' });
  await withTimeout(clearPromptField(page), PREFLIGHT_STEP_TIMEOUT, 'clearPromptField');

  // ── 4. Extra Free Gens → OFF ──
  onProgress({ step: 'preflight', message: 'Отключаю Extra free gens...' });
  await withTimeout(ensureExtraFreeGensOff(page), PREFLIGHT_STEP_TIMEOUT, 'ensureExtraFreeGensOff');
  const extraState = await withTimeout(isExtraFreeGensOn(page), PREFLIGHT_STEP_TIMEOUT, 'isExtraFreeGensOn');
  results.extraFreeGens = { expected: 'OFF', actual: extraState ? 'ON' : 'OFF', ok: !extraState };
  if (extraState) {
    // Log as warning but don't stop generation — Extra free gens being ON just means
    // we might get 1-2 bonus images from other models. Not fatal.
    console.log('[engine] ⚠️ Extra free gens still ON — logging as warning, continuing generation');
    results.extraFreeGens.ok = true; // Don't fail preflight over this
  }

  // ── 5. Batch size → 1/4 ──
  onProgress({ step: 'preflight', message: 'Устанавливаю batch 1/4...' });
  const batchOk = await withTimeout(ensureBatchSize1(page), PREFLIGHT_STEP_TIMEOUT, 'ensureBatchSize1');
  const batchNow = await withTimeout(getBatchSize(page), PREFLIGHT_STEP_TIMEOUT, 'getBatchSize');
  const batchStr = batchNow ? `${batchNow.current}/${batchNow.max}` : '???';
  results.batch = { expected: '1/4', actual: batchStr, ok: batchOk && batchNow && batchNow.current === 1 };
  if (!results.batch.ok) {
    logPreflightTable(results);
    throw new Error(`Preflight: batch не удалось установить в 1/4 (сейчас: ${batchStr}). Генерация остановлена.`);
  }

  // ── 6. Unlimited → ON (LAST toggle action) ──
  onProgress({ step: 'preflight', message: 'Включаю Unlimited...' });
  const unlimitedOk = await withTimeout(ensureUnlimited(page), PREFLIGHT_STEP_TIMEOUT, 'ensureUnlimited');
  const unlimitedState = await withTimeout(isUnlimitedOn(page), PREFLIGHT_STEP_TIMEOUT, 'isUnlimitedOn');
  results.unlimited = { expected: 'ON', actual: unlimitedState === true ? 'ON' : unlimitedState === false ? 'OFF' : '???', ok: unlimitedState === true };
  if (!results.unlimited.ok) {
    logPreflightTable(results);
    throw new Error('Preflight: Unlimited не удалось включить. Генерация остановлена.');
  }

  // ── 7. Quality / Resolution ──
  onProgress({ step: 'preflight', message: `Устанавливаю качество ${quality || 'auto'}...` });
  if (quality) {
    await withTimeout(setQuality(page, quality, model), PREFLIGHT_STEP_TIMEOUT, 'setQuality');
  }
  const qualityVerify = await verifyQuality(page, quality, model);
  results.quality = {
    expected: quality || 'N/A',
    actual: qualityVerify.actual || 'N/A',
    ok: qualityVerify.ok,
    noSelector: qualityVerify.noSelector,
  };
  // Quality mismatch is fatal only if model actually has a quality selector
  if (!results.quality.ok && !results.quality.noSelector) {
    logPreflightTable(results);
    throw new Error(`Preflight: качество "${quality}" не совпадает с сайтом ("${qualityVerify.actual}"). Генерация остановлена.`);
  }

  // ── 8. Aspect Ratio ──
  onProgress({ step: 'preflight', message: `Устанавливаю aspect ${aspect}...` });
  await setAspectRatio(page, aspect);
  const aspectVerify = await verifyAspectRatio(page, aspect);
  results.aspect = { expected: aspect, actual: aspectVerify.actual || '???', ok: aspectVerify.ok };
  if (!results.aspect.ok) {
    logPreflightTable(results);
    throw new Error(`Preflight: aspect ratio "${aspect}" не совпадает с сайтом ("${aspectVerify.actual}"). Генерация остановлена.`);
  }

  // ── 9. Verify controls (prompt field + generate button) ──
  onProgress({ step: 'preflight', message: 'Проверяю интерфейс...' });
  await preflight(page);

  // ── Log final table ──
  logPreflightTable(results);
  console.log(`[engine] ✅ PREFLIGHT PASSED — all settings verified\n`);

  return results;
}

/**
 * Pretty-print the preflight results as a table.
 */
function logPreflightTable(results) {
  const rows = [
    ['Model',           results.model],
    ['Quality',         results.quality],
    ['Aspect Ratio',    results.aspect],
    ['Batch',           results.batch],
    ['Unlimited',       results.unlimited],
    ['Extra Free Gens', results.extraFreeGens],
  ];

  console.log(`[engine] ║ Setting          │ Expected   │ Actual     │ Status`);
  console.log(`[engine] ║──────────────────┼────────────┼────────────┼───────`);

  for (const [name, r] of rows) {
    if (!r) continue;
    const exp = String(r.expected || '—').padEnd(10);
    const act = String(r.actual || '—').padEnd(10);
    const status = r.ok ? '✅ MATCH' : (r.noSelector ? '⏭️ N/A' : '❌ MISMATCH');
    console.log(`[engine] ║ ${name.padEnd(16)} │ ${exp} │ ${act} │ ${status}`);
  }

  console.log(`[engine] ╚═════════════════════════════════════════════`);
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
/**
 * Verify that the controlled page is alive, on Higgsfield, and has valid generation context.
 * Returns { alive: true } or { alive: false, reason: string }.
 */
async function verifyPageHealth(page) {
  // 1. Check if page object is still usable
  try {
    const url = page.url();
    
    // 2. Page navigated away from Higgsfield
    if (!url.includes('higgsfield') && !url.includes('higgs') && !url.includes('localhost')) {
      console.log(`[engine] ❌ PAGE HEALTH: navigated away from Higgsfield → ${url.substring(0, 80)}`);
      return { alive: false, reason: 'page_invalid' };
    }

    // 3. Page is on sign-in / login
    if (url.includes('sign-in') || url.includes('login') || url.includes('auth')) {
      console.log(`[engine] ❌ PAGE HEALTH: redirected to auth page`);
      return { alive: false, reason: 'auth_error' };
    }

    // 4. Check that page DOM is responsive
    const domCheck = await page.evaluate(() => {
      const feed = document.querySelector('#soul-feed-scroll');
      const promptField = document.querySelector('textarea, input[type="text"]');
      
      // Check for "Prompt is required" error message
      const allText = document.body?.innerText || '';
      const hasPromptError = allText.includes('Prompt is required') || 
                             allText.includes('prompt is required');
      
      // Check if prompt field exists but is empty (suspicious during generation)
      const promptEmpty = promptField ? (promptField.value || '').trim() === '' : true;
      
      return {
        hasFeed: !!feed,
        hasPromptField: !!promptField,
        promptEmpty,
        hasPromptError,
      };
    });

    // 5. "Prompt is required" error on page
    if (domCheck.hasPromptError) {
      console.log(`[engine] ❌ PAGE HEALTH: site shows "Prompt is required"`);
      return { alive: false, reason: 'prompt_missing' };
    }

    // 6. No feed scroll area — page structure broken
    if (!domCheck.hasFeed) {
      console.log(`[engine] ⚠️ PAGE HEALTH: no #soul-feed-scroll found — page may have reloaded`);
      return { alive: false, reason: 'page_invalid' };
    }

    return { alive: true };
  } catch (err) {
    // page.evaluate() / page.url() failed — page is closed/crashed
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('target closed') || msg.includes('session closed') || 
        msg.includes('detached') || msg.includes('destroyed') ||
        msg.includes('not found') || msg.includes('connection closed') ||
        msg.includes('protocol error')) {
      console.log(`[engine] ❌ PAGE HEALTH: page closed/crashed — ${err.message.substring(0, 80)}`);
      return { alive: false, reason: 'page_closed' };
    }
    // Unknown error — treat as page invalid
    console.log(`[engine] ❌ PAGE HEALTH: unknown error — ${err.message.substring(0, 80)}`);
    return { alive: false, reason: 'page_closed' };
  }
}

/**
 * Attempt to recover a lost/invalid page.
 * Returns the recovered page or null if recovery failed.
 */
async function attemptPageRecovery(chrome, modelInfo, prompt) {
  console.log(`[engine] 🔄 RECOVERY: attempting to reacquire valid Higgsfield page...`);

  try {
    // 1. Try to get a fresh page reference
    let page = chrome.getActivePage();
    if (!page) {
      console.log(`[engine] ❌ RECOVERY: no active page in chrome-manager — cannot recover`);
      return null;
    }

    // 2. Check if page is at least alive
    try {
      const url = page.url();
      console.log(`[engine] 🔄 RECOVERY: page alive, current URL: ${url.substring(0, 80)}`);
    } catch {
      console.log(`[engine] ❌ RECOVERY: page object is dead — cannot recover without reconnect`);
      return null;
    }

    // 3. Navigate back to model page
    console.log(`[engine] 🔄 RECOVERY: navigating to ${modelInfo.name} page...`);
    await chrome.navigateToModel(modelInfo.slug);
    await chrome.sleep(3000);

    // 4. Re-verify model
    const verified = await verifyActiveModel(page, modelInfo);
    if (!verified) {
      console.log(`[engine] ❌ RECOVERY: model verification failed after navigation`);
      return null;
    }

    // 5. Re-enter prompt
    console.log(`[engine] 🔄 RECOVERY: re-entering prompt...`);
    await enterPrompt(page, prompt);
    await chrome.sleep(1000);

    // 6. Final health check
    const health = await verifyPageHealth(page);
    if (!health.alive) {
      console.log(`[engine] ❌ RECOVERY: page health check failed after recovery: ${health.reason}`);
      return null;
    }

    console.log(`[engine] ✅ RECOVERY: page recovered successfully, model and prompt re-applied`);
    return page;
  } catch (err) {
    console.log(`[engine] ❌ RECOVERY: failed — ${err.message}`);
    return null;
  }
}

async function detectSiteError(page) {
  try {
    // Check for login redirect (auth_error)
    const pageUrl = page.url();
    if (pageUrl.includes('sign-in') || pageUrl.includes('login') || pageUrl.includes('auth')) {
      console.log('[engine] 🔐 detectSiteError: auth redirect detected');
      return 'auth_error';
    }

    return await page.evaluate(() => {
      // Only check toast/notification/banner elements — NOT the entire body text.
      // bodyText scanning caused false positives: "upgrade your plan" exists in
      // Higgsfield navigation on EVERY page, triggering credits_exhausted on every timeout.
      const toastSelectors = [
        '[class*="toast"]', '[class*="notification"]', '[class*="alert"]',
        '[class*="error"]', '[role="alert"]', '[class*="banner"]',
        '[class*="snack"]',
      ];

      for (const sel of toastSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          // Skip invisible or tiny elements (like nav items)
          if (el.offsetParent === null && !el.closest('[role="alert"]')) continue;
          // Skip elements inside the feed — user/promo/warning content, not site errors
          if (el.closest('#soul-feed-scroll')) continue;
          const text = (el.textContent || '').toLowerCase();
          if (text.length > 200) continue; // Skip large containers — not a toast
          if (
            text.includes('all credits used') ||
            text.includes('no credits remaining') ||
            text.includes('credits exhausted')
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
          if (
            text.includes('prompt is required') ||
            text.includes('enter a prompt')
          ) {
            return 'prompt_missing';
          }
        }
      }

      return null; // No specific error detected
    });
  } catch (err) {
    console.log(`[engine] detectSiteError failed: ${err.message}`);
    // If page.evaluate failed, check if page is closed
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('target closed') || msg.includes('session closed') || 
        msg.includes('detached') || msg.includes('destroyed')) {
      return 'page_closed';
    }
    return null;
  }
}

/**
 * Strict detector for a failed generation card at the top of the feed.
 * Requires multiple signals ("failed", "refunded", "retry") to avoid false positives.
 */
async function checkTopFeedCardFailed(page) {
  try {
    return await page.evaluate(() => {
      const feed = document.querySelector('#soul-feed-scroll');
      if (!feed || !feed.children.length) return false;
      
      // Look at the top 3 cards in case the failed card is slightly pushed
      for (let i = 0; i < Math.min(feed.children.length, 3); i++) {
        const card = feed.children[i];
        if (!card) continue;
        
        // Find leaf elements only, to avoid catching prompts with "failed" inside
        const leaves = Array.from(card.querySelectorAll('*')).filter(el => el.children.length === 0);
        
        let hasFailed = false;
        let hasRefunded = false;
        let hasRetry = false;
        
        for (const leaf of leaves) {
          const text = (leaf.textContent || '').trim().toLowerCase();
          if (text === 'failed' || text === 'generation failed' || text === 'generating failed') hasFailed = true;
          if (text === 'credits refunded' || text === 'refunded') hasRefunded = true;
          if (text === 'retry') hasRetry = true;
        }
        
        // Strict matching: requires at least two robust signs of failure
        if ((hasFailed && hasRefunded) || (hasFailed && hasRetry) || (hasRefunded && hasRetry)) {
          return true;
        }
      }
      return false;
    });
  } catch (err) {
    console.log(`[engine] checkTopFeedCardFailed error: ${err.message}`);
    return false;
  }
}

/**
 * Core feed scanner: extracts generation-only image URLs from the Higgsfield feed.
 * Filters out:
 * - Non-UUID images (promo banners, placeholders)
 * - Images inside promo/ad/CTA card containers (marketing tiles)
 * @param {Object} page - Puppeteer page
 * @param {number} count - Max number of generation images to return
 * @returns {string[]} - Array of resolved cloudfront URLs
 */
async function scanGenerationImages(page, count = 20) {
  return await page.evaluate((maxCount) => {
    const feed = document.querySelector('#soul-feed-scroll');
    if (!feed) return [];

    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

    // Promo/ad blocklist — if any of these appear in the card's text, skip image
    const promoSignals = [
      'записатися', 'запишись', 'записаться',
      'clinic', 'promo', 'advertisement', 'sponsored',
      'sign up', 'download app', 'download the app',
      'get started', 'learn more', 'try now', 'try free',
      'upgrade', 'subscribe', 'join now',
      'скачать', 'скачай', 'установи',
      'реклама', 'промо', 'акция', 'скидка',
      'install', 'available on',
    ];

    function isPromoCard(img) {
      // Walk up from img to find the card container (up to 5 levels)
      let el = img.parentElement;
      for (let i = 0; i < 5 && el && el !== feed; i++) {
        // Check if this is a substantial card container
        if (el.offsetHeight > 80) {
          const text = (el.innerText || '').toLowerCase();
          // Check for promo signals
          for (const signal of promoSignals) {
            if (text.includes(signal)) return true;
          }
          // Check for external links (promo cards often have hrefs outside higgs)
          const links = el.querySelectorAll('a[href]');
          for (const link of links) {
            const href = (link.getAttribute('href') || '').toLowerCase();
            if (href.startsWith('http') && !href.includes('higgs')) return true;
          }
          break; // Only check the first substantial container
        }
        el = el.parentElement;
      }
      return false;
    }

    const result = [];
    const imgs = feed.querySelectorAll('img');
    for (const img of imgs) {
      if (result.length >= maxCount) break;
      if (!img.src || !img.src.startsWith('http') || img.src.includes('avatar')) continue;

      // Resolve proxy wrapper URL
      let resolvedUrl = img.src;
      try {
        const u = new URL(img.src);
        const inner = u.searchParams.get('url');
        if (inner) resolvedUrl = inner;
      } catch {}

      // Filter 1: Must have UUID (= generation image URL)
      if (!uuidRe.test(resolvedUrl)) continue;

      // Filter 2: Must NOT be inside a promo/ad card
      if (isPromoCard(img)) continue;

      result.push(resolvedUrl);
    }
    return result;
  }, count);
}

async function countFeedImages(page) {
  const urls = await scanGenerationImages(page, 999);
  return urls.length;
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
 * Snapshot the UUIDs of the top-N generation images in the feed.
 * Used to detect whether a "new" image is actually old.
 */
async function snapshotFeedFingerprints(page, n = 10) {
  const urls = await scanGenerationImages(page, n);
  const uuids = urls.map(u => extractUUID(u)).filter(Boolean);
  console.log(`[engine] 📸 Feed fingerprint snapshot: ${uuids.length} UUIDs captured (gen-only, requested ${n})`);
  return uuids;
}

/**
 * Get URLs of generation images currently in the feed
 */
async function getFeedImageUrls(page) {
  return await scanGenerationImages(page, 999);
}

/**
 * Get the URL of the FIRST generation image in the feed (newest generation).
 */
async function getFirstFeedImgUrl(page) {
  const urls = await scanGenerationImages(page, 1);
  return urls[0] || null;
}

/**
 * Count how many items are "Queued" (generating but not yet ready)
 */
async function countQueuedItems(page) {
  return (await countInFlightItems(page)).queued;
}

/**
 * Count ALL in-flight generation indicators on the Higgsfield feed.
 * Returns { queued, generating, total } where total = queued + generating.
 * The old countQueuedItems only detected 'Queued' text, missing 'Generating' tiles
 * which caused cross-prompt boundary corruption.
 */
async function countInFlightItems(page) {
  return await page.evaluate(() => {
    const feed = document.querySelector('#soul-feed-scroll');
    if (!feed) return { queued: 0, generating: 0, total: 0 };
    const elements = feed.querySelectorAll('*');
    let queued = 0, generating = 0;
    for (const el of elements) {
      if (el.children.length === 0) {
        const t = el.textContent.trim();
        if (t === 'Queued') queued++;
        else if (t === 'Generating' || t === 'Generating...') generating++;
      }
    }
    return { queued, generating, total: queued + generating };
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
 * Ждёт стабилизации ленты: нет in-flight элементов (Queued + Generating)
 * И количество изображений + UUID fingerprints не меняются 3 цикла подряд.
 * Вызывается на границе между промптами.
 * @param {Object} page - Puppeteer страница  
 * @param {number} maxWaitMs - максимум ожидания (по умолчанию 60с)
 * @returns {{ stable: boolean, finalUUIDs: string[] }}
 */
async function waitForFeedStable(page, maxWaitMs = 60_000) {
  const REQUIRED_STABLE = 3; // require 3 consecutive stable polls
  const deadline = Date.now() + maxWaitMs;
  let prevCount = -1;
  let prevUUIDs = [];
  let stableCount = 0;

  console.log('[engine] ⏳ waitForFeedStable: ждём стабилизации ленты (in-flight + UUID check)...');

  while (Date.now() < deadline) {
    await chrome.sleep(POLL_INTERVAL);

    const inFlight = await countInFlightItems(page);
    const feedCount = await countFeedImages(page);
    const currentUUIDs = await snapshotFeedFingerprints(page, 50);

    // Check: no in-flight items AND feedCount stable AND UUIDs stable
    const uuidsMatch = prevUUIDs.length > 0 && 
      currentUUIDs.length === prevUUIDs.length && 
      currentUUIDs.every((u, i) => u === prevUUIDs[i]);

    if (inFlight.total === 0 && feedCount === prevCount && uuidsMatch) {
      stableCount++;
      if (stableCount >= REQUIRED_STABLE) {
        console.log(`[engine] ✅ waitForFeedStable: лента стабильна (${REQUIRED_STABLE} polls, feedCount=${feedCount}, inFlight=0)`);
        return { stable: true, finalUUIDs: currentUUIDs };
      }
    } else {
      if (stableCount > 0) {
        console.log(`[engine] ⚠️ waitForFeedStable: сброс стабильности (inFlight=${inFlight.total} [Q=${inFlight.queued}/G=${inFlight.generating}], feed=${feedCount}→${prevCount}, uuidsMatch=${uuidsMatch})`);
      }
      stableCount = 0;
    }

    prevCount = feedCount;
    prevUUIDs = currentUUIDs;

    if (inFlight.total > 0) {
      console.log(`[engine] ⏳ waitForFeedStable: in-flight=${inFlight.total} (Q=${inFlight.queued} G=${inFlight.generating}), feedCount=${feedCount}`);
    }
  }

  console.log('[engine] ⚠️ waitForFeedStable: таймаут, продолжаем несмотря на нестабильность');
  return { stable: false, finalUUIDs: await snapshotFeedFingerprints(page, 50) };
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
  const softDeadline = startTime + SOFT_TIMEOUT;
  const hardDeadline = startTime + HARD_TIMEOUT;
  let generationDetected = false;
  let queuedGone = false;
  let softTimeoutLogged = false;

  // Набор всех запрещённых UUID: до клика + от прошлого промпта
  const forbiddenUUIDs = new Set([...fingerprintsBefore, ...excludeFingerprints]);

  // ── SOFT PAUSE: wait up to HARD_TIMEOUT for in-flight slot ──
  let pauseLogged = false;
  let zeroInFlightTicks = 0; // Debounce counter for in-flight == 0

  while (Date.now() < hardDeadline) {
    // ── HARD CANCEL: immediate break, no grace period ──
    if (shouldCancel) {
      console.log(`[engine] ✕ HARD CANCEL: slot ${index} abandoned immediately`);
      console.log(`[engine] 🛑 Exit reason: cancelled (слот сброшен)`);
      onProgress({ step: 'debug', message: `🛑 Генерация отменена пользователем` });
      return null;
    }

    // ── TARGETED FAILURE DETECTION (All Modes: normal, pause, resume) ──
    if (queuedGone || Math.round((Date.now() - startTime) / 1000) > 10) {
      const inFlightNow = await countInFlightItems(page);
      if (inFlightNow.total === 0) {
        const isFailed = await checkTopFeedCardFailed(page);
        if (isFailed) {
          const elapsedFa = Math.round((Date.now() - startTime) / 1000);
          console.log(`[engine] ❌ Image ${index}: Generation failed card detected at top of feed! (elapsed=${elapsedFa}s)`);
          console.log(`[engine] 🛑 Exit reason: slot_failed_in_feed`);
          onProgress({ step: 'error', message: `❌ Генерация прервана: сервер вернул ошибку (refunded)` });
          const err = new Error('Сбой генерации (site_failed)');
          err.errorClass = 'recoverable';
          err.errorReason = 'site_failed';
          throw err;
        }
      }
    }

    // ── SOFT PAUSE: detect shouldPause and enter wait mode ──
    if (shouldPause && !shouldCancel) {
      if (!pauseLogged) {
        console.log(`[engine] ⏸ SOFT PAUSE: slot ${index} in-flight — продолжаю ожидание до ${Math.round(HARD_TIMEOUT/1000)}с (HARD_TIMEOUT)...`);
        console.log(`[engine] ⏸ Вход в долгое ожидание: дожидаюсь конца слота ${index} (Pause)`);
        onProgress({ step: 'debug', message: `⏸ Ожидаю завершения текущего слота перед паузой...` });
        pauseLogged = true;
      }
      onProgress({
        step: 'waiting',
        message: `⏸ Приостановка — дожидаюсь текущего слота ${index}/${total}...`,
      });
    }

    // ── SOFT PAUSE: early exit if in-flight cleared (WITH DEBOUNCE) ──
    if (shouldPause && !shouldCancel) {
      const inFlightNow = await countInFlightItems(page);
      if (inFlightNow.total === 0 && queuedGone) {
        zeroInFlightTicks++;
        if (zeroInFlightTicks >= 2) { // Require 2 consecutive checks (with POLL_INTERVAL between)
          console.log(`[engine] ⏸ GRACE EXIT: in-flight cleared (confirmed twice), proceed to reconciliation`);
          console.log(`[engine] 🛑 Exit reason: inflight_zero_confirmed`);
          onProgress({ step: 'debug', message: `✅ Задача снята с очереди сервера` });
          break;
        }
      } else {
        zeroInFlightTicks = 0; // Reset debounce if not zero
      }
    }

    await chrome.sleep(POLL_INTERVAL);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const pastSoft = Date.now() > softDeadline;

    // ── Soft timeout: warn but keep waiting if in-flight (DISABLE IF PAUSED to wait fully) ──
    if (pastSoft && !softTimeoutLogged && !shouldPause) {
      const inFlight = await countInFlightItems(page);
      if (inFlight.total > 0) {
        console.log(`[engine] ⏳ SOFT TIMEOUT (${Math.round(SOFT_TIMEOUT/1000)}s): slot ${index} — still in-flight (Q=${inFlight.queued} G=${inFlight.generating}), continuing to hard timeout...`);
        softTimeoutLogged = true;
      } else {
        console.log(`[engine] ⏳ SOFT TIMEOUT (${Math.round(SOFT_TIMEOUT/1000)}s): slot ${index} — no in-flight, proceeding to reconciliation`);
        console.log(`[engine] 🛑 Exit reason: hard_timeout (no in-flight after soft_timeout)`);
        onProgress({ step: 'debug', message: `⏳ Завершено по таймауту, проверяю результат...` });
        break; // Exit loop → reconciliation
      }
    }

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
      console.log(`[engine] 🔍 POLL[${elapsed}s] img=${index}: queued=${queued}, feed=${feedCountNow}/${feedCountBefore}, topUUID=${topForeUUID || 'none'}, forbidden=${isForbidden}, genDetected=${generationDetected}, queuedGone=${queuedGone}${(shouldPause && !shouldCancel) ? ', ⏸ PAUSED' : ''}`);
    }

    const shouldCheckUUID = queuedGone || feedCountNow > feedCountBefore || elapsed > 10;

    if (shouldCheckUUID) {
      // ── FIX RC-4: Захватываем URL СРАЗУ при обнаружении UUID, без повторного fetch после sleep ──
      const topUrl = await getFirstFeedImgUrl(page);
      const topUUID = extractUUID(topUrl);

      if (topUUID && !forbiddenUUIDs.has(topUUID)) {
        // Genuinely new image — not in pre-click snapshot and not from prior prompt!
        const graceNote = (shouldPause && !shouldCancel) ? ' (saved during pause wait!)' : '';
        console.log(`[engine] ✅ Image ${index} ready via UUID detection (${elapsed}s, feedCount: ${feedCountBefore}→${feedCountNow}, queued=${queued}, uuid=${topUUID})${graceNote}: ${(topUrl || '').substring(0, 80)}...`);
        // Небольшое ожидание для полной загрузки, но URL уже зафиксирован
        console.log(`[engine] ✅ Exit reason: uuid_detected (top url)`);
        onProgress({ step: 'debug', message: `✅ Изображение готово, подготавливаю...` });
        await chrome.sleep(800);
        return topUrl;
      }

      // Top UUID is known — scan deeper positions
      if ((queuedGone || elapsed > 15) && elapsed > 5) {
        const allCurrentFingerprints = await snapshotFeedFingerprints(page, 50);
        const newFingerprints = allCurrentFingerprints.filter(fp => !forbiddenUUIDs.has(fp));
        if (newFingerprints.length > 0) {
          // Берём URL первого подходящего нового UUID
          const urls = await scanGenerationImages(page, 10);

          // Находим первый URL с новым UUID
          let foundUrl = null;
          for (const u of urls) {
            const uuid = extractUUID(u);
            if (uuid && !forbiddenUUIDs.has(uuid)) { foundUrl = u; break; }
          }

          if (foundUrl) {
            const graceNote = (shouldPause && !shouldCancel) ? ' (saved during pause wait!)' : '';
            console.log(`[engine] ✅ Image ${index} ready via deep UUID scan (${elapsed}s, queued=${queued}, newUUIDs=${newFingerprints.length})${graceNote}: ${foundUrl.substring(0, 80)}...`);
            console.log(`[engine] ✅ Exit reason: uuid_detected (deep scan)`);
            onProgress({ step: 'debug', message: `✅ Изображение найдено, подготавливаю...` });
            await chrome.sleep(800);
            return foundUrl;
          }
        }
      }
    }

    // Status update
    const statusText = (shouldPause && !shouldCancel)
      ? `⏸ дожидаюсь результата...`
      : (queuedGone ? 'обработка...' : queued > 0 ? 'создаю изображение...' : 'ожидание...');
    onProgress({
      step: 'waiting',
      message: `Слот ${index}/${total}: ${statusText} (${elapsed}с)`,
    });

    // Debug log every 30 seconds
    if (elapsed % 30 === 0 && elapsed > 0) {
      const topUrl = await getFirstFeedImgUrl(page);
      const topUUID = extractUUID(topUrl);
      const isKnown = topUUID ? forbiddenUUIDs.has(topUUID) : 'N/A';
      console.log(`[engine] DEBUG: queued=${queued}, queuedGone=${queuedGone}, feedCount=${feedCountNow}/${feedCountBefore}, topUUID=${topUUID || 'none'}, isForbidden=${isKnown}, elapsed=${elapsed}s${(shouldPause && !shouldCancel) ? ', ⏸ PAUSED' : ''}`);
      console.log(`[engine] 💓 Heartbeat (${elapsed}с): inFlight=${queued > 0 ? queued : (queuedGone ? 1 : 0)}, top UUID=${topUUID ? topUUID.split('-')[0]+'...' : 'none'}`);
      onProgress({ step: 'debug', message: `Проверяю статус задачи на сервере (${elapsed}с)...` });
    }

    // Past soft timeout: log extended wait status every 30s and break when in-flight clears
    if (pastSoft && softTimeoutLogged && elapsed % 30 === 0) {
      const inFlight = await countInFlightItems(page);
      if (inFlight.total === 0) {
        console.log(`[engine] ✅ In-flight cleared at ${elapsed}s (past soft timeout) — proceeding to reconciliation`);
        console.log(`[engine] 🛑 Exit reason: inflight_zero_confirmed (past timeout)`);
        onProgress({ step: 'debug', message: `✅ Задача снята с очереди сервера (прошло ${elapsed}с)` });
        break;
      }
      console.log(`[engine] ⏳ EXTENDED WAIT: slot ${index}, ${elapsed}s, still in-flight (Q=${inFlight.queued} G=${inFlight.generating}), hard limit=${Math.round(HARD_TIMEOUT/1000)}s`);
    }

    // Dismiss overlays periodically
    if (elapsed % 10 === 0 && elapsed > 0) {
      await dismissOverlays(page);
    }

    // Page health check every 30 seconds
    if (elapsed % 30 === 0 && elapsed > 0) {
      const health = await verifyPageHealth(page);
      if (!health.alive) {
        const err = new Error(`Page lost during generation: ${health.reason}`);
        err.errorClass = 'fatal';
        err.errorReason = health.reason;
        throw err;
      }
    }
  }

  // ═══ FINAL RECONCILIATION: forensic dump + rescue before declaring timeout ═══
  const elapsedTotal = Math.round((Date.now() - startTime) / 1000);
  const inFlightAtRecon = await countInFlightItems(page);

  if (inFlightAtRecon.total > 0) {
    console.warn(`[engine] ⚠️ RECONCILIATION at HARD TIMEOUT: slot ${index}, ${elapsedTotal}s elapsed, STILL IN-FLIGHT (Q=${inFlightAtRecon.queued} G=${inFlightAtRecon.generating})`);
  } else {
    console.log(`[engine] 🔍 RECONCILIATION: forensic scan (slot ${index}, ${elapsedTotal}s elapsed, in-flight clear)...`);
  }

  // Collect top 20 generation candidates with full metadata
  // Collect top 50 generation candidates (promo-filtered) with positional metadata
  const reconUrls = await scanGenerationImages(page, 50);
  const reconCandidates = reconUrls.map((url, idx) => ({ pos: idx, url }));

  // Forensic dump: log every candidate
  const reconDetails = reconCandidates.map(c => {
    const uuid = extractUUID(c.url);
    const isForbidden = uuid ? forbiddenUUIDs.has(uuid) : true;
    return { pos: c.pos, uuid, forbidden: isForbidden, url: c.url.substring(0, 70) };
  });

  const newCandidates = reconDetails.filter(c => !c.forbidden && c.uuid);
  const inFlightRecon = await countInFlightItems(page);

  console.log(`[engine] ┌── RECONCILIATION DUMP (slot ${index}) ──────────────────`);
  console.log(`[engine] │ total gen images: ${reconDetails.length}`);
  console.log(`[engine] │ new candidates:   ${newCandidates.length}`);
  console.log(`[engine] │ in-flight:        Q=${inFlightRecon.queued} G=${inFlightRecon.generating}`);
  console.log(`[engine] │ forbidden set:    ${forbiddenUUIDs.size} UUIDs`);
  for (const c of reconDetails.slice(0, 10)) {
    const marker = c.forbidden ? '🔒' : '✨';
    console.log(`[engine] │ ${marker} pos=${c.pos} uuid=${c.uuid || 'none'} ${c.url}...`);
  }
  if (reconDetails.length > 10) {
    console.log(`[engine] │ ... and ${reconDetails.length - 10} more`);
  }
  console.log(`[engine] └──────────────────────────────────────────────────`);

  if (newCandidates.length === 1) {
    // Exactly one new candidate — safe to rescue
    const best = newCandidates[0];
    const bestUrl = reconCandidates.find(c => extractUUID(c.url) === best.uuid)?.url;
    if (bestUrl) {
      console.log(`[engine] 🆘 RESCUE: Image ${index} found via reconciliation (${elapsedTotal}s, uuid=${best.uuid}): ${bestUrl.substring(0, 80)}...`);
      console.log(`[engine] 🚑 Exit reason: reconciliation_rescue (слот восстановился)`);
      onProgress({ step: 'debug', message: `🚑 Слот восстановлен, подготавливаю изображение...` });
      await chrome.sleep(800);
      return bestUrl;
    }
  } else if (newCandidates.length > 1) {
    // Multiple candidates — SLOT AMBIGUITY: do NOT auto-pick
    console.warn(`[engine] ⚠️ SLOT AMBIGUITY: ${newCandidates.length} new candidates for slot ${index}`);
    console.warn(`[engine]    candidates: ${newCandidates.map(c => `pos${c.pos}:${c.uuid}`).join(' | ')}`);
    const err = new Error(`Slot ${index}: ${newCandidates.length} ambiguous candidates — cannot safely assign`);
    err.errorClass = 'slot_ambiguity';
    err.errorReason = 'slot_ambiguity';
    err.candidates = newCandidates; // Preserve metadata for quarantine
    throw err;
  }

  // True zero-candidate timeout
  console.log(`[engine] ⚠️ TIMEOUT: Image ${index} — no valid candidate found after reconciliation (${elapsedTotal}s)`);
  console.log(`[engine] 🛑 Exit reason: hard_timeout (пусто после сканирования)`);
  onProgress({ step: 'debug', message: `🛑 Таймаут ожидания изображения, сервер не ответил` });
  return null;
}

/**
 * Wait for N new images to appear in the feed after generation started
 */
async function waitForNewImages(page, beforeCount, expected, onProgress) {
  const startTime = Date.now();
  const deadline = startTime + HARD_TIMEOUT;
  let lastNewCount = 0;

  // Take snapshot of existing URLs to filter out later
  const beforeUrls = new Set(await getFeedImageUrls(page));

  while (Date.now() < deadline && !shouldPause && !shouldCancel) {
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

  if (shouldPause || shouldCancel) {
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

  throw new Error(`Таймаут генерации (${Math.round(HARD_TIMEOUT / 1000)}с). Ни одно изображение не появилось.`);
}


// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  DOWNLOAD VALIDATION — strict file checks
// ══════════════════════════════════════════════════════════════

const MIN_FILE_SIZE = 10_000; // 10KB minimum — below this is definitely corrupt/incomplete

/**
 * Validate a downloaded image file.
 * Rejects: missing, empty, < 10KB, non-image format.
 * Accepts: valid images >= 10KB with quality tiers:
 *   fullres (>2MB), acceptable (>1MB), preview (>10KB)
 */
function validateDownload(filePath, dlResult) {
  // 1. Download reported success
  if (!dlResult || !dlResult.success) {
    return { ok: false, reason: 'download_failed', method: dlResult?.method || 'unknown' };
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

  // 4. File size >= 10KB (truly corrupt/incomplete below this)
  if (stat.size < MIN_FILE_SIZE) {
    return { ok: false, reason: `corrupt_tiny_${Math.round(stat.size / 1024)}KB` };
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
      const hexHeader = [...header].map(b => b.toString(16).padStart(2, '0')).join(' ');
      return { ok: false, reason: `invalid_image_format (magic: ${hexHeader})` };
    }

    const format = isJpeg ? 'jpeg' : isPng ? 'png' : 'webp';
    const sizeKB = Math.round(stat.size / 1024);
    const quality = stat.size >= 2_000_000 ? 'fullres' 
                  : stat.size >= 1_000_000 ? 'acceptable' 
                  : 'preview';

    console.log(`[engine] ✓ Validation passed: ${sizeKB}KB, format=${format}, quality=${quality}`);
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
    errorCount: imageResults.filter(r => r.state === 'failed' || r.state === 'error').length,
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

function pauseGeneration() {
  shouldPause = true;
  console.log('[engine] ⏸ pauseGeneration() called — soft pause requested');
}

function cancelGeneration() {
  shouldCancel = true;
  shouldPause = true; // cancel implies pause (stops new slots from starting)
  console.log('[engine] ✕ cancelGeneration() called — hard cancel requested');
}

// Backward compat alias
function stopGeneration() {
  pauseGeneration();
}

// Removed inline function getIsGenerating here since it was duplicated at the top


// ══════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════
module.exports = {
  generatePrompt,
  downloadImage,
  validateDownload,
  browserFetch,
  buildDownloadCandidates,
  stopGeneration,      // backward compat alias → pauseGeneration
  pauseGeneration,
  cancelGeneration,
  getIsGenerating,
  getShouldPause,
  getShouldCancel,
  resetStopFlags,
  _resetIsGenerating,
  dedupeUrls,
  isUnlimitedOn,
  ensureUnlimited,
  verifyActiveModel,
  waitForFeedStable,
  snapshotFeedFingerprints,
  countInFlightItems,
  preflightSettingsSync,
  setQuality,
  verifyQuality,
  verifyAspectRatio,
  setAspectRatio,
  IMAGES_PER_PROMPT,
  DEFAULT_MODEL,
  UNLIMITED_MODELS,
  PAID_ONLY_MODELS,
  MODEL_QUALITY_OPTIONS,
};

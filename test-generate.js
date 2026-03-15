#!/usr/bin/env node
/* ============================================================
   TEST GENERATION v2 — Full Pipeline Test
   Run: node test-generate.js
   ============================================================ */

const chrome = require('./chrome-manager');
const engine = require('./higgsfield-engine');
const { importFile } = require('./file-importer');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.join(__dirname, 'output');
const TEST_CSV = path.join(__dirname, 'test_prompts.csv');

async function main() {
  console.log('🧪 Higgsfield Studio — Generation Test v2\n');

  // ── 1. Import test CSV ──
  console.log('📄 Importing test_prompts.csv...');
  const importResult = importFile(TEST_CSV);
  if (!importResult.success) {
    console.error('❌ Import failed:', importResult.error);
    process.exit(1);
  }
  console.log(`   ✅ ${importResult.count} prompts loaded`);
  for (const row of importResult.rows) {
    console.log(`   [${row.id}] ${row.prompt.substring(0, 60)}...`);
  }

  // ── 2. Check Chrome CDP ──
  console.log('\n🔗 Checking Chrome...');
  const status = await chrome.isCDPRunning();
  if (!status.running) {
    console.error('❌ Chrome not running on port 9222!');
    process.exit(1);
  }
  console.log(`   ✅ Chrome detected: ${status.browser}`);

  // ── 3. Connect CDP ──
  console.log('\n🔌 Connecting CDP...');
  const connectResult = await chrome.connectCDP();
  if (!connectResult.success) {
    console.error('❌ CDP connection failed:', connectResult.error);
    process.exit(1);
  }
  console.log('   ✅ Connected to Chrome');

  const page = chrome.getActivePage();
  if (page) console.log(`   📍 Active page: ${page.url()}`);

  // ── 4. Check Unlimited support ──
  const model = 'nano_banana_pro';
  console.log(`\n🔍 Checking model: ${model}`);
  const modelInfo = engine.UNLIMITED_MODELS[model];
  if (!modelInfo) {
    console.error(`❌ Model ${model} doesn't support Unlimited`);
    process.exit(1);
  }
  console.log(`   ✅ Model supports Unlimited: ${modelInfo.name}`);

  // ── 5. Check Unlimited toggle ──
  console.log('\n🔄 Checking Unlimited toggle...');
  const unlimitedState = await engine.isUnlimitedOn(page);
  console.log(`   Current state: ${unlimitedState}`);

  if (unlimitedState !== true) {
    console.log('   Enabling Unlimited...');
    const enabled = await engine.ensureUnlimited(page);
    console.log(`   Result: ${enabled ? '✅ Enabled' : '❌ Failed'}`);
    if (!enabled) {
      console.error('❌ Cannot enable Unlimited. Aborting.');
      process.exit(1);
    }
  } else {
    console.log('   ✅ Already ON');
  }

  // ── 6. Ensure output dir ──
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const promptDir = path.join(OUTPUT_DIR, '001');
  if (!fs.existsSync(promptDir)) fs.mkdirSync(promptDir, { recursive: true });

  // ── 7. Generate first prompt ──
  const prompt = importResult.rows[0];
  console.log('\n🎨 Starting generation...');
  console.log(`   Prompt: "${prompt.prompt}"`);
  console.log(`   Model: ${model} (${modelInfo.name})`);
  console.log(`   Target: 4 images via 4 Generate clicks`);
  console.log('');

  try {
    const result = await engine.generatePrompt(prompt.prompt, {
      model,
      aspect: '1:1',
      quality: '1K',
      onProgress: (p) => {
        const ts = new Date().toLocaleTimeString();
        console.log(`   [${ts}] ${p.step}: ${p.message}`);
      },
    });

    console.log(`\n   ✅ Generated: ${result.imageCount} images from ${result.clickCount} clicks`);
    for (const u of result.urls) {
      console.log(`      URL: ${u.substring(0, 80)}...`);
    }

    // ── 8. Download images ──
    console.log('\n📥 Downloading...');
    const files = [];
    for (let i = 0; i < Math.min(result.urls.length, 4); i++) {
      const dest = path.join(promptDir, `gen_${i + 1}.jpg`);
      const dlResult = await engine.downloadImage(result.urls[i], dest);

      if (dlResult.success) {
        const kb = Math.round(dlResult.size / 1024);
        console.log(`   ✅ gen_${i + 1}.jpg — ${kb}KB (${dlResult.method})`);
        files.push(`gen_${i + 1}.jpg`);
      } else {
        console.log(`   ❌ gen_${i + 1}.jpg — ${dlResult.error}`);
      }
    }

    // ── 9. Save meta.json ──
    const meta = {
      id: prompt.id,
      prompt: prompt.prompt,
      status: files.length > 0 ? 'ready_for_selection' : 'error',
      target_count: 4,
      generated_count: files.length,
      in_flight_count: 0,
      files,
      selected: null,
      error: null,
      model,
      aspect_ratio: '1:1',
      resolution: '1K',
      timestamps: {
        started: new Date().toISOString(),
        completed: new Date().toISOString(),
      },
      urls: result.urls.slice(0, 4),
    };
    fs.writeFileSync(path.join(promptDir, 'meta.json'), JSON.stringify(meta, null, 2));
    console.log('\n📋 Meta.json saved');

    // ── 10. Validate ──
    console.log('\n🔍 Validation:');
    console.log(`   Files saved: ${files.length}/4`);
    console.log(`   Status: ${meta.status}`);
    console.log(`   Output dir: ${promptDir}`);

    if (files.length >= 4) {
      console.log('\n🎉 TEST PASSED! Full pipeline works.');
    } else if (files.length > 0) {
      console.log(`\n⚠️ PARTIAL: ${files.length}/4 images saved.`);
    } else {
      console.log('\n❌ TEST FAILED: No images saved.');
    }

  } catch (err) {
    console.error(`\n❌ Generation failed: ${err.message}`);
    console.error(err.stack);
  }

  await chrome.cleanup();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

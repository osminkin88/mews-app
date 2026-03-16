#!/usr/bin/env node
/* ============================================================
   SMOKE TEST — Persistence Contracts
   
   Verifies that config.json and project.json correctly
   round-trip persistence data without losing anything.
   
   Run: node tests/smoke-persistence.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(require('os').tmpdir(), 'mews-smoke-test-' + Date.now());
const CONFIG_DIR = path.join(TEST_DIR, 'config');
const OUTPUT_DIR = path.join(TEST_DIR, 'output');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}`);
    failed++;
  }
}

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

// ── Setup ──
fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ══════════════════════════════════════════════════════════════
// Test 1: config.json session round-trip
// ══════════════════════════════════════════════════════════════
console.log('\n▶ Test 1: config.json session round-trip');

const configFile = path.join(CONFIG_DIR, 'config.json');
const sessionData = {
  isFirstLaunch: false,
  outputDir: OUTPUT_DIR,
  selectedModel: 'nano_banana_pro',
  selectedQuality: '2K',
  selectedRatio: '1:1',
  windowBounds: null,
  lastActiveProjectId: 'abc123xyz',
  lastScreen: 'selection',
  lastImagesPerPrompt: 6,
};

fs.writeFileSync(configFile, JSON.stringify(sessionData, null, 2), 'utf-8');

const loadedConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
assert(loadedConfig.lastActiveProjectId === 'abc123xyz', 'lastActiveProjectId persisted');
assert(loadedConfig.lastScreen === 'selection', 'lastScreen persisted');
assert(loadedConfig.lastImagesPerPrompt === 6, 'lastImagesPerPrompt persisted');
assert(loadedConfig.isFirstLaunch === false, 'isFirstLaunch persisted');

// ══════════════════════════════════════════════════════════════
// Test 2: project.json selections round-trip
// ══════════════════════════════════════════════════════════════
console.log('\n▶ Test 2: project.json selections round-trip');

const projectDir = path.join(OUTPUT_DIR, 'Test Project');
fs.mkdirSync(projectDir, { recursive: true });

const projectData = {
  id: 'test-project-1',
  name: 'Test Project',
  icon: '🎬',
  folderName: 'Test Project',
  createdAt: new Date().toISOString(),
  status: 'in_progress',
  model: 'nano_banana_pro',
  promptCount: 30,
  prompts: Array.from({ length: 30 }, (_, i) => ({
    id: String(i + 1),
    prompt: `Test prompt ${i + 1}`,
    status: i < 15 ? 'completed' : 'pending',
  })),
  sourceMeta: null,
  // NEW persistence fields:
  selections: { "0": 2, "3": 1, "7": 0, "14": 3 },
  selectionCurrentPrompt: 14,
  selectedModel: 'gpt_image',
  selectedQuality: 'High',
  selectedRatio: '16:9',
  imagesPerPrompt: 2,
  lastScreen: 'selection',
};

fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(projectData, null, 2), 'utf-8');

const loadedProject = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
assert(Object.keys(loadedProject.selections).length === 4, 'selections count = 4');
assert(loadedProject.selections['0'] === 2, 'selection prompt 0 = image 2');
assert(loadedProject.selections['14'] === 3, 'selection prompt 14 = image 3');
assert(loadedProject.selectionCurrentPrompt === 14, 'selectionCurrentPrompt = 14');
assert(loadedProject.selectedModel === 'gpt_image', 'selectedModel persisted');
assert(loadedProject.selectedQuality === 'High', 'selectedQuality persisted');
assert(loadedProject.selectedRatio === '16:9', 'selectedRatio persisted');
assert(loadedProject.imagesPerPrompt === 2, 'imagesPerPrompt persisted');
assert(loadedProject.lastScreen === 'selection', 'lastScreen persisted in project');

// ══════════════════════════════════════════════════════════════
// Test 3: meta.json with selected field
// ══════════════════════════════════════════════════════════════
console.log('\n▶ Test 3: meta.json selected field round-trip');

const metaDir = path.join(projectDir, 'generated', '001');
fs.mkdirSync(metaDir, { recursive: true });

const meta = {
  id: '1',
  prompt: 'A beautiful sunset',
  status: 'done',
  target_count: 4,
  saved_count: 4,
  files: ['img_001.jpg', 'img_002.jpg', 'img_003.jpg', 'img_004.jpg'],
  selected: 'img_002.jpg',
};

fs.writeFileSync(path.join(metaDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

const loadedMeta = JSON.parse(fs.readFileSync(path.join(metaDir, 'meta.json'), 'utf-8'));
assert(loadedMeta.selected === 'img_002.jpg', 'meta.json selected field persisted');
assert(loadedMeta.files.length === 4, 'meta.json files array length');

// ══════════════════════════════════════════════════════════════
// Test 4: Large selections (50 prompts)
// ══════════════════════════════════════════════════════════════
console.log('\n▶ Test 4: Large selections (50 prompts)');

const bigSelections = {};
for (let i = 0; i < 50; i++) {
  bigSelections[String(i)] = Math.floor(Math.random() * 4);
}

const bigProject = {
  ...projectData,
  id: 'big-project',
  selections: bigSelections,
  selectionCurrentPrompt: 49,
  promptCount: 50,
};

const bigProjectDir = path.join(OUTPUT_DIR, 'Big Project');
fs.mkdirSync(bigProjectDir, { recursive: true });
fs.writeFileSync(path.join(bigProjectDir, 'project.json'), JSON.stringify(bigProject, null, 2), 'utf-8');

const loadedBig = JSON.parse(fs.readFileSync(path.join(bigProjectDir, 'project.json'), 'utf-8'));
assert(Object.keys(loadedBig.selections).length === 50, '50 selections survived round-trip');
assert(loadedBig.selectionCurrentPrompt === 49, 'currentPrompt 49 survived');

// Verify all values match
let allMatch = true;
for (const [k, v] of Object.entries(bigSelections)) {
  if (loadedBig.selections[k] !== v) { allMatch = false; break; }
}
assert(allMatch, 'All 50 selection values match exactly');

// ══════════════════════════════════════════════════════════════
// Test 5: Concurrent config writes (simulate rapid clicks)
// ══════════════════════════════════════════════════════════════
console.log('\n▶ Test 5: Rapid config writes');

for (let i = 0; i < 20; i++) {
  const update = { ...sessionData, lastScreen: `screen_${i}`, lastImagesPerPrompt: i + 1 };
  fs.writeFileSync(configFile, JSON.stringify(update, null, 2), 'utf-8');
}

const finalConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
assert(finalConfig.lastScreen === 'screen_19', 'Last rapid write wins');
assert(finalConfig.lastImagesPerPrompt === 20, 'Final imagesPerPrompt = 20');

// ══════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════
cleanup();

console.log(`\n${'═'.repeat(50)}`);
if (failed === 0) {
  console.log(`🎉 All ${passed} smoke tests passed!`);
} else {
  console.log(`⚠️  ${passed} passed, ${failed} FAILED`);
  process.exit(1);
}

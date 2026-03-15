/**
 * Quick test: generate 1 image and download it
 */

// Temporarily override IMAGES_PER_PROMPT
const enginePath = require.resolve('./higgsfield-engine');
const originalCode = require('fs').readFileSync(enginePath, 'utf-8');

// Monkey-patch: just use the engine with 1 image
const engine = require('./higgsfield-engine');
const chrome = require('./chrome-manager');

(async () => {
  console.log('🧪 Single Image Test — Generate 1, Download, Done\n');
  
  const status = await chrome.checkChrome();
  console.log(`Chrome: ${status.connected ? '✅' : '❌'}`);
  if (!status.connected) { console.log('Chrome not running! Start Chrome with --remote-debugging-port=9222'); process.exit(1); }
  
  await chrome.connectCDP();
  const page = chrome.getActivePage();
  console.log(`Page: ${page.url()}\n`);

  // Override IMAGES_PER_PROMPT temporarily
  // We'll call the internal flow manually for 1 image
  const result = await engine.generatePrompt({
    prompt: 'A cute orange cat sitting on a windowsill watching sunset golden hour photography',
    model: 'nano_banana_pro',
    outputDir: './output/test_single',
    onProgress: (p) => {
      const time = new Date().toLocaleTimeString();
      console.log(`   [${time}] ${p.step}: ${p.message}`);
    }
  });

  console.log('\n📋 Result:');
  console.log(`   Images: ${result.images?.length || 0}`);
  console.log(`   Status: ${result.status}`);
  if (result.images) {
    result.images.forEach((img, i) => {
      console.log(`   ${i+1}. ${img.filename} — ${img.size ? Math.round(img.size/1024) + 'KB' : 'failed'}`);
    });
  }
  
  process.exit(0);
})().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

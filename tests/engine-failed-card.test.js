import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const engine = require('../higgsfield-engine.js');
const chromeManager = require('../chrome-manager.js');

describe('Engine: Failed Card Detector & Normal Flow Abort', () => {
  let fakePage;

  beforeEach(() => {
    // Мокаем зависимости fs локально без vi.mock('fs'), чтобы readFileSync работал
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(true);
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 1500000 });
    vi.spyOn(fs, 'openSync').mockReturnValue(123);
    vi.spyOn(fs, 'readSync').mockImplementation((fd, buffer) => {
      buffer[0] = 0xff; buffer[1] = 0xd8; buffer[2] = 0xff;
      return 3;
    });
    vi.spyOn(fs, 'closeSync').mockReturnValue();
    
    // Мокаем chromeManager
    vi.spyOn(chromeManager, 'navigateToModel').mockResolvedValue();
    vi.spyOn(chromeManager, 'sleep').mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strictly detects combined failure signals (Failed + Refunded/Retry) via JSDOM without false positives', () => {
    // Читаем реальный код движка (используется для извлечения DOM-логики, которая работает внутри браузера)
    const engineCode = fs.readFileSync(path.join(__dirname, '../higgsfield-engine.js'), 'utf-8');
    
    // Извлекаем тело функции checkTopFeedCardFailed
    const match = engineCode.match(/checkTopFeedCardFailed[\s\S]*?page\.evaluate\(\(\) => \{([\s\S]*?)\}\);/);
    expect(match).toBeTruthy();
    const evaluatorLogic = match[1];

    const runInDOM = (html) => {
      const dom = new JSDOM(html);
      // Обертка вокруг извлеченного кода
      const fn = new dom.window.Function(`
        const document = this.document;
        ${evaluatorLogic}
      `);
      return fn.call(dom.window);
    };

    // Сценарий 1: Одиночное слово не должно вызывать ранний сброс слота! (Ложное срабатывание в промпте)
    const falsePositiveHtml = `
      <div id="soul-feed-scroll">
        <div class="card">
          <div><p>Prompt: failed to draw a horse</p></div>
        </div>
      </div>
    `;
    expect(runInDOM(falsePositiveHtml)).toBe(false);

    // Сценарий 2: Реальная карточка (Failed + Credits refunded)
    const realCardHtml = `
      <div id="soul-feed-scroll">
        <div class="card">
          <div><span>Failed</span></div>
          <div><span>Credits refunded</span></div>
        </div>
      </div>
    `;
    expect(runInDOM(realCardHtml)).toBe(true);

    // Сценарий 3: Реальная карточка (Generation failed + Retry)
    const retryCardHtml = `
      <div id="soul-feed-scroll">
        <div class="card">
          <div><span>Generation failed</span></div>
          <div><button>Retry</button></div>
        </div>
      </div>
    `;
    expect(runInDOM(retryCardHtml)).toBe(true);
  });

  it('aborts waitForSingleImage immediately and returns site_failed when top card is marked as failed', async () => {
    engine.resetStopFlags();
    engine._resetIsGenerating();
    
    let pollCount = 0;

    // Эмулируем страницу, на которой генерируется ошибка
    fakePage = {
      url: () => 'https://higgsfield.ai/image/nano_banana_2',
      title: async () => 'Nano Banana Pro',
      evaluate: vi.fn().mockImplementation(async (fnOrStr) => {
        const fnStr = fnOrStr.toString();
        // Заглушки для успешной инициализации страницы
        if (fnStr.includes('Unlimited')) return true;
        if (fnStr.includes('const active = Array.from')) return { current: 1, max: 4 };
        if (fnStr.includes('span, div') || fnStr.includes('return { current: parseInt')) return { current: 1, max: 4, element: true };
        if (fnStr.includes('batch size elements')) return { current: 1, max: 4, element: true };
        if (fnStr.includes('alive')) return { alive: true };
        if (fnStr.includes('arguments[0].click()') || fnStr.includes('Primary: by ID')) return true;
        if (fnStr.includes('actual.includes(expected.substring')) return { ok: true };
        if (fnStr.includes('AspectRatio') || fnStr.includes('/^\\\\d+:\\\\d+$/') || fnStr.includes('/^\\d+:\\d+$/') || fnStr.includes('targetRatio')) return '1:1';
        if (fnStr.includes('role="option"')) return 'option';
        if (fnStr.includes('qual =')) return '1K';
        
        if (fnStr.includes('promptField:')) return { promptField: true, generateButton: true };
        if (fnStr.includes('allContenteditable')) return { found: ['[contenteditable="true"]'], allContenteditable: 1 };
        if (fnStr.includes('el.innerText.trim()')) return '';

        // Моделирование ситуации:
        // Сначала возвращаем queued=1 (чтобы engine понял, что мы встали в очередь)
        // Затем queued=0 (чтобы сработал триггер queuedGone)
        if (fnStr.includes("t === 'Queued'") || fnStr.includes('t === "Queued"')) {
          pollCount++;
          if (pollCount <= 1) return { total: 1, queued: 1, generating: 0 };
          return { total: 0, queued: 0, generating: 0 };
        }
        
        // 2. Детектор checkTopFeedCardFailed вызывается -> симулируем наличие упавшей карточки
        if (fnStr.includes('hasFailed = false') || fnStr.includes('hasFailed')) return true; 
        
        // Мок для feed urls и uuid
        if (fnStr.includes('promoSignals')) return [];
        
        return null;
      }),
      waitForSelector: vi.fn().mockResolvedValue(true),
      $$eval: vi.fn().mockResolvedValue([]),
      $: vi.fn().mockResolvedValue({ click: vi.fn(), type: vi.fn() }),
      $$: vi.fn().mockResolvedValue([]),
      click: vi.fn().mockResolvedValue(),
      type: vi.fn().mockResolvedValue(),
      keyboard: { press: vi.fn().mockResolvedValue() },
    };

    vi.spyOn(chromeManager, 'getActivePage').mockReturnValue(fakePage);
    vi.spyOn(engine, 'downloadImage')?.mockRestore?.();

    const progressLogs = [];
    let thrownError = null;
    try {
      await engine.generatePrompt('test failure', {
        model: 'nano_banana_pro',
        imagesCount: 1,
        onProgress: (evt) => progressLogs.push(evt)
      });
    } catch (err) {
      thrownError = err;
    }

    // Assertions
    expect(thrownError).toBeDefined();
    expect(thrownError.message).toContain('Ни одного изображения не сохранено');

    // Проверяем, что детектор действительно вызывался движком
    const detectorCalls = fakePage.evaluate.mock.calls.filter(c => c[0].toString().includes('hasFailed'));
    expect(detectorCalls.length).toBeGreaterThan(0);
    // Проверяем логи прогресса, что детектор зачекировал падение
    const hasCorrectFailureLog = progressLogs.some(log => 
       (log.step === 'error' && log.message.includes('сервер вернул ошибку')) || 
       (log.step === 'slot_failed' && log.failedReason === 'site_failed')
    );
    expect(hasCorrectFailureLog).toBe(true);
  }, 35000); // <-- timeout argument here
});

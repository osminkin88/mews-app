/* ============================================================
   UNIT TESTS — Engine Actions (Pause / Cancel)
   ============================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('fs');

const engine = require('../higgsfield-engine.js');
const chromeManager = require('../chrome-manager.js');

describe('Engine Action Flags', () => {
  beforeEach(() => {
    engine.resetStopFlags();
  });

  it('pauseGeneration sets shouldPause but not shouldCancel', () => {
    engine.pauseGeneration();
    expect(engine.getShouldPause()).toBe(true);
    expect(engine.getShouldCancel()).toBe(false);
  });

  it('cancelGeneration sets BOTH shouldCancel and shouldPause', () => {
    engine.cancelGeneration();
    expect(engine.getShouldCancel()).toBe(true);
    // cancel подразумевает прекращение очереди, поэтому pause тоже true
    expect(engine.getShouldPause()).toBe(true);
  });

  it('resetStopFlags clears both flags', () => {
    engine.cancelGeneration();
    engine.resetStopFlags();
    expect(engine.getShouldPause()).toBe(false);
    expect(engine.getShouldCancel()).toBe(false);
  });
});

describe('Engine GeneratePrompt — Soft Pause Scenario', () => {
  let fakePage;

  beforeEach(() => {
    engine.resetStopFlags();
    engine._resetIsGenerating();
    
    let mockedFeed = [];
    const fs = require('fs');

    fs.existsSync = vi.fn().mockReturnValue(true);
    fs.mkdirSync = vi.fn();
    fs.writeFileSync = vi.fn();
    fs.createWriteStream = vi.fn().mockImplementation(() => ({
      on: (evt, cb) => {
        if (evt === 'finish' || evt === 'close') cb();
        if (evt === 'error') return;
      },
      write: () => true,
      end: () => {}
    }));
    fs.statSync = vi.fn().mockReturnValue({ size: 1500000 }); // 1.5MB to pass validation
    fs.openSync = vi.fn().mockReturnValue(123);
    fs.readSync = vi.fn().mockImplementation((fd, buffer, offset, length, position) => {
      // Magic bytes for jpeg: FF D8 FF
      buffer[0] = 0xff;
      buffer[1] = 0xd8;
      buffer[2] = 0xff;
      return 3;
    });
    fs.closeSync = vi.fn();

    // Создаем Stub страницы
    fakePage = {
      url: () => 'https://higgsfield.ai/image/nano_banana_2',
      title: async () => 'Nano Banana Pro',
      evaluate: vi.fn().mockImplementation(async (fnOrStr, ...args) => {
        const fnStr = fnOrStr.toString();
        // Мокаем проверки Unlimited (true)
        if (fnStr.includes('Unlimited')) return true;
        // Мокаем extra free gens (false)
        if (fnStr.includes('Extra free gens')) return false;
        // Мокаем batch size (current 1, max 4)
        if (fnStr.includes('const active = Array.from')) return { current: 1, max: 4 };
        // Мокаем in-flight (0) и feedCount (0)
        if (fnStr.includes('queued:')) return { total: 0, queued: 0, generating: 0 };
        // Мокаем Health check
        if (fnStr.includes('alive')) return { alive: true };
        // Fallback for clearPromptField / enterPrompt
        return { found: [], allContenteditable: 0, alive: true, current: 1, max: 4 };
      }),
      // Мокаем методы Puppeteer для работы waitForSingleImage
      waitForSelector: vi.fn().mockResolvedValue(true),
      $$eval: vi.fn().mockResolvedValue([]),
      $: vi.fn().mockResolvedValue({ click: vi.fn(), type: vi.fn() }),
      $$: vi.fn().mockResolvedValue([]),
      click: vi.fn().mockResolvedValue(),
      type: vi.fn().mockResolvedValue(),
      keyboard: { press: vi.fn().mockResolvedValue() },
    };

    // Мокаем chrome-manager
    vi.spyOn(chromeManager, 'getActivePage').mockReturnValue(fakePage);
    vi.spyOn(chromeManager, 'navigateToModel').mockResolvedValue();
    vi.spyOn(chromeManager, 'sleep').mockResolvedValue();

    // Мокаем сетевой загрузчик, чтобы не качать реальные файлы
    vi.spyOn(engine, 'downloadImage').mockResolvedValue({
      success: true,
      size: 1500000,
      method: 'mocked'
    });

    // Мокаем внутренний Puppeteer клик "Generate" - возвращает true
    fakePage.evaluate.mockImplementation(async (fnOrStr, ...args) => {
      const fnStr = fnOrStr.toString();
      if (fnStr.includes('Unlimited')) return true;
      if (fnStr.includes('const active = Array.from')) return { current: 1, max: 4 };
      if (fnStr.includes('queued:')) return { total: 0, queued: 0, generating: 0 };
      if (fnStr.includes('arguments[0].click()') || fnStr.includes('Primary: by ID')) {
        // Добавляем картинку синхронно, чтобы обойти зависание из-за мока chrome.sleep()
        const fakeUUID = `11111111-1111-1111-1111-${String(Date.now()).slice(-12).padStart(12, '0')}`;
        mockedFeed = [`https://higgsfield.ai/test-${fakeUUID}-min.webp`, ...mockedFeed];
        return true; // clickGenerate
      }
      if (fnStr.includes('Quality:') || fnStr.includes('qualityPatterns')) return '1K';
      
      // Aspect ratio (getActiveAspectRatio, click ratio)
      if (fnStr.includes('AspectRatio') || fnStr.includes('/^\\d+:\\d+$/') || fnStr.includes('targetRatio')) return '1:1';
      if (fnStr.includes('role="option"')) return 'option';
      
      if (fnStr.includes('const qual =')) return '1K'; // verifyQuality code
      
      // Prompt verification match (enterPrompt)
      if (fnStr.includes('actual.includes(expected.substring')) {
        return { ok: true, actual: 'test prompt', actualLen: 11 };
      }

      // Мокаем Health check
      if (fnStr.includes('alive')) return { alive: true };
      
      // Batch size
      if (fnStr.includes('span, div') || fnStr.includes('return { current: parseInt')) {
        return { current: 1, max: 4, element: true };
      }

      // Fallback for clearPromptField
      if (fnStr.includes('allContenteditable')) return { found: ['[contenteditable="true"]'], allContenteditable: 1 };
      
      // Prompts & Modals
      if (fnStr.includes('promptField:')) return { promptField: true, generateButton: true };
      if (fnStr.includes('Standard close buttons')) return null;

      // Fingerprints & Feed (return array)
      if (fnStr.includes('promoSignals')) return mockedFeed;

      // Mock browser fetch fallback for downloadImage (must be > 50,000 bytes)
      if (fnStr.includes('const r = aw') || fnStr.includes('fetchUrl')) {
        const dummyData = new Array(50001).fill(0);
        dummyData[0] = 0xff;
        dummyData[1] = 0xd8;
        dummyData[2] = 0xff;
        return { data: dummyData }; 
      }

      // Fallback for clearPromptField text remaining
      if (fnStr.includes('el.innerText.trim()')) return '';
      
      console.log("Unmatched page.evaluate:", fnStr.substring(0, 50));
      // Defalut for other fallbacks in case string match fails
      return '';
    });

    // Заменяем waitForSingleImage, чтобы сразу возвращало фейковый URL
    // Так как waitForSingleImage не экспортируется, мы заставляем scanGenerationImages возвращать URL
    fakePage.$$eval.mockImplementation(async (selector, fn, ...args) => {
      if (selector === 'img[src*="/image/"], img[src*="blob:"]') {
        // Симулируем появление картинки
        return [`https://higgsfield.ai/image/nano_banana_2/mocked_image_${Date.now()}.jpg`];
      }
      return [];
    });
  });

  it('should gracefully stop generation loop when paused during progress', async () => {
    // Точка врезки: считаем сколько слотов сохранилось.
    // Если 1 слот уже сделан, кидаем паузу перед тем, как движок перейдет ко второму.
    let slotsSaved = 0;
    const progressLog = [];

    const onProgress = (evt) => {
      progressLog.push(evt.step);
      if (evt.step === 'saved') {
        slotsSaved++;
        if (slotsSaved === 1) {
             engine.pauseGeneration();
        }
      }
    };

    const testPage = chromeManager.getActivePage();
    console.log('DEBUG testPage url typeof:', typeof testPage.url);

    const result = await engine.generatePrompt('test prompt', {
      model: 'nano_banana_pro',
      imagesCount: 4,
      onProgress
    });

    // Проверяем семантику выхода
    expect(result.promptStatus).toBe('paused');
    expect(result.savedCount).toBe(1);
    
    // Проверяем стейты внутри массива
    expect(result.images).toHaveLength(4);
    expect(result.images[0].state).toBe('saved'); // Слот 1 сохранился
    expect(result.images[1].state).toBe('paused'); // Слот 2 прерван до старта
    expect(result.images[2].state).toBe('paused'); // Слот 3 отменен
    expect(result.images[3].state).toBe('paused'); // Слот 4 отменен
  });

  it('should abort completely and mark aborted slots as cancelled on cancelGeneration', async () => {
    let cancelTriggered = false;
    
    const onProgress = (evt) => {
      // Имитируем нажатие "Cancel" во время ожидания 2-го слота (in-flight polling)
      if (evt.step === 'waiting' && evt.message.includes('2/4') && !cancelTriggered) {
        cancelTriggered = true;
        engine.cancelGeneration();
      }
    };

    const result = await engine.generatePrompt('test prompt', {
      model: 'nano_banana_pro',
      imagesCount: 4,
      onProgress
    });

    // Проверяем семантику отмены
    expect(result.promptStatus).toBe('cancelled'); // Статус всего промпта
    
    // Первый слот успевает сохраниться до 2-го
    expect(result.savedCount).toBe(1);
    
    // Проверяем состояния внутри массива слотов
    expect(result.images).toHaveLength(4);
    expect(result.images[0].state).toBe('saved');     // Слот 1 отработал штатно
    expect(result.images[1].state).toBe('cancelled'); // Слот 2 прерван hard cancel (in-flight result dropped)
    expect(result.images[2].state).toBe('cancelled'); // Слот 3 пропущен
    expect(result.images[3].state).toBe('cancelled'); // Слот 4 пропущен
    
    // Убеждаемся, что оба флага остановки установлены
    expect(engine.getShouldCancel()).toBe(true);
    expect(engine.getShouldPause()).toBe(true);
  });
});

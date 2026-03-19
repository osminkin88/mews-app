/* ============================================================
   UNIT TESTS — Engine Slot Sequence (Backfill, Queue, Ordering)
   ============================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('fs');

const engine = require('../higgsfield-engine.js');
const chromeManager = require('../chrome-manager.js');

describe('Engine Slot Sequence & Backfill', () => {
  let fakePage;
  let clickCount = 0;
  let orderLog = [];
  let mockedFeed = [];
  let currentSlot = 0;

  beforeEach(() => {
    engine.resetStopFlags();
    engine._resetIsGenerating();
    
    clickCount = 0;
    orderLog = [];
    mockedFeed = [];
    currentSlot = 0;
    
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
        
        // Мок клика "Generate"
        if (fnStr.includes('arguments[0].click()') || fnStr.includes('Primary: by ID')) {
          clickCount++;
          orderLog.push(`slot_${currentSlot}_clicked`);
          const fakeUUID = `22222222-2222-2222-2222-${String(Date.now()).slice(-12).padStart(12, '0')}`;
          mockedFeed = [`https://higgsfield.ai/test-${fakeUUID}-min.webp`, ...mockedFeed];
          return true; // clickGenerate
        }
        
        if (fnStr.includes('Quality:') || fnStr.includes('qualityPatterns')) return '1K';
        
        // Aspect ratio (getActiveAspectRatio, click ratio)
        if (fnStr.includes('AspectRatio') || fnStr.includes('/^\\d+:\\d+$/') || fnStr.includes('targetRatio')) return '1:1';
        if (fnStr.includes('role="option"')) return 'option';
        if (fnStr.includes('const qual =')) return '1K';
        
        // Prompt verification match (enterPrompt)
        if (fnStr.includes('actual.includes(expected.substring')) {
          return { ok: true, actual: 'test prompt', actualLen: 11 };
        }

        // Мокаем Health check
        if (fnStr.includes('alive')) return { alive: true };
        
        // Batch size elements fallback
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
        
        return '';
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

    // Мокаем сетевой загрузчик Node.js, чтобы падал и отдавал эстафету fallback-браузеру
    vi.spyOn(engine, 'downloadImage').mockRestore?.(); // Снимаем мок сетевого загрузчика, используем внутренний
  });

  const onProgressTracer = (evt) => {
    if (evt.step === 'preflight') return; // Игнорируем общий префлайт
    
    // Определяем текущий слот из сообщения, если оно содержит X/Y
    const match = evt.message?.match(/Слот (\d+)\/\d+/i) || evt.message?.match(/Изображение (\d+)\//i);
    if (match) {
      currentSlot = parseInt(match[1], 10);
    }
    
    if (evt.step === 'waiting') {
      const startLog = `slot_${currentSlot}_start`;
      if (!orderLog.includes(startLog)) {
        orderLog.push(startLog);
      }
    }
    
    if (evt.step === 'saved' || evt.step === 'recovering') {
      orderLog.push(`slot_${currentSlot}_saved`);
    }
  };

  it('should skip already saved slots (Backfill logic) without firing generate clicks', async () => {
    const options = {
      model: 'nano_banana_pro',
      imagesCount: 4,
      skipSlots: [1, 2],
      existingSlots: [
        { slot: 1, file: 'gen_1_old.jpg', size: 1048576, quality: '1K' },
        { slot: 2, file: 'gen_2_old.jpg', size: 1048576, quality: '1K' }
      ],
      onProgress: onProgressTracer
    };

    const result = await engine.generatePrompt('test prompt', options);

    expect(clickCount).toBe(2); // Кликнули только для 3 и 4 слота
    
    expect(result.images).toHaveLength(4);
    
    // Проверка Backfill
    expect(result.images[0].state).toBe('saved');
    expect(result.images[0]._backfillSkipped).toBe(true);
    expect(result.images[0].file).toBe('gen_1_old.jpg');

    expect(result.images[1].state).toBe('saved');
    expect(result.images[1]._backfillSkipped).toBe(true);
    
    // Проверка новых
    expect(result.images[2].state).toBe('saved');
    expect(result.images[2]._backfillSkipped).toBeUndefined();
    
    expect(result.images[3].state).toBe('saved');
    expect(result.images[3]._backfillSkipped).toBeUndefined();
  });

  it('should process slots strictly sequentially with precise event ordering', async () => {
    const options = {
      model: 'nano_banana_pro',
      imagesCount: 3,
      onProgress: onProgressTracer
    };

    await engine.generatePrompt('test prompt', options);

    // Только 3 клика
    expect(clickCount).toBe(3);

    // Полный лог последовательности без наложений
    const expectedOrder = [
      'slot_1_clicked',
      'slot_1_start',
      'slot_1_saved',
      'slot_2_clicked',
      'slot_2_start',
      'slot_2_saved',
      'slot_3_clicked',
      'slot_3_start',
      'slot_3_saved'
    ];

    expect(orderLog).toEqual(expectedOrder);
  });

  it('should not start new slots after soft pause hits', async () => {
    const onProgressPause = (evt) => {
      onProgressTracer(evt);
      // Тормозим цикл сразу после успешного сохранения 2-го слота (до старта 3-го)
      if (evt.step === 'saved' && evt.message?.includes('Слот 2/4')) {
        engine.pauseGeneration();
      }
    };

    const options = {
      model: 'nano_banana_pro',
      imagesCount: 4,
      onProgress: onProgressPause
    };

    const result = await engine.generatePrompt('test prompt', options);

    // Должны были кликнуть только для первых 2
    expect(clickCount).toBe(2);
    
    expect(result.images).toHaveLength(4);
    expect(result.images[0].state).toBe('saved');
    expect(result.images[1].state).toBe('saved');
    expect(result.images[2].state).toBe('paused'); // Никогда не стартовал
    expect(result.images[3].state).toBe('paused'); // Никогда не стартовал
    
    // В orderLog не должно быть следов 3 и 4 слотов (ни _start, ни _clicked)
    const slot3Or4Events = orderLog.filter(log => log.includes('slot_3') || log.includes('slot_4'));
    expect(slot3Or4Events).toHaveLength(0);
  });
});

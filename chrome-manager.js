/* ============================================================
   CHROME CDP MANAGER
   Launches, connects, and manages a real Chrome instance
   for Higgsfield automation via Chrome DevTools Protocol.
   ============================================================ */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

// ── Constants ─────────────────────────────────────────────────
const CDP_PORT = 9222;
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const HIGGSFIELD_URL = 'https://higgsfield.ai';
const SIGNIN_URL = 'https://higgsfield.ai/sign-in';

// ── Config-managed paths (lazy, set after app.whenReady) ──────
let _configManager = null;

function getConfig() {
  if (!_configManager) {
    _configManager = require('./config-manager');
  }
  return _configManager;
}

function getProfileDir() {
  return getConfig().ensureChromeProfileDir();
}

function getSessionFile() {
  return getConfig().getSessionPath();
}

// ── State ─────────────────────────────────────────────────────
let chromeProcess = null;
let browser = null;
let activePage = null;

// ── Chrome Path Detection ─────────────────────────────────────
function findChromePath() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── CDP Port Check ────────────────────────────────────────────
function isCDPRunning() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          resolve({ running: true, browser: info['Browser'] || 'Chrome' });
        } catch {
          resolve({ running: false });
        }
      });
    });
    req.on('error', () => resolve({ running: false }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ running: false });
    });
  });
}

// ── Launch Chrome ─────────────────────────────────────────────
async function launchChrome() {
  // Check if already running
  const status = await isCDPRunning();
  if (status.running) {
    console.log('[chrome-manager] Chrome CDP already running');
    return { success: true, alreadyRunning: true };
  }

  const chromePath = findChromePath();
  if (!chromePath) {
    return {
      success: false,
      error: 'Google Chrome не найден. Установите Chrome: https://www.google.com/chrome/',
    };
  }

  // Ensure profile directory exists
  const profileDir = getProfileDir();

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    SIGNIN_URL,
  ];

  try {
    chromeProcess = spawn(chromePath, args, {
      detached: true,
      stdio: 'ignore',
    });
    chromeProcess.unref();

    // Wait for CDP to become available (up to 10 seconds)
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const check = await isCDPRunning();
      if (check.running) {
        console.log('[chrome-manager] Chrome launched successfully');
        return { success: true, alreadyRunning: false };
      }
    }

    return { success: false, error: 'Chrome запустился, но CDP порт не отвечает' };
  } catch (err) {
    return { success: false, error: `Не удалось запустить Chrome: ${err.message}` };
  }
}

// ── Connect via CDP ───────────────────────────────────────────
async function connectCDP() {
  try {
    // Disconnect existing
    if (browser) {
      try { browser.disconnect(); } catch {}
      browser = null;
      activePage = null;
    }

    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${CDP_PORT}`,
      defaultViewport: null,  // Use Chrome's own viewport
    });

    console.log('[chrome-manager] Connected to Chrome via CDP');

    // Find best Higgsfield tab — priority:
    // 1. Tab already on /image/ model page (ideal)
    // 2. Any higgsfield.ai tab (not sign-in/login)
    // 3. First higgsfield.ai tab (even sign-in)
    // 4. First tab
    const pages = await browser.pages();
    console.log(`[chrome-manager] Found ${pages.length} tabs`);

    let modelPage = null;
    let hfPage = null;
    let anyHfPage = null;

    for (const p of pages) {
      const url = p.url();
      console.log(`[chrome-manager]   tab: ${url.substring(0, 80)}`);
      if (url.includes('higgsfield.ai')) {
        if (!anyHfPage) anyHfPage = p;
        if (url.includes('/image/')) {
          modelPage = p;
        } else if (!url.includes('sign-in') && !url.includes('login') && !url.includes('/auth')) {
          if (!hfPage) hfPage = p;
        }
      }
    }

    activePage = modelPage || hfPage || anyHfPage || (pages.length > 0 ? pages[0] : null);
    console.log(`[chrome-manager] Selected tab: ${activePage ? activePage.url().substring(0, 80) : 'NONE'}`);

    return { success: true };
  } catch (err) {
    console.error('[chrome-manager] CDP connection failed:', err.message);
    return { success: false, error: `CDP подключение не удалось: ${err.message}` };
  }
}

// ── Save Session (cookies) ────────────────────────────────────
async function saveSession() {
  if (!browser || !activePage) {
    return { success: false, error: 'Браузер не подключён' };
  }

  try {
    // Get cookies from the browser
    const client = await activePage.createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');

    // Filter Higgsfield-related cookies
    const hfCookies = cookies.filter(c =>
      c.domain.includes('higgsfield') ||
      c.domain.includes('cloudfront') ||
      c.domain.includes('google') ||
      c.domain.includes('gstatic')
    );

    // Get localStorage
    let localStorage = {};
    try {
      localStorage = await activePage.evaluate(() => {
        const data = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          data[key] = window.localStorage.getItem(key);
        }
        return data;
      });
    } catch {}

    const session = {
      cookies: hfCookies,
      localStorage,
      savedAt: new Date().toISOString(),
      url: activePage.url(),
    };

    const sessionFile = getSessionFile();
    // Ensure parent dir exists
    const sessionDir = path.dirname(sessionFile);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2), 'utf-8');

    console.log(`[chrome-manager] Session saved: ${hfCookies.length} cookies`);
    return {
      success: true,
      cookieCount: hfCookies.length,
      url: activePage.url(),
    };
  } catch (err) {
    return { success: false, error: `Ошибка сохранения сессии: ${err.message}` };
  }
}

// ── Load Session ──────────────────────────────────────────────
function loadSession() {
  const sessionFile = getSessionFile();
  if (!fs.existsSync(sessionFile)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Apply Session to Page ─────────────────────────────────────
async function applySession(page) {
  const session = loadSession();
  if (!session || !session.cookies || session.cookies.length === 0) {
    return false;
  }

  try {
    const client = await page.createCDPSession();
    for (const cookie of session.cookies) {
      try {
        await client.send('Network.setCookie', cookie);
      } catch {}
    }
    console.log(`[chrome-manager] Applied ${session.cookies.length} cookies`);
    return true;
  } catch {
    return false;
  }
}

// ── Check Auth Status ─────────────────────────────────────────
async function checkAuth() {
  if (!browser || !activePage) {
    return { connected: false, authenticated: false, error: 'Не подключён' };
  }

  try {
    let url;
    try {
      url = activePage.url();
    } catch {
      return { connected: true, authenticated: false, error: 'Страница недоступна' };
    }

    console.log(`[chrome-manager] checkAuth: url=${url.substring(0, 80)}`);

    // Immediate reject: sign-in / login page
    if (url.includes('sign-in') || url.includes('login') || url.includes('/auth/')) {
      return { connected: true, authenticated: false, url };
    }

    // If not on higgsfield.ai at all — not authenticated
    if (!url.includes('higgsfield.ai') && !url.includes('higgsfield.com')) {
      console.log('[chrome-manager] checkAuth: not on higgsfield — trying to find a better tab');
      // Try to find a higgsfield tab among all pages
      try {
        const pages = await browser.pages();
        const hfPage = pages.find(p => {
          const u = p.url();
          return u.includes('higgsfield') && !u.includes('sign-in') && !u.includes('login');
        });
        if (hfPage && hfPage !== activePage) {
          activePage = hfPage;
          url = activePage.url();
          console.log(`[chrome-manager] checkAuth: switched to better tab: ${url.substring(0, 80)}`);
        } else {
          return { connected: true, authenticated: false, url };
        }
      } catch {
        return { connected: true, authenticated: false, url };
      }
    }

    let authenticated = false;

    // ── Level 0: STRONGEST — on model page with prompt field visible ──
    // If the user is on /image/ and the prompt field exists, they ARE logged in.
    // An unauthenticated user would be redirected to sign-in.
    if (url.includes('/image/')) {
      try {
        const hasPromptField = await Promise.race([
          activePage.evaluate(() => {
            const selectors = [
              'div[id="hf:tour-image-prompt"]',
              'div[role="textbox"][contenteditable="true"]',
              'div[contenteditable="true"]',
            ];
            return selectors.some(sel => {
              const el = document.querySelector(sel);
              return el && el.offsetParent !== null;
            });
          }),
          new Promise(res => setTimeout(() => res(false), 5000)),
        ]);

        if (hasPromptField) {
          console.log('[chrome-manager] checkAuth: ✅ Level 0 — on model page with prompt field');
          return { connected: true, authenticated: true, url };
        }
      } catch (e) {
        console.log('[chrome-manager] checkAuth Level 0 error:', e.message);
      }
    }

    // ── Level 1: DOM signals ──
    try {
      const evalPromise = activePage.evaluate(() => {
        const r = {
          hasToken: false,
          hasAvatar: false,
          hasGenerateBtn: false,
          lsKeys: 0,
          signInVisible: false,
        };

        // JWT / session in localStorage
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          const val = window.localStorage.getItem(key) || '';
          if (val.length > 30 && (val.startsWith('ey') || val.includes('"token"') || val.includes('"user"') || val.includes('"id"') || val.includes('"email"'))) {
            r.hasToken = true;
            break;
          }
        }
        r.lsKeys = window.localStorage.length;

        // Avatar — any user profile image (broader selectors)
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
          const src = (img.src || '').toLowerCase();
          const alt = (img.alt || '').toLowerCase();
          // Common patterns for user avatars
          if (alt.includes('avatar') || alt.includes('user') || alt.includes('profile') ||
              src.includes('avatar') || src.includes('profile') || src.includes('user') ||
              src.includes('googleusercontent') || src.includes('lh3.google')) {
            r.hasAvatar = true;
            break;
          }
        }

        // Generate button visible — strong signal of logged-in state
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          if ((text.includes('generate') || text.includes('create')) && btn.offsetParent !== null) {
            r.hasGenerateBtn = true;
            break;
          }
        }

        // Sign-in link visible
        const sl = document.querySelector('a[href*="sign-in"], a[href*="login"], button[class*="sign"]');
        r.signInVisible = !!(sl && sl.offsetParent !== null);

        return r;
      });

      const timeout = new Promise(res => setTimeout(() => res(null), 5000));
      const ev = await Promise.race([evalPromise, timeout]);

      if (ev) {
        console.log('[chrome-manager] checkAuth DOM:', JSON.stringify(ev));
        if (ev.signInVisible && !ev.hasGenerateBtn) {
          return { connected: true, authenticated: false, url };
        }
        // Any strong signal → authenticated
        if (ev.hasToken || ev.hasAvatar || ev.hasGenerateBtn || ev.lsKeys > 5) {
          authenticated = true;
        }
      } else {
        console.log('[chrome-manager] checkAuth DOM: timeout');
      }
    } catch (e) {
      console.log('[chrome-manager] checkAuth DOM error:', e.message);
    }

    // ── Level 2: Cookie fallback ──
    if (!authenticated) {
      try {
        const client = await activePage.createCDPSession();
        const { cookies } = await client.send('Network.getAllCookies');
        const hfCookies = cookies.filter(c => c.domain.includes('higgsfield'));
        console.log(`[chrome-manager] checkAuth cookies: total=${cookies.length}, higgsfield=${hfCookies.length}`);
        if (hfCookies.length >= 3) authenticated = true;
        await client.detach().catch(() => {});
      } catch (e) {
        console.log('[chrome-manager] checkAuth cookie error:', e.message);
      }
    }

    console.log(`[chrome-manager] checkAuth → authenticated=${authenticated}`);
    return { connected: true, authenticated, url };
  } catch (err) {
    console.error('[chrome-manager] checkAuth fatal:', err.message);
    return { connected: false, authenticated: false, error: err.message };
  }
}

// ── Get Status ────────────────────────────────────────────────
async function getStatus() {
  const cdpStatus = await isCDPRunning();
  const session = loadSession();

  return {
    chromeRunning: cdpStatus.running,
    cdpConnected: !!browser,
    hasSession: !!session,
    sessionAge: session ? getSessionAge(session.savedAt) : null,
    cookieCount: session ? (session.cookies || []).length : 0,
  };
}

function getSessionAge(savedAt) {
  if (!savedAt) return null;
  const diff = Date.now() - new Date(savedAt).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'только что';
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

// ── Get Active Page ───────────────────────────────────────────
function getActivePage() {
  return activePage;
}

function getBrowser() {
  return browser;
}

// ── Navigate to Model Page ────────────────────────────────────
async function navigateToModel(modelId) {
  if (!activePage) throw new Error('Нет активной страницы');

  const url = `${HIGGSFIELD_URL}/image/${modelId}`;
  const currentUrl = activePage.url();

  if (currentUrl.includes(`/image/${modelId}`)) {
    console.log(`[chrome-manager] Already on model page: ${modelId}`);
    return; // Already on the right page
  }

  console.log(`[chrome-manager] Navigating to model: ${url}`);
  await activePage.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // Verify we landed on the right page (not redirected to sign-in)
  const landedUrl = activePage.url();
  console.log(`[chrome-manager] Landed on: ${landedUrl.substring(0, 80)}`);

  if (landedUrl.includes('sign-in') || landedUrl.includes('login') || landedUrl.includes('/auth')) {
    throw new Error('Higgsfield перенаправил на страницу входа. Войдите в аккаунт в Chrome.');
  }

  // Wait for prompt field to appear (page fully loaded) — up to 15s
  const PROMPT_SELECTORS = [
    'div[id="hf:tour-image-prompt"]',
    'div[role="textbox"][contenteditable="true"]',
  ];

  let promptFound = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    try {
      promptFound = await Promise.race([
        activePage.evaluate((sels) => {
          return sels.some(sel => !!document.querySelector(sel));
        }, PROMPT_SELECTORS),
        new Promise(res => setTimeout(() => res(false), 3000)),
      ]);
    } catch {
      promptFound = false;
    }
    if (promptFound) break;
  }

  if (!promptFound) {
    console.log('[chrome-manager] ⚠️ Prompt field not found after 15s — page may not be ready');
    throw new Error('Страница модели не загрузилась полностью. Поле промпта не найдено. Попробуйте перезапустить Chrome.');
  }

  console.log(`[chrome-manager] ✅ Model page ready: ${modelId}`);
}

// ── Cleanup ───────────────────────────────────────────────────
async function cleanup() {
  if (browser) {
    try { browser.disconnect(); } catch {}
    browser = null;
  }
  activePage = null;
  // Note: we don't kill Chrome — user might be using it
}

// ── Helpers ───────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Exports ───────────────────────────────────────────────────
module.exports = {
  launchChrome,
  connectCDP,
  saveSession,
  loadSession,
  applySession,
  checkAuth,
  getStatus,
  getActivePage,
  getBrowser,
  navigateToModel,
  cleanup,
  findChromePath,
  isCDPRunning,
  sleep,
  CDP_PORT,
  getSessionFile,
  HIGGSFIELD_URL,
};

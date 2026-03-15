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
const PROFILE_DIR = path.join(__dirname, '.chrome_profile');
const SESSION_FILE = path.join(__dirname, 'session.json');
const HIGGSFIELD_URL = 'https://higgsfield.ai';
const SIGNIN_URL = 'https://higgsfield.ai/sign-in';

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
  if (!fs.existsSync(PROFILE_DIR)) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  }

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
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

    // Find or create Higgsfield tab
    const pages = await browser.pages();
    activePage = pages.find(p => p.url().includes('higgsfield.ai'));

    if (!activePage && pages.length > 0) {
      activePage = pages[0];
    }

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

    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');

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
  if (!fs.existsSync(SESSION_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
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
    const url = activePage.url();
    const isSignIn = url.includes('sign-in');

    // Check if user is logged in by looking for user avatar or menu
    let isAuthenticated = false;
    if (!isSignIn) {
      try {
        isAuthenticated = await activePage.evaluate(() => {
          // Look for signs of being logged in
          const avatar = document.querySelector('[class*="avatar"], [class*="Avatar"], img[alt*="avatar"]');
          const userMenu = document.querySelector('[class*="user-menu"], [class*="userMenu"], [class*="profile"]');
          const signOut = document.querySelector('button:has-text("Sign Out"), a:has-text("Sign Out")');
          return !!(avatar || userMenu || signOut);
        });
      } catch {}
    }

    return {
      connected: true,
      authenticated: isAuthenticated || (!isSignIn && url.includes('higgsfield.ai')),
      url,
    };
  } catch (err) {
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
    return; // Already on the right page
  }

  await activePage.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000); // Wait for JS to initialize
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
  SESSION_FILE,
  HIGGSFIELD_URL,
};

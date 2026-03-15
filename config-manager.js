/* ============================================================
   CONFIG MANAGER
   Central management of paths and persistent settings.
   
   In packaged Electron apps, __dirname points inside the 
   read-only .app bundle. All mutable data must go through
   app.getPath('userData') or user-chosen directories.
   
   NOTE: All path resolution is LAZY — app.getPath() is only
   called when paths are first requested (after app.whenReady).
   ============================================================ */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// ── Lazy Path Resolution ──────────────────────────────────────
// app.getPath() only works after app.whenReady(), so we resolve
// paths lazily on first access.

let _appData = null;
let _defaultOutput = null;

function getAppData() {
  if (!_appData) {
    _appData = app.getPath('userData');
  }
  return _appData;
}

function getDefaultOutput() {
  if (!_defaultOutput) {
    _defaultOutput = path.join(app.getPath('documents'), 'Higgsfield Studio');
  }
  return _defaultOutput;
}

function getConfigFile() {
  return path.join(getAppData(), 'config.json');
}

// Default configuration (outputDir resolved lazily)
function getDefaults() {
  return {
    isFirstLaunch: true,
    outputDir: getDefaultOutput(),
    selectedModel: 'nano_banana_pro',
    selectedQuality: '2K',
    selectedRatio: '1:1',
    windowBounds: null,
  };
}

let _config = null;

// ── Load / Save ───────────────────────────────────────────────

function loadConfig() {
  if (_config) return _config;

  const appData = getAppData();
  const configFile = getConfigFile();

  // Ensure APP_DATA dir exists
  if (!fs.existsSync(appData)) {
    fs.mkdirSync(appData, { recursive: true });
  }

  if (fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile, 'utf-8');
      _config = { ...getDefaults(), ...JSON.parse(raw) };
    } catch {
      console.warn('[config] Failed to parse config.json, using defaults');
      _config = { ...getDefaults() };
    }
  } else {
    _config = { ...getDefaults() };
  }

  return _config;
}

function saveConfig() {
  if (!_config) return;

  const configFile = getConfigFile();
  const dir = path.dirname(configFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configFile, JSON.stringify(_config, null, 2), 'utf-8');
}

// ── Get / Set ─────────────────────────────────────────────────

function get(key) {
  const config = loadConfig();
  return key ? config[key] : { ...config };
}

function set(key, value) {
  const config = loadConfig();
  config[key] = value;
  saveConfig();
  return config[key];
}

// ── Path Helpers ──────────────────────────────────────────────

/** Path to session.json (cookies) — always in APP_DATA */
function getSessionPath() {
  return path.join(getAppData(), 'session.json');
}

/** Path to Chrome profile dir — always in APP_DATA */
function getChromeProfileDir() {
  return path.join(getAppData(), 'chrome_profile');
}

/** Current output directory (user-configured or default) */
function getOutputDir() {
  const config = loadConfig();
  return config.outputDir || getDefaultOutput();
}

/** Ensure output dir exists */
function ensureOutputDir() {
  const dir = getOutputDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Ensure Chrome profile dir exists */
function ensureChromeProfileDir() {
  const dir = getChromeProfileDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ── Exports ───────────────────────────────────────────────────
module.exports = {
  get,
  set,
  loadConfig,
  saveConfig,
  getSessionPath,
  getChromeProfileDir,
  getOutputDir,
  ensureOutputDir,
  ensureChromeProfileDir,
  get APP_DATA() { return getAppData(); },
  get DEFAULT_OUTPUT() { return getDefaultOutput(); },
  get CONFIG_FILE() { return getConfigFile(); },
};

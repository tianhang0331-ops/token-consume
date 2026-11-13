'use strict';

const { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, shell, Tray } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { Ledger } = require('../shared/ledger');
const { getProvider, hasProvider, listProviders } = require('../shared/providers');
const { createMeterProxy } = require('./proxy-server');
const { createPlatformSync } = require('./platform-sync');

const APP_NAME = 'Token Consume';
const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  port: 17862,
  budgetCny: 10,
  alwaysOnTop: true,
  syncIntervalSeconds: 60,
  platformSyncEnabled: false
};

app.setName(APP_NAME);
app.setAppUserModelId('com.tokenconsume.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let ledger = null;
let proxy = null;
let settings = { ...DEFAULT_SETTINGS };
let proxyError = '';
let platformReading = null;
let platformTimer = null;
let platformSyncBusy = false;
let isQuitting = false;

const platformSync = createPlatformSync({ logger: console });

function dataDir() {
  return process.env.TOKEN_CONSUME_DATA_DIR || app.getPath('userData');
}

function settingsPath() {
  return path.join(dataDir(), 'settings.json');
}

function ledgerPath() {
  return path.join(dataDir(), 'ledger.json');
}

function platformReadingPath() {
  return path.join(dataDir(), 'platform-reading.json');
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeSettings(raw = {}) {
  const provider = hasProvider(raw.provider) ? raw.provider : DEFAULT_SETTINGS.provider;
  return {
    provider,
    port: Math.round(clampNumber(raw.port, 1024, 65535, DEFAULT_SETTINGS.port)),
    budgetCny: Math.round(clampNumber(raw.budgetCny, 0, 1_000_000, DEFAULT_SETTINGS.budgetCny) * 100) / 100,
    alwaysOnTop: raw.alwaysOnTop !== false,
    syncIntervalSeconds: Math.round(
      clampNumber(raw.syncIntervalSeconds, 15, 3600, DEFAULT_SETTINGS.syncIntervalSeconds)
    ),
    platformSyncEnabled: raw.platformSyncEnabled === true
  };
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tempPath, filePath);
}

function proxyState() {
  const status = proxy ? proxy.getStatus() : { running: false, port: 0, baseUrl: '', stats: {} };
  return { ...status, error: proxyError };
}

function getState() {
  return {
    snapshot: ledger ? ledger.snapshot() : null,
    settings: { ...settings },
    proxy: proxyState(),
    platformReading,
    app: {
      name: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      dataDir: dataDir()
    },
    providers: listProviders()
  };
}

function publishState() {
  const state = getState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state:update', state);
  }
  updateTray(state.snapshot);
  return state;
}

function updateTray(snapshot) {
  if (!tray || tray.isDestroyed()) return;
  const today = snapshot && snapshot.today;
  const tokens = today ? today.totalTokens : 0;
  const cost = today ? today.costCny : 0;
  tray.setToolTip(`${APP_NAME} · ${Number(tokens).toLocaleString('zh-CN')} tokens · ¥${Number(cost).toFixed(2)}`);
}

async function handleUsage(event) {
  if (!ledger) return;
  await ledger.add(event);
  publishState();
}

async function saveSettings(next) {
  settings = sanitizeSettings(next);
  await writeJsonFile(settingsPath(), settings);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
  }
  schedulePlatformTimer();
  return settings;
}

function schedulePlatformTimer() {
  if (platformTimer) {
    clearInterval(platformTimer);
    platformTimer = null;
  }
  if (!settings.platformSyncEnabled) return;
  platformTimer = setInterval(() => {
    runPlatformSync(settings.provider).catch(() => {});
  }, settings.syncIntervalSeconds * 1000);
}

async function runPlatformSync(providerId) {
  if (platformSyncBusy) {
    return platformReading || { ok: false, error: '同步进行中' };
  }
  platformSyncBusy = true;
  try {
    const result = await platformSync.sync(providerId);
    platformReading = {
      providerId: result.providerId,
      providerName: result.providerName,
      url: result.url,
      capturedAt: result.capturedAt,
      ok: result.ok,
      error: result.error || '',
      metrics: result.metrics
    };
    await writeJsonFile(platformReadingPath(), platformReading);
    publishState();
    return platformReading;
  } finally {
    platformSyncBusy = false;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 640,
    minHeight: 520,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: settings.alwaysOnTop,
    title: APP_NAME,
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  if (!fs.existsSync(iconPath)) return;
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return;
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示 Token Consume',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        },
        {
          label: '同步官方用量页（实验性）',
          click: () => {
            runPlatformSync(settings.provider).catch(() => {});
          }
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ])
    );
    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (error) {
    console.warn('[tray] unavailable:', error.message);
  }
}

function registerIpc() {
  ipcMain.handle('app:state', () => getState());

  ipcMain.handle('settings:save', async (_event, patch) => {
    const previousPort = settings.port;
    await saveSettings({ ...settings, ...(patch || {}) });

    if (settings.port !== previousPort && proxy) {
      await proxy.stop();
      try {
        await proxy.start(settings.port);
        proxyError = '';
      } catch (error) {
        proxyError = error instanceof Error ? error.message : String(error);
      }
    }

    return publishState();
  });

  ipcMain.handle('usage:reset', async (_event, scope) => {
    try {
      await ledger.reset(scope === 'today' ? 'today' : 'all');
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return { ok: true, state: publishState() };
  });

  ipcMain.handle('platform:open-login', async (_event, providerId) => {
    return platformSync.openLogin(hasProvider(providerId) ? providerId : settings.provider);
  });

  ipcMain.handle('platform:sync', async (_event, providerId) => {
    return runPlatformSync(hasProvider(providerId) ? providerId : settings.provider);
  });

  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  ipcMain.handle('data:open-folder', async () => {
    await fsp.mkdir(dataDir(), { recursive: true });
    return shell.openPath(dataDir());
  });

  ipcMain.handle('shell:open-external', async (_event, url) => {
    const value = String(url || '');
    if (!/^https:\/\//i.test(value)) return false;
    await shell.openExternal(value);
    return true;
  });

  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window:close', () => {
    if (!mainWindow) return;
    if (tray) {
      mainWindow.hide();
    } else {
      isQuitting = true;
      app.quit();
    }
  });

  ipcMain.handle('window:set-always-on-top', async (_event, value) => {
    const next = Boolean(value);
    if (mainWindow) mainWindow.setAlwaysOnTop(next);
    await saveSettings({ ...settings, alwaysOnTop: next });
    publishState();
    return next;
  });
}

async function bootstrap() {
  await fsp.mkdir(dataDir(), { recursive: true });

  settings = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    ...(await readJsonFile(settingsPath(), {}))
  });

  platformReading = await readJsonFile(platformReadingPath(), null);

  ledger = new Ledger({ filePath: ledgerPath() });
  await ledger.load();

  proxy = createMeterProxy({
    getSettings: () => settings,
    onUsage: handleUsage,
    appVersion: app.getVersion()
  });

  try {
    await proxy.start(settings.port);
    proxyError = '';
  } catch (error) {
    proxyError = error instanceof Error ? error.message : String(error);
  }

  registerIpc();
  createMainWindow();
  createTray();
  updateTray(ledger.snapshot());
  schedulePlatformTimer();
}

if (gotLock) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    bootstrap().catch((error) => {
      console.error('[bootstrap]', error);
    });
  });
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else if (app.isReady()) {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (platformTimer) clearInterval(platformTimer);
  platformSync.closeAll();
  if (proxy) proxy.stop();
});

app.on('window-all-closed', () => {
  if (!tray) app.quit();
});

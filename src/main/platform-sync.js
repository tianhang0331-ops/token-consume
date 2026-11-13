'use strict';

const { BrowserWindow } = require('electron');
const { getProvider } = require('../shared/providers');
const { parseUsageText } = require('../shared/page-metrics');

const LOGIN_WINDOW_SIZE = { width: 1180, height: 820 };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function partitionFor(providerId) {
  return `persist:token-consume-${providerId}`;
}

/**
 * Experimental "official usage page" reader.
 *
 * The user signs in to the vendor dashboard inside a dedicated persistent
 * session. Token Consume then loads the same page with that session and reads
 * the visible text. Credentials never pass through our code.
 */
function createPlatformSync({ logger = console } = {}) {
  const loginWindows = new Map();

  function openLogin(providerId) {
    const provider = getProvider(providerId);
    const existing = loginWindows.get(provider.id);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return { ok: true, providerId: provider.id, url: provider.usageUrl };
    }

    const win = new BrowserWindow({
      ...LOGIN_WINDOW_SIZE,
      title: `${provider.name} · 登录`,
      autoHideMenuBar: true,
      webPreferences: {
        partition: partitionFor(provider.id),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    win.loadURL(provider.usageUrl).catch((error) => {
      logger.warn('[platform] failed to load login page:', error.message);
    });
    win.on('closed', () => loginWindows.delete(provider.id));
    loginWindows.set(provider.id, win);

    return { ok: true, providerId: provider.id, url: provider.usageUrl };
  }

  async function sync(providerId, { settleMs = 3500, timeoutMs = 30000 } = {}) {
    const provider = getProvider(providerId);
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: partitionFor(provider.id),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    try {
      await Promise.race([
        win.loadURL(provider.usageUrl),
        delay(timeoutMs).then(() => {
          throw new Error('打开官方用量页超时');
        })
      ]);

      // Single page apps render after load; give them a moment to settle.
      await delay(settleMs);

      const text = await win.webContents.executeJavaScript(
        'document.body ? document.body.innerText : ""',
        true
      );
      const metrics = parseUsageText(text);

      return {
        ok: true,
        providerId: provider.id,
        providerName: provider.name,
        url: win.webContents.getURL() || provider.usageUrl,
        capturedAt: new Date().toISOString(),
        metrics
      };
    } catch (error) {
      return {
        ok: false,
        providerId: provider.id,
        providerName: provider.name,
        url: provider.usageUrl,
        capturedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        metrics: { totalTokens: 0, costCny: 0, model: '', hasMetrics: false, needsLogin: false }
      };
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }

  function closeAll() {
    for (const win of loginWindows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    loginWindows.clear();
  }

  return { openLogin, sync, closeAll };
}

module.exports = { createPlatformSync };

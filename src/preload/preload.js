'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tokenConsume', {
  getState: () => ipcRenderer.invoke('app:state'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  resetUsage: (scope) => ipcRenderer.invoke('usage:reset', scope),
  openLogin: (providerId) => ipcRenderer.invoke('platform:open-login', providerId),
  syncPlatform: (providerId) => ipcRenderer.invoke('platform:sync', providerId),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('window:set-always-on-top', value),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:update', listener);
    return () => ipcRenderer.removeListener('state:update', listener);
  }
});

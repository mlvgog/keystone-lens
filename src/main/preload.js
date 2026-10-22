'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listSpecs: () => ipcRenderer.invoke('specs:list'),
  analyze: (opts, { force = false, allowStale = false } = {}) => ipcRenderer.invoke('analyze:start', opts, { force, allowStale }),
  analyzeCached: (opts) => ipcRenderer.invoke('analyze:cached', opts),
  cancel: () => ipcRenderer.invoke('analyze:cancel'),
  onProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('analyze:progress', handler);
    return () => ipcRenderer.removeListener('analyze:progress', handler);
  },
  view: (filters) => ipcRenderer.invoke('view:get', filters),
  loadDungeon: (zoneId, filters) => ipcRenderer.invoke('dungeon:load', zoneId, filters),
  playerDetail: (index, dungeon) => ipcRenderer.invoke('player:detail', { index, dungeon }),
  describeItems: (variants) => ipcRenderer.invoke('items:describe', variants),
  loadCharacter: (who) => ipcRenderer.invoke('character:load', who),
  importSimc: (text, opts) => ipcRenderer.invoke('character:import', text, opts),
  historyList: () => ipcRenderer.invoke('history:list'),
  realms: (region) => ipcRenderer.invoke('realms:list', region),
  devStats: () => ipcRenderer.invoke('dev:stats'),
  devReset: () => ipcRenderer.invoke('dev:reset'),
  devOpenDevTools: () => ipcRenderer.invoke('dev:openDevTools'),
  devOpenFolder: () => ipcRenderer.invoke('dev:openFolder'),
  exportImage: (rect, mode, name) => ipcRenderer.invoke('export:image', { rect, mode, name }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  wclTest: () => ipcRenderer.invoke('wcl:test'),
  throughput: (params) => ipcRenderer.invoke('throughput:get', params),
  cancelThroughput: () => ipcRenderer.invoke('throughput:cancel'),
  cacheInfo: () => ipcRenderer.invoke('cache:info'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
});

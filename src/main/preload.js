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
  itemTooltip: (variant, { english = false } = {}) => ipcRenderer.invoke('tooltip:item', variant, { english }),
  spellTooltip: (spellId) => ipcRenderer.invoke('tooltip:spell', spellId),
  loadCharacter: (who) => ipcRenderer.invoke('character:load', who),
  historyList: () => ipcRenderer.invoke('history:list'),
  exportImage: (rect, mode, name) => ipcRenderer.invoke('export:image', { rect, mode, name }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  cacheInfo: () => ipcRenderer.invoke('cache:info'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
});

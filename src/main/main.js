'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, ClipboardItem, session: electronSession } = require('electron');
const cache = require('./cache');
const stats = require('./stats');
const settings = require('./settings');
const history = require('./history');
const raidbots = require('./sources/raidbots');
const raiderio = require('./sources/raiderio');
const wowhead = require('./sources/wowhead');
const { buildClassList } = require('./specs');
const { analyze, loadDungeon } = require('./collector');
const { buildView, playerDetail } = require('./views');

const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
const EXTERNAL_HOSTS = new Set([
  'raider.io',
  'www.raider.io',
  'www.wowhead.com',
  'wowhead.com',
  'www.warcraftlogs.com',
  'worldofwarcraft.blizzard.com',
]);
const LOCALE_IDS = wowhead.LOCALES.map((l) => l.id);
// Which data source each cache kind holds (for the developer menu).
const KIND_SOURCE = {
  run: 'raider.io',
  rankings: 'raider.io',
  profile: 'raider.io',
  character: 'raider.io',
  season: 'raider.io',
  realms: 'raider.io',
  itemTooltip: 'Wowhead',
  spellTooltip: 'Wowhead',
  itemSource: 'Wowhead',
  talents: 'raidbots',
  analysis: 'Analyses (built locally)',
};
const EMPTY_TOTALS = { requests: 0, bytes: 0, errors: 0, retries: 0, ms: 0, avgMs: 0 };
const ICON_SOURCE = 'Icons (CDN)';
const ICON_URLS = ['https://wow.zamimg.com/*', 'https://cdn.raiderio.net/*'];

/** Count icon downloads made by the page (they bypass our http module). */
function trackIconDownloads() {
  const started = new Map();
  const { webRequest } = electronSession.defaultSession;
  webRequest.onSendHeaders({ urls: ICON_URLS }, (d) => started.set(d.id, d.timestamp));
  webRequest.onCompleted({ urls: ICON_URLS }, (d) => {
    const t0 = started.get(d.id);
    started.delete(d.id);
    if (d.fromCache) return;
    const header = Object.entries(d.responseHeaders || {}).find(([k]) => k.toLowerCase() === 'content-length');
    stats.recordRequest({ url: d.url, status: d.statusCode, bytes: Number(header?.[1]?.[0]) || 0, ms: t0 ? d.timestamp - t0 : 0, log: false });
  });
  webRequest.onErrorOccurred({ urls: ICON_URLS }, (d) => started.delete(d.id));
}

let win = null;
let current = null; // AbortController of the running analysis / dungeon load
let session = null; // the analysis currently shown

function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    frame: false,
    backgroundColor: '#07070a',
    title: 'M+ Talent & Gear Inspector',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());

  // Never navigate away from the app or open new windows inside it.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.host)) shell.openExternal(u.toString());
  } catch {
    // ignore malformed URLs
  }
}

function startTask() {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  return controller;
}

function finishTask(controller) {
  if (current === controller) current = null;
}

function viewDeps() {
  const key = session ? history.keyFor(session.meta) : null;
  return {
    getTooltip: (variant) => wowhead.getItemTooltip(variant),
    getEnglishTooltip: wowhead.getLocale() !== 0 ? (variant) => wowhead.getItemTooltip(variant, { locale: 0 }) : null,
    getSnapshot: (id) => (key ? history.get(key, id) : null),
  };
}

function failure(err) {
  if (err?.name === 'AbortError') return { ok: false, cancelled: true };
  return { ok: false, error: err?.message || String(err) };
}

ipcMain.handle('specs:list', async () => buildClassList(await raidbots.getTalentData()));

ipcMain.handle('analyze:start', async (event, opts, { force = false, allowStale = false } = {}) => {
  const controller = startTask();
  try {
    const res = await analyze(opts, {
      signal: controller.signal,
      force,
      allowStale,
      onProgress: (p) => {
        if (!event.sender.isDestroyed() && current === controller) event.sender.send('analyze:progress', p);
      },
    });
    session = res.session;
    const view = await buildView(session, {}, viewDeps());
    if (!res.fromCache) await history.save(history.keyFor(session.meta), history.snapshotOf(view, session.meta));
    return { ok: true, result: { meta: session.meta, tree: session.tree, dungeonsLoaded: session.dungeonsLoaded || [], fromCache: res.fromCache, view } };
  } catch (err) {
    return failure(err);
  } finally {
    finishTask(controller);
  }
});

/** Like analyze:start with allowStale, but never touches the network: null when nothing is cached. */
ipcMain.handle('analyze:cached', async (_e, opts) => {
  try {
    const res = await analyze(opts, { allowStale: true, cacheOnly: true });
    if (!res) return { ok: false };
    session = res.session;
    const view = await buildView(session, {}, viewDeps());
    return { ok: true, result: { meta: session.meta, tree: session.tree, dungeonsLoaded: session.dungeonsLoaded || [], fromCache: true, view } };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('analyze:cancel', () => {
  current?.abort();
  current = null;
});

ipcMain.handle('view:get', async (_e, filters) => {
  if (!session) return failure(new Error('No analysis loaded'));
  try {
    return { ok: true, view: await buildView(session, filters, viewDeps()) };
  } catch (err) {
    return failure(err);
  }
});

ipcMain.handle('dungeon:load', async (event, zoneId, filters) => {
  if (!session) return failure(new Error('No analysis loaded'));
  const controller = startTask();
  try {
    await loadDungeon(session, zoneId, {
      signal: controller.signal,
      onProgress: (p) => {
        if (!event.sender.isDestroyed() && current === controller) event.sender.send('analyze:progress', p);
      },
    });
    const view = await buildView(session, { ...filters, dungeon: zoneId }, viewDeps());
    return { ok: true, view, dungeonsLoaded: session.dungeonsLoaded };
  } catch (err) {
    return failure(err);
  } finally {
    finishTask(controller);
  }
});

ipcMain.handle('player:detail', (_e, { index, dungeon }) => (session ? playerDetail(session, index, dungeon) : null));

ipcMain.handle('tooltip:item', async (_e, variant, { english = false } = {}) => {
  try {
    return await wowhead.getItemTooltip(variant, english ? { locale: 0 } : {});
  } catch {
    return null;
  }
});

ipcMain.handle('tooltip:spell', async (_e, spellId) => {
  try {
    return await wowhead.getSpellTooltip(Number(spellId));
  } catch {
    return null;
  }
});

ipcMain.handle('character:load', async (_e, { region, realm, name, force = false }) => {
  try {
    return { ok: true, character: await raiderio.getCharacter({ region, realm, name }, { force }) };
  } catch (err) {
    return failure(err);
  }
});

ipcMain.handle('realms:list', async (_e, region) => {
  try {
    return await raiderio.getRealms(region);
  } catch {
    return [];
  }
});

ipcMain.handle('dev:stats', async () => {
  const snap = stats.snapshot();
  const kinds = await cache.infoByKind();
  const disk = {};
  for (const [kind, info] of Object.entries(kinds)) {
    const source = KIND_SOURCE[kind] || 'Other';
    disk[source] ||= { bytes: 0, files: 0 };
    disk[source].bytes += info.bytes;
    disk[source].files += info.files;
  }
  // Icons live in Chromium's own cache folder.
  const iconDisk = await cache.dirSize(path.join(app.getPath('userData'), 'Cache'));
  disk[ICON_SOURCE] = iconDisk;
  kinds.browserCache = iconDisk;
  const names = new Set(['raider.io', 'Wowhead', 'raidbots', ICON_SOURCE, ...Object.keys(snap.session), ...Object.keys(snap.lifetime), ...Object.keys(disk)]);
  return {
    sources: [...names].map((source) => ({
      source,
      session: snap.session[source] || EMPTY_TOTALS,
      lifetime: snap.lifetime[source] || EMPTY_TOTALS,
      disk: disk[source] || { bytes: 0, files: 0 },
    })),
    lifetimeSince: snap.lifetimeSince,
    kinds: Object.entries(kinds)
      .map(([kind, info]) => ({ kind, source: kind === 'browserCache' ? ICON_SOURCE : KIND_SOURCE[kind] || 'Other', ...info, ...(snap.cache[kind] || { hits: 0, misses: 0 }) }))
      .sort((a, b) => b.bytes - a.bytes),
    recent: snap.recent,
    userData: app.getPath('userData'),
    versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  };
});

ipcMain.handle('dev:reset', () => stats.resetLifetime());
ipcMain.handle('dev:openDevTools', () => win?.webContents.openDevTools({ mode: 'detach' }));
ipcMain.handle('dev:openFolder', () => shell.openPath(app.getPath('userData')));

ipcMain.handle('history:list', async () => {
  if (!session) return [];
  const all = await history.list(history.keyFor(session.meta));
  return all.filter((s) => s.id !== session.meta.generatedAt);
});

ipcMain.handle('export:image', async (_e, { rect, mode, name }) => {
  if (!win) return { ok: false };
  const r = {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
  };
  const image = await win.webContents.capturePage(r);
  if (mode === 'copy') {
    // Electron 44 clipboard API: write() takes ClipboardItems (W3C style).
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]);
    return { ok: true };
  }
  const safeName = String(name || 'talents').replace(/[^\w\- ]+/g, '').trim() || 'talents';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save talent tree image',
    defaultPath: path.join(app.getPath('pictures'), `${safeName}.png`),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (canceled || !filePath) return { ok: false, cancelled: true };
  await fs.promises.writeFile(filePath, image.toPNG());
  return { ok: true, filePath };
});

ipcMain.handle('settings:get', () => ({ settings: settings.get(), locales: wowhead.LOCALES }));

ipcMain.handle('settings:set', (_e, patch) => {
  const next = settings.set(patch, LOCALE_IDS);
  wowhead.setLocale(next.tooltipLocale);
  return next;
});

ipcMain.handle('cache:info', () => cache.info());
ipcMain.handle('cache:clear', async () => {
  await cache.clear();
  await electronSession.defaultSession.clearCache(); // icons
  return cache.info();
});

ipcMain.handle('clipboard:write', async (_e, text) => {
  await clipboard.writeText(String(text || ''));
  return true;
});

ipcMain.handle('open:external', (_e, url) => openExternal(url));

ipcMain.handle('window:control', (_e, action) => {
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
  else if (action === 'close') win.close();
});

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  cache.init(userData);
  history.init(userData);
  stats.init(userData);
  trackIconDownloads();
  wowhead.setLocale(settings.init(userData, LOCALE_IDS).tooltipLocale);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => stats.flush());

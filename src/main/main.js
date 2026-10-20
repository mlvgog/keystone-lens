'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, ClipboardItem } = require('electron');
const cache = require('./cache');
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
  wowhead.setLocale(settings.init(userData, LOCALE_IDS).tooltipLocale);
  createWindow();
});

app.on('window-all-closed', () => app.quit());

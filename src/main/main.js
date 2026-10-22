'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, ClipboardItem, safeStorage, session: electronSession } = require('electron');

// The app was called "M+ Talent & Gear Inspector" before; move its data (cache, settings,
// history, saved searches) to the new data folder once. Electron may already have created
// the new folder by now, so its contents are moved entry by entry. Runs before app ready.
const LEGACY_DATA_DIR = path.join(app.getPath('appData'), 'M+ Talent & Gear Inspector');
const OWN_DATA = ['settings.json', 'data-cache', 'history', 'stats.json'];
function migrateLegacyData() {
  const dataDir = app.getPath('userData');
  if (dataDir === LEGACY_DATA_DIR || !fs.existsSync(LEGACY_DATA_DIR)) return;
  if (OWN_DATA.some((f) => fs.existsSync(path.join(dataDir, f)))) return; // already in use
  fs.mkdirSync(dataDir, { recursive: true });
  for (const entry of fs.readdirSync(LEGACY_DATA_DIR)) {
    const to = path.join(dataDir, entry);
    if (fs.existsSync(to)) continue;
    try {
      fs.renameSync(path.join(LEGACY_DATA_DIR, entry), to);
    } catch {
      // leave it in the old folder
    }
  }
  try {
    fs.rmdirSync(LEGACY_DATA_DIR); // only succeeds when everything moved
  } catch {
    // something stayed behind; harmless
  }
}
try {
  migrateLegacyData();
} catch {
  // the app starts with fresh data; the old folder is left untouched
}

const cache = require('./cache');
const stats = require('./stats');
const settings = require('./settings');
const history = require('./history');
const talentTrees = require('./sources/talentTrees');
const itemData = require('./sources/itemData');
const raiderio = require('./sources/raiderio');
const wowhead = require('./sources/wowhead');
const wcl = require('./sources/wcl');
const { buildClassList } = require('./specs');
const { analyze, loadDungeon } = require('./collector');
const { buildView, playerDetail } = require('./views');
const throughput = require('./throughput');
const { classifySource } = require('./itemInfo');
const { importSimcCharacter } = require('./simcImport');

const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
const EXTERNAL_HOSTS = new Set([
  'raider.io',
  'www.raider.io',
  'www.wowhead.com',
  'wowhead.com',
  'www.warcraftlogs.com',
  'worldofwarcraft.blizzard.com',
  'github.com',
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
  itemSource: 'Wowhead',
  talents: 'wago.tools',
  itemData: 'wago.tools',
  itemBonus: 'wago.tools',
  gameTables: 'wago.tools',
  wclZone: 'Warcraft Logs',
  wclRankings: 'Warcraft Logs',
  wclCharacter: 'Warcraft Logs',
  analysis: 'Analyses (built locally)',
};
const EMPTY_TOTALS = { requests: 0, bytes: 0, errors: 0, retries: 0, ms: 0, avgMs: 0 };
const ICON_SOURCE = 'Icons (CDN)';
// Requests made by the page itself: icons, and Wowhead's tooltips script with its data.
const PAGE_URLS = ['https://cdn.raiderio.net/*', 'https://render.worldofwarcraft.com/*', 'https://wow.zamimg.com/*', 'https://nether.wowhead.com/*'];

/** Count downloads made by the page (they bypass our http module). */
function trackIconDownloads() {
  const started = new Map();
  const { webRequest } = electronSession.defaultSession;
  webRequest.onSendHeaders({ urls: PAGE_URLS }, (d) => started.set(d.id, d.timestamp));
  webRequest.onCompleted({ urls: PAGE_URLS }, (d) => {
    const t0 = started.get(d.id);
    started.delete(d.id);
    if (d.fromCache) return;
    const header = Object.entries(d.responseHeaders || {}).find(([k]) => k.toLowerCase() === 'content-length');
    stats.recordRequest({ url: d.url, status: d.statusCode, bytes: Number(header?.[1]?.[0]) || 0, ms: t0 ? d.timestamp - t0 : 0, log: false });
  });
  webRequest.onErrorOccurred({ urls: PAGE_URLS }, (d) => started.delete(d.id));
}

let win = null;
let current = null; // AbortController of the running analysis / dungeon load
let session = null; // the analysis currently shown
let throughputTask = null; // AbortController of the running Warcraft Logs load

function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    frame: false,
    backgroundColor: '#07070a',
    title: 'Keystone Lens',
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
  return { getSnapshot: (id) => (key ? history.get(key, id) : null) };
}

function failure(err) {
  if (err?.name === 'AbortError') return { ok: false, cancelled: true };
  return { ok: false, error: err?.message || String(err) };
}

ipcMain.handle('specs:list', async () => buildClassList(await talentTrees.getTalentData()));

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

/**
 * Details of item variants outside the current session (your character's gear):
 * [{ id, bonuses, ilvl }] -> [{ stats, primary, stamina, sockets, embellished, slotType, source }].
 */
ipcMain.handle('items:describe', async (_e, variants = []) => {
  try {
    const list = variants.slice(0, 40).map((v, i) => ({ key: String(i), id: Number(v.id), bonuses: (v.bonuses || []).map(Number), ilvl: Number(v.ilvl) }));
    const [described, xml] = await Promise.all([itemData.describeVariants(list, {}), Promise.all(list.map((v) => wowhead.getItemXml(v.id)))]);
    return list.map((v, i) => ({
      ...(described[v.key] || {}),
      slotType: xml[i].slotType,
      source: session ? classifySource({ src: xml[i], boss: xml[i].droppedBy, seasonDungeons: session.meta.dungeons, raids: [] }) : null,
    }));
  } catch {
    return [];
  }
});

ipcMain.handle('character:load', async (_e, { region, realm, name, force = false }) => {
  try {
    return { ok: true, character: await raiderio.getCharacter({ region, realm, name }, { force }) };
  } catch (err) {
    return failure(err);
  }
});

/** Your character from a pasted SimulationCraft export (`loadout`: 0 = active talents, 1.. = saved). */
ipcMain.handle('character:import', async (_e, text, { loadout = 0 } = {}) => {
  try {
    return { ok: true, character: await importSimcCharacter(String(text || '').slice(0, 100000), { loadout: Number(loadout) || 0 }) };
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
  const names = new Set(['raider.io', 'Wowhead', 'wago.tools', 'SimulationCraft', ICON_SOURCE, ...Object.keys(snap.session), ...Object.keys(snap.lifetime), ...Object.keys(disk)]);
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

// The Warcraft Logs secret never leaves the main process.
ipcMain.handle('settings:get', () => ({ settings: settings.getPublic(), locales: wowhead.LOCALES, version: app.getVersion() }));

ipcMain.handle('settings:set', (_e, patch) => {
  settings.set(patch, LOCALE_IDS);
  if ('wclClientId' in patch || 'wclClientSecret' in patch) wcl.forgetToken();
  return settings.getPublic();
});

const MAX_LEVELS = 15;

/** Damage / healing per dungeon from Warcraft Logs for the current spec (plus your own runs). */
ipcMain.handle('throughput:get', async (event, params = {}) => {
  if (!session) return failure(new Error('No analysis loaded'));
  if (!wcl.hasCredentials()) return { ok: false, code: 'WCL_NO_CREDENTIALS' };
  throughputTask?.abort();
  const controller = new AbortController();
  throughputTask = controller;
  const { signal } = controller;
  const emit = (p) => {
    if (!event.sender.isDestroyed() && throughputTask === controller) event.sender.send('analyze:progress', { kind: 'throughput', ...p });
  };
  try {
    const { meta } = session;
    const metric = params.metric === 'hps' ? 'hps' : 'dps';
    const groupBy = params.groupBy === 'ilvl' ? 'ilvl' : 'level';
    emit({ overall: 0, phase: 'Finding the M+ season on Warcraft Logs', done: 0, total: 0 });
    const zone = await wcl.getMplusZone({ signal });
    const dungeons = meta.dungeons
      .map((d) => {
        const e = zone.encounters.find((x) => throughput.sameDungeon(x.name, d.name));
        return e ? { id: e.id, name: d.name } : null;
      })
      .filter(Boolean);

    // Your runs first: they can widen the default key-level range.
    let you = null;
    if (params.character?.name && params.character?.realm) {
      const c = params.character;
      emit({ overall: 0.05, phase: `Loading ${c.name}'s logs`, done: 0, total: 0 });
      try {
        const res = await wcl.getCharacterRuns(
          { name: c.name, realmSlug: raiderio.slugifyRealm(c.realm), region: c.region, encounters: dungeons, specName: meta.specName, metric },
          { signal, force: params.force }
        );
        you = { name: c.name, found: res.found, runs: res.runs };
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        you = { name: c.name, found: false, error: err.message };
      }
    }

    let { from, to } =
      params.from && params.to
        ? params
        : throughput.defaultLevels(
            session.players.map((p) => p.main.run.level),
            you?.found ? Object.values(you.runs).flat().map((r) => r.level) : []
          );
    from = Math.max(2, Math.min(40, Number(from) || 2));
    to = Math.max(from, Math.min(from + MAX_LEVELS - 1, Number(to) || from));
    const levels = Array.from({ length: to - from + 1 }, (_, i) => from + i);

    const runs = {};
    const missing = []; // dungeons that could not be loaded (Warcraft Logs limit reached)
    let limitError = null;
    let done = 0;
    const phase = groupBy === 'ilvl' ? 'Loading logged runs with gear' : 'Loading logged runs';
    emit({ overall: 0.1, phase, done, total: dungeons.length });
    await Promise.all(
      dungeons.map(async (d) => {
        try {
          runs[d.id] = await wcl.getSpecRuns(
            {
              encounterId: d.id,
              className: meta.className,
              specName: meta.specName,
              metric,
              levels,
              withGear: groupBy === 'ilvl',
              averageItemLevel: throughput.averageItemLevel,
            },
            { signal, force: params.force }
          );
        } catch (err) {
          if (err.code !== 'WCL_LIMIT') throw err;
          limitError = err;
          missing.push(d.name);
          runs[d.id] = {};
        }
        done++;
        emit({ overall: 0.1 + 0.9 * (done / dungeons.length), phase, done, total: dungeons.length, label: d.name });
      })
    );

    let rate = null;
    try {
      rate = await wcl.rateLimit({ signal });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
    if (missing.length === dungeons.length) {
      return { ok: false, code: 'WCL_LIMIT', error: limitError.message, resetIn: rate?.pointsResetIn ?? null };
    }
    return {
      ok: true,
      data: {
        missing,
        resetIn: missing.length ? rate?.pointsResetIn ?? null : null,
        metric,
        groupBy,
        from,
        to,
        levels,
        zone: { id: zone.id, name: zone.name },
        table: throughput.buildTable({ dungeons, runs, levels, groupBy }),
        you: you && {
          name: you.name,
          found: you.found,
          error: you.error || null,
          dungeons: you.found
            ? throughput.compareYou({ dungeons, runs, yourRuns: you.runs, levels, self: { name: params.character.name, realm: params.character.realm } })
            : null,
        },
        rate,
      },
    };
  } catch (err) {
    if (['WCL_NO_CREDENTIALS', 'WCL_BAD_CREDENTIALS', 'WCL_LIMIT'].includes(err.code)) return { ok: false, code: err.code, error: err.message };
    return failure(err);
  } finally {
    if (throughputTask === controller) throughputTask = null;
  }
});

ipcMain.handle('throughput:cancel', () => {
  throughputTask?.abort();
  throughputTask = null;
});

ipcMain.handle('wcl:test', async () => {
  try {
    return { ok: true, limits: await wcl.testConnection() };
  } catch (err) {
    return failure(err);
  }
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

/** Encrypts the Warcraft Logs secret for the current Windows user (DPAPI via safeStorage). */
function secretVault() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  return {
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
  };
}

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
  settings.init(userData, LOCALE_IDS, { vault: secretVault() });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => stats.flush());

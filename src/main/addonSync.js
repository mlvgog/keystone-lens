'use strict';

/**
 * Keeps the game addon's data up to date:
 * - every Mythic+ analysis you run is added to the addon's data (one record per spec);
 * - the specs of your characters (saved by the addon) are refreshed in the background when
 *   their data is over a day old, one at a time, and paused while you run your own searches;
 * - the bundled addon can be installed or updated in the game folder.
 * Records are kept in userData/addon-data.json, so the data folder can always be rewritten.
 */

const fs = require('fs');
const path = require('path');
const wow = require('./wow');
const { specRecord, writeDataAddon } = require('./addonExport');
const { slugifyRealm } = require('./sources/raiderio');

const STORE_FILE = 'addon-data.json';
const STALE_SECONDS = 24 * 60 * 60;
const START_DELAY_MS = 30 * 1000;
const RESUME_DELAY_MS = 60 * 1000;

/** The addon writes realm slugs with plain-ASCII rules; use the app's (raider.io) slug instead. */
function withServerSlug(simc, realm) {
  if (!realm) return simc;
  return String(simc).replace(/^server=.*$/m, `server=${slugifyRealm(realm)}`);
}

/**
 * deps:
 * - userData: folder for addon-data.json
 * - settings: { get(), set(patch) } (wowPath, addonSync, defaultRegion, defaultSize)
 * - bundledAddonDir: the addon that ships with the app
 * - appVersion
 * - specOptions(specId) -> analyze() options for a spec, or null
 * - analyze(opts, { signal }) -> { session }; loadDungeon(session, zoneId, { signal })
 * - onStatus(status): called when something visible changes
 * - findWowFolder, setTimeout, clearTimeout: injectable for tests
 */
function createAddonSync(deps) {
  const {
    userData,
    settings,
    bundledAddonDir,
    appVersion,
    specOptions,
    analyze,
    loadDungeon,
    onStatus = () => {},
    findWowFolder = wow.findWowFolder,
    setTimeout: setTimer = setTimeout,
    clearTimeout: clearTimer = clearTimeout,
  } = deps;
  const storeFile = path.join(userData, STORE_FILE);

  let records = {};
  let characters = [];
  let addon = { installed: null, bundled: null, action: null };
  let syncing = null; // { specId, label } while a background refresh runs
  let lastError = null;
  let controller = null;
  let timer = null;
  let paused = false;
  let writeQueue = Promise.resolve();

  const wowPath = () => settings.get().wowPath || null;

  function status() {
    return {
      wowPath: wowPath(),
      addon,
      autoRefresh: settings.get().addonSync !== false,
      characters: characters.map(({ simc, ...c }) => c),
      specs: Object.values(records)
        .map((r) => ({
          specId: r.specId,
          className: r.class,
          specName: r.spec,
          region: r.region,
          sample: r.sample,
          time: r.time,
          dungeons: Object.keys(r.dungeons || {}).length,
          dungeonCount: (r.dungeonList || []).length,
        }))
        .sort((a, b) => `${a.className} ${a.specName}`.localeCompare(`${b.className} ${b.specName}`)),
      syncing,
      lastError,
    };
  }
  const changed = () => onStatus(status());

  async function loadStore() {
    try {
      const saved = JSON.parse(await fs.promises.readFile(storeFile, 'utf8'));
      records = saved && typeof saved.specs === 'object' ? saved.specs : {};
    } catch {
      records = {};
    }
  }

  async function saveStore() {
    const tmp = `${storeFile}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify({ specs: records }));
    await fs.promises.rename(tmp, storeFile);
  }

  /** Rewrite the game's data folder (when the game folder is known and the addon installed). */
  function writeData() {
    writeQueue = writeQueue.then(async () => {
      const retail = wowPath();
      if (!retail || !addon.installed) return false;
      try {
        await writeDataAddon(wow.addonsDir(retail), records, { appVersion });
        lastError = null;
        return true;
      } catch (err) {
        lastError = `Could not write the addon data: ${err.message}`;
        return false;
      } finally {
        changed();
      }
    });
    return writeQueue;
  }

  async function refreshGame() {
    const retail = wowPath();
    addon = await wow.addonStatus(retail, bundledAddonDir);
    characters = retail ? await wow.readAddonCharacters(retail) : [];
  }

  /** Load saved data, find the game folder if none is set, and plan the first background refresh. */
  async function init() {
    await loadStore();
    if (!wowPath()) {
      const found = await findWowFolder().catch(() => null);
      if (found) settings.set({ wowPath: found });
    }
    await refreshGame();
    changed();
    schedule(START_DELAY_MS);
  }

  /** Use a folder the user picked (the game folder or any folder in it). */
  async function setWowPath(picked) {
    const retail = wow.normalizeWowFolder(picked);
    if (!retail) throw new Error('That is not a World of Warcraft folder. Pick the "World of Warcraft" folder or its "_retail_" folder.');
    settings.set({ wowPath: retail });
    await refreshGame();
    await writeData();
    schedule(START_DELAY_MS);
    return status();
  }

  async function installAddon() {
    const retail = wowPath();
    if (!retail) throw new Error('Choose your World of Warcraft folder first.');
    await wow.installAddon(retail, bundledAddonDir);
    await refreshGame();
    await writeData();
    return status();
  }

  /** Re-read the game folder: addon version and the characters the addon saved. */
  async function rescan() {
    await refreshGame();
    changed();
    schedule(0);
    return status();
  }

  /** Add (or replace) the record of an analysed Mythic+ spec and rewrite the data. */
  async function recordSession(session) {
    if (!session || session.meta?.mode === 'raid') return false;
    try {
      records[session.meta.specId] = await specRecord(session);
      await saveStore();
    } catch (err) {
      lastError = `Could not prepare the addon data: ${err.message}`;
      changed();
      return false;
    }
    return writeData();
  }

  async function removeSpec(specId) {
    delete records[specId];
    await saveStore();
    await writeData();
    return status();
  }

  /** Specs of your characters whose data is missing or over a day old. */
  function staleSpecs(nowSeconds = Math.floor(Date.now() / 1000)) {
    const seen = new Set();
    const out = [];
    for (const c of characters) {
      if (!c.specId || seen.has(c.specId)) continue;
      seen.add(c.specId);
      const r = records[c.specId];
      if (!r || !r.time || nowSeconds - r.time > STALE_SECONDS || Object.keys(r.dungeons || {}).length < (r.dungeonList || []).length) out.push(c.specId);
    }
    return out;
  }

  async function refreshSpec(specId, signal) {
    const opts = await specOptions(specId);
    if (!opts) return;
    syncing = { specId, label: `${opts.specName} ${opts.className}` };
    changed();
    const { session } = await analyze(opts, { signal });
    for (const d of session.meta.dungeons) {
      if (signal.aborted) return;
      syncing = { specId, label: `${opts.specName} ${opts.className} · ${d.name}` };
      changed();
      await loadDungeon(session, d.id, { signal });
    }
    await recordSession(session);
  }

  /** Refresh stale specs of your characters, one after the other. */
  async function runBackground() {
    if (controller || paused || settings.get().addonSync === false || !wowPath() || !addon.installed) return;
    const todo = staleSpecs();
    if (!todo.length) return;
    controller = new AbortController();
    const { signal } = controller;
    try {
      for (const specId of todo) {
        if (signal.aborted) break;
        await refreshSpec(specId, signal);
      }
      lastError = null;
    } catch (err) {
      if (err?.name !== 'AbortError') lastError = `Background refresh stopped: ${err.message}`;
    } finally {
      controller = null;
      syncing = null;
      changed();
    }
  }

  function schedule(ms) {
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      runBackground();
    }, ms);
  }

  /** Your own search is starting: stop the background refresh until it is done. */
  function pause() {
    paused = true;
    controller?.abort();
    if (timer) clearTimer(timer);
    timer = null;
  }

  /** Your search is done: continue the background refresh a little later. */
  function resume() {
    paused = false;
    schedule(RESUME_DELAY_MS);
  }

  /** Characters for "Compare with my character", with their SimulationCraft text. */
  function addonCharacters() {
    return characters.map((c) => ({ ...c, simc: withServerSlug(c.simc, c.realm) }));
  }

  return { init, status, setWowPath, installAddon, rescan, recordSession, removeSpec, writeData, staleSpecs, runBackground, pause, resume, addonCharacters };
}

module.exports = { createAddonSync, withServerSlug, STALE_SECONDS };

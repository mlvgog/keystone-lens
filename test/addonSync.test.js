'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAddonSync, withServerSlug, STALE_SECONDS } = require('../src/main/addonSync');
const { session: makeSession } = require('./helpers/session');
const lua = require('./helpers/lua');

/**
 * installed: the addon is in the game folder; managed: installed by the app (marker file);
 * rebuilt: the app's copy has changed since (same version, another file); autoUpdate: setting.
 */
function setup({ characters = [], installed = true, wowPath = true, managed = false, rebuilt = false, autoUpdate = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-sync-'));
  const retail = path.join(root, 'World of Warcraft', '_retail_');
  const addons = path.join(retail, 'Interface', 'AddOns');
  fs.mkdirSync(addons, { recursive: true });
  fs.mkdirSync(path.join(retail, 'WTF', 'Account', 'A', 'SavedVariables'), { recursive: true });
  fs.writeFileSync(path.join(retail, 'Wow.exe'), '');
  const bundled = path.join(root, 'bundled');
  fs.mkdirSync(bundled);
  fs.writeFileSync(path.join(bundled, 'KeystoneLens.toc'), '## Interface: 120007\n## Version: 1.0.0\n');
  if (installed) fs.cpSync(bundled, path.join(addons, 'KeystoneLens'), { recursive: true });
  if (managed) fs.writeFileSync(path.join(addons, 'KeystoneLens', '.installed-by-keystone-lens'), '{}');
  if (rebuilt) fs.writeFileSync(path.join(bundled, 'Panel.lua'), '-- the redesigned window\n');
  const chars = characters
    .map((c) => `["${c.name}-r-eu"] = { ["name"] = "${c.name}", ["realm"] = "Tarren Mill", ["region"] = "eu", ["specId"] = ${c.specId}, ["time"] = ${c.time || 1}, ["simc"] = "mage=\\"${c.name}\\"\\nserver=tarren_mill\\n" },`)
    .join('\n');
  fs.writeFileSync(path.join(retail, 'WTF', 'Account', 'A', 'SavedVariables', 'KeystoneLens.lua'), `KeystoneLensDB = { ["characters"] = { ${chars} } }`);
  const userData = path.join(root, 'userData');
  fs.mkdirSync(userData);

  let saved = { wowPath: wowPath ? retail : '', addonSync: true, addonAutoUpdate: autoUpdate };
  const settings = { get: () => saved, set: (p) => (saved = { ...saved, ...p }) };
  const calls = { analyze: [], dungeons: [], specOptions: [] };
  const timers = [];
  const sync = createAddonSync({
    userData,
    settings,
    bundledAddonDir: bundled,
    appVersion: '1.2.0',
    specOptions: async (specId) => (calls.specOptions.push(specId), { specId, specName: 'Frost', className: 'Mage' }),
    analyze: async (opts, { signal }) => {
      calls.analyze.push(opts.specId);
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      const s = makeSession();
      s.meta.specId = opts.specId;
      s.meta.generatedAt = new Date().toISOString();
      s.dungeonsLoaded = [];
      return { session: s };
    },
    loadDungeon: async (s, zoneId) => {
      calls.dungeons.push(zoneId);
      s.dungeonsLoaded.push(zoneId);
    },
    findWowFolder: async () => retail,
    setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimeout: () => {},
  });
  return { sync, retail, addons, userData, settings, calls, timers, root };
}

test('an analysed spec is written to the data addon and kept for later', async () => {
  const { sync, addons, userData } = setup();
  await sync.init();
  assert.equal(sync.status().addon.installed, '1.0.0');
  assert.equal(await sync.recordSession(makeSession()), true);

  const data = fs.readFileSync(path.join(addons, 'KeystoneLens_Data', 'Data.lua'), 'utf8');
  const L = lua.newState();
  lua.run(L, data);
  assert.equal(lua.evaluate(L, 'KeystoneLensAppData.specs[64].spec'), 'Frost');
  assert.equal(lua.evaluate(L, 'KeystoneLensAppData.app'), '1.2.0');

  const stored = JSON.parse(fs.readFileSync(path.join(userData, 'addon-data.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored.specs), ['64']);
  assert.deepEqual(sync.status().specs.map((s) => [s.specId, s.specName, s.dungeons, s.dungeonCount]), [[64, 'Frost', 1, 2]]);

  await sync.removeSpec(64);
  assert.doesNotMatch(fs.readFileSync(path.join(addons, 'KeystoneLens_Data', 'Data.lua'), 'utf8'), /specs\[64\]/);
});

test('raid sessions are not recorded', async () => {
  const { sync } = setup();
  await sync.init();
  const s = makeSession();
  s.meta.mode = 'raid';
  assert.equal(await sync.recordSession(s), false);
  assert.deepEqual(sync.status().specs, []);
});

test('nothing is written to the game until the addon is installed; installing writes the data', async () => {
  const { sync, addons } = setup({ installed: false });
  await sync.init();
  assert.equal(sync.status().addon.action, 'install');
  await sync.recordSession(makeSession());
  assert.equal(fs.existsSync(path.join(addons, 'KeystoneLens_Data')), false);
  await sync.installAddon();
  assert.equal(sync.status().addon.installed, '1.0.0');
  assert.equal(fs.existsSync(path.join(addons, 'KeystoneLens_Data', 'Data.lua')), true);
});

test('the game folder is detected on first start and can be changed', async () => {
  const { sync, settings, retail, root } = setup({ wowPath: false });
  await sync.init();
  assert.equal(settings.get().wowPath, retail);
  await assert.rejects(sync.setWowPath(root), /not a World of Warcraft folder/);
  await sync.setWowPath(path.dirname(retail));
  assert.equal(settings.get().wowPath, retail);
});

test("your characters' specs are refreshed in the background, with every dungeon", async () => {
  const { sync, calls, timers } = setup({ characters: [{ name: 'A', specId: 64 }, { name: 'B', specId: 64 }, { name: 'C', specId: 63 }] });
  await sync.init();
  assert.deepEqual(sync.staleSpecs(), [64, 63]);
  assert.equal(timers.at(-1).ms, 30000, 'starts a little after the app');
  await sync.runBackground();
  assert.deepEqual(calls.analyze, [64, 63]);
  assert.deepEqual(calls.dungeons, [9, 10, 9, 10]);
  assert.deepEqual(sync.status().specs.map((s) => s.specId).sort(), [63, 64]);
  assert.deepEqual(sync.staleSpecs(), [], 'fresh now');
  assert.deepEqual(sync.staleSpecs(Math.floor(Date.now() / 1000) + STALE_SECONDS + 10), [64, 63], 'stale again after a day');
});

test('the background refresh stops for your own search and can be turned off', async () => {
  const { sync, calls, settings } = setup({ characters: [{ name: 'A', specId: 64 }] });
  await sync.init();
  sync.pause();
  await sync.runBackground();
  assert.deepEqual(calls.analyze, [], 'paused');
  sync.resume();
  settings.set({ addonSync: false });
  await sync.runBackground();
  assert.deepEqual(calls.analyze, [], 'turned off');
  settings.set({ addonSync: true });
  await sync.runBackground();
  assert.deepEqual(calls.analyze, [64]);
});

test('characters for "compare" carry the app\'s realm slug', async () => {
  const { sync } = setup({ characters: [{ name: 'A', specId: 64 }] });
  await sync.init();
  const [c] = sync.addonCharacters();
  assert.match(c.simc, /^server=tarren-mill$/m);
  assert.equal('simc' in sync.status().characters[0], false, 'the status leaves the export text out');
  assert.equal(withServerSlug('mage="x"\nserver=Pozzo_dell\'Eternità\n', "Pozzo dell'Eternità"), 'mage="x"\nserver=pozzo-delleternità\n');
});

test('the addon copy the app installed is updated to the app\'s newer build on start', async () => {
  const { sync, addons } = setup({ managed: true, rebuilt: true });
  await sync.init();
  assert.equal(fs.readFileSync(path.join(addons, 'KeystoneLens', 'Panel.lua'), 'utf8'), '-- the redesigned window\n');
  const s = sync.status();
  assert.equal(s.addon.action, null, 'up to date now');
  assert.equal(s.addon.managed, true);
  assert.equal(s.addonUpdated.version, '1.0.0');
  assert.equal(fs.existsSync(path.join(addons, 'KeystoneLens_Data', 'Data.lua')), true, 'the data is written for it');
});

test('without the marker, or with automatic updates off, the update is only offered', async () => {
  for (const options of [{ managed: false, rebuilt: true }, { managed: true, rebuilt: true, autoUpdate: false }]) {
    const { sync, addons } = setup(options);
    await sync.init();
    assert.equal(fs.existsSync(path.join(addons, 'KeystoneLens', 'Panel.lua')), false, 'not replaced');
    const s = sync.status();
    assert.equal(s.addon.action, 'update');
    assert.equal(s.addon.differs, true);
    assert.equal(s.addonUpdated, null);

    // The Update button installs it and marks it, so later builds update by themselves.
    await sync.installAddon();
    assert.equal(fs.existsSync(path.join(addons, 'KeystoneLens', 'Panel.lua')), true);
    assert.equal(sync.status().addon.managed, true);
    assert.equal(sync.status().addon.action, null);
  }
});

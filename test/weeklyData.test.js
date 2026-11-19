'use strict';

// The weekly addon data for players who use the addon through the app (src/main/weeklyData.js),
// and how addonSync installs it next to the addon without touching a CurseForge copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const weekly = require('../src/main/weeklyData');
const { createAddonSync } = require('../src/main/addonSync');
const { weeklyManifest } = require('../scripts/weekly-manifest');

const sha = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

function published(version = '2026.11.18') {
  const files = {
    'KeystoneLens_DB.toc': `## Interface: 120105, 120107\n## Title: Keystone Lens Data (weekly)\n## Version: ${version}\n## Dependencies: KeystoneLens\n\nData.lua\n`,
    'Data.lua': `KeystoneLensBundledData = { schema = 1, source = "bundle", specs = {} } -- ${version}\n`,
  };
  const manifest = { version, addon: '1.2.1', files: Object.fromEntries(Object.entries(files).map(([n, t]) => [n, { sha256: sha(t), bytes: t.length }])) };
  const fetched = [];
  const fetchJson = async (url) => (fetched.push(url), manifest);
  const fetchText = async (url) => {
    fetched.push(url);
    return files[decodeURIComponent(url.slice(weekly.BASE_URL.length))];
  };
  return { files, manifest, fetchJson, fetchText, fetched };
}

const tmpAddons = () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kl-weekly-')), 'AddOns');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

test('the weekly data is downloaded, checked and installed as KeystoneLens_DB with the marker', async () => {
  const addons = tmpAddons();
  const p = published();
  assert.deepEqual(await weekly.localWeekly(addons), { version: null, managed: false });

  const manifest = await weekly.fetchManifest(p.fetchJson);
  assert.equal(p.fetched[0], 'https://github.com/mlvgog/keystone-lens/releases/download/addon-data/manifest.json');
  assert.equal(await weekly.installWeekly(addons, manifest, p.fetchText), '2026.11.18');
  const dir = path.join(addons, 'KeystoneLens_DB');
  assert.equal(fs.readFileSync(path.join(dir, 'Data.lua'), 'utf8'), p.files['Data.lua']);
  assert.equal(fs.readFileSync(path.join(dir, 'KeystoneLens_DB.toc'), 'utf8'), p.files['KeystoneLens_DB.toc']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, weekly.MARKER), 'utf8')).version, '2026.11.18');
  assert.deepEqual(await weekly.localWeekly(addons), { version: '2026.11.18', managed: true });
  assert.deepEqual(fs.readdirSync(addons), ['KeystoneLens_DB'], 'no temporary folders are left');
});

test('a download that does not match its checksum changes nothing', async () => {
  const addons = tmpAddons();
  const good = published('2026.11.11');
  await weekly.installWeekly(addons, good.manifest, good.fetchText);
  const next = published('2026.11.18');
  const corrupt = async (url) => (url.endsWith('Data.lua') ? 'KeystoneLensBundledData = nil -- cut off' : next.fetchText(url));
  await assert.rejects(weekly.installWeekly(addons, next.manifest, corrupt), /Data\.lua of the weekly data does not match its checksum/);
  assert.equal((await weekly.localWeekly(addons)).version, '2026.11.11', 'last week stays');
  assert.deepEqual(fs.readdirSync(addons), ['KeystoneLens_DB']);
});

test('a manifest that is not complete is refused', async () => {
  const p = published();
  await assert.rejects(weekly.fetchManifest(async () => ({ ...p.manifest, version: 'latest' })), /not valid/);
  await assert.rejects(weekly.fetchManifest(async () => ({ version: '2026.11.18', files: { 'Data.lua': p.manifest.files['Data.lua'] } })), /not valid/);
  await assert.rejects(weekly.fetchManifest(async () => null), /not valid/);
});

test("the app only manages its own copy: missing is installed, older is updated, CurseForge's is left alone", () => {
  assert.equal(weekly.weeklyAction({ version: null, managed: false }, '2026.11.18'), 'install');
  assert.equal(weekly.weeklyAction({ version: '2026.11.11', managed: true }, '2026.11.18'), 'update');
  assert.equal(weekly.weeklyAction({ version: '2026.11.18', managed: true }, '2026.11.18'), null);
  assert.equal(weekly.weeklyAction({ version: '2026.11.11', managed: false }, '2026.11.18'), null, 'CurseForge keeps its copy current');
  assert.equal(weekly.weeklyAction({ version: null, managed: false }, null), null);
  assert.equal(weekly.isNewer('2026.12.02', '2026.11.25'), true);
  assert.equal(weekly.isNewer('2026.11.25', 'garbage'), true);
  assert.equal(weekly.isNewer('garbage', '2026.11.25'), false);
});

/** addonSync with the addon installed, the weekly data `published`, and (optionally) a copy there. */
function syncSetup({ addonInstalled = true, existing = null, weeklyData = true, failFetch = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-weekly-sync-'));
  const retail = path.join(root, 'World of Warcraft', '_retail_');
  const addons = path.join(retail, 'Interface', 'AddOns');
  fs.mkdirSync(addons, { recursive: true });
  fs.writeFileSync(path.join(retail, 'Wow.exe'), '');
  const bundled = path.join(root, 'bundled');
  fs.mkdirSync(bundled);
  fs.writeFileSync(path.join(bundled, 'KeystoneLens.toc'), '## Interface: 120105\n## Version: 1.2.1\n');
  if (addonInstalled) fs.cpSync(bundled, path.join(addons, 'KeystoneLens'), { recursive: true });
  if (existing) {
    const dir = path.join(addons, 'KeystoneLens_DB');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'KeystoneLens_DB.toc'), `## Version: ${existing.version}\n`);
    if (existing.managed) fs.writeFileSync(path.join(dir, weekly.MARKER), '{}');
  }
  const userData = path.join(root, 'userData');
  fs.mkdirSync(userData);
  let saved = { wowPath: retail, addonSync: true, addonAutoUpdate: true, addonWeeklyData: weeklyData };
  const p = published('2026.11.18');
  const installs = [];
  const sync = createAddonSync({
    userData,
    settings: { get: () => saved, set: (x) => (saved = { ...saved, ...x }) },
    bundledAddonDir: bundled,
    appVersion: '1.3.0',
    specOptions: async () => null,
    analyze: async () => ({ session: null }),
    loadDungeon: async () => {},
    weekly: {
      local: weekly.localWeekly,
      fetchManifest: async () => {
        if (failFetch) throw new Error('getaddrinfo ENOTFOUND github.com');
        return weekly.fetchManifest(p.fetchJson);
      },
      install: async (dir, manifest) => (installs.push(manifest.version), weekly.installWeekly(dir, manifest, p.fetchText)),
    },
    findWowFolder: async () => retail,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  return { sync, addons, installs, settings: { set: (x) => (saved = { ...saved, ...x }) } };
}

test('with the addon installed by the app, the weekly data is added next to it', async () => {
  const { sync, addons, installs } = syncSetup();
  await sync.rescan();
  assert.deepEqual(installs, ['2026.11.18']);
  assert.deepEqual(sync.status().weekly, { version: '2026.11.18', source: 'app', latest: '2026.11.18', error: null });
  assert.ok(fs.existsSync(path.join(addons, 'KeystoneLens_DB', 'Data.lua')));
  await sync.rescan();
  assert.deepEqual(installs, ['2026.11.18'], 'current: not downloaded again');
});

test("the app's older weekly data is updated; a CurseForge copy is never touched", async () => {
  const mine = syncSetup({ existing: { version: '2026.11.11', managed: true } });
  await mine.sync.rescan();
  assert.deepEqual(mine.installs, ['2026.11.18']);

  const cf = syncSetup({ existing: { version: '2026.11.11', managed: false } });
  await cf.sync.rescan();
  assert.deepEqual(cf.installs, []);
  assert.deepEqual(cf.sync.status().weekly, { version: '2026.11.11', source: 'other', latest: null, error: null });
  assert.equal(fs.readFileSync(path.join(cf.addons, 'KeystoneLens_DB', 'KeystoneLens_DB.toc'), 'utf8'), '## Version: 2026.11.11\n');
});

test('nothing is added without the addon, with the setting off, and a failed download is reported', async () => {
  const none = syncSetup({ addonInstalled: false });
  await none.sync.rescan();
  assert.deepEqual(none.installs, []);
  assert.equal(none.sync.status().weekly.source, null);

  const off = syncSetup({ weeklyData: false });
  await off.sync.rescan();
  assert.deepEqual(off.installs, []);
  assert.equal(off.sync.status().weeklyData, false);
  off.settings.set({ addonWeeklyData: true });
  await off.sync.syncWeekly();
  assert.deepEqual(off.installs, ['2026.11.18'], 'turning it on adds it');

  const offline = syncSetup({ failFetch: true });
  await offline.sync.rescan();
  assert.match(offline.sync.status().weekly.error, /^Could not get the weekly data: getaddrinfo ENOTFOUND/);
  assert.deepEqual(offline.installs, []);
});

test("the workflow's manifest is what the app accepts and checks the files against", async () => {
  const p = published('2026.11.25');
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kl-manifest-')), 'KeystoneLens_DB');
  fs.mkdirSync(dir);
  for (const [name, text] of Object.entries(p.files)) fs.writeFileSync(path.join(dir, name), text);
  const manifest = weeklyManifest(dir, { version: '2026.11.25', addon: '1.2.1' });
  assert.deepEqual(manifest, p.manifest);
  const accepted = await weekly.fetchManifest(async () => JSON.parse(JSON.stringify(manifest)));
  const addons = tmpAddons();
  assert.equal(await weekly.installWeekly(addons, accepted, p.fetchText), '2026.11.25');
});

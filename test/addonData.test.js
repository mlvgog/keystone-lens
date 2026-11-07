'use strict';

// The weekly data build for the addon on CurseForge (scripts/build-addon-data.js), with the
// network parts (talent data, analyze, loadDungeon) replaced by the synthetic session.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildAddonData, specList, parseArgs } = require('../scripts/build-addon-data');
const { specRecord, readTocField } = require('../src/main/addonExport');
const { session } = require('./helpers/session');
const addon = require('./helpers/addon');
const http = require('../src/main/http');

const CLASSES = [
  {
    classSlug: 'mage',
    className: 'Mage',
    color: '#3FC7EB',
    specs: [
      { specId: 63, specSlug: 'fire', specName: 'Fire', icon: 'f' },
      { specId: 64, specSlug: 'frost', specName: 'Frost', icon: 'i' },
    ],
  },
  { classSlug: 'rogue', className: 'Rogue', color: '#FFF468', specs: [{ specId: 261, specSlug: 'subtlety', specName: 'Subtlety', icon: 's' }] },
];

function stubDeps({ fail = [] } = {}) {
  const calls = { analyze: [], loadDungeon: [] };
  return {
    calls,
    classList: async () => CLASSES,
    analyze: async (opts) => {
      calls.analyze.push(opts);
      if (fail.includes(opts.specId)) throw new Error('raider.io answered 500');
      const s = session();
      return { session: { ...s, meta: { ...s.meta, specId: opts.specId, specName: opts.specName, className: opts.className } } };
    },
    loadDungeon: async (_session, zoneId) => calls.loadDungeon.push(zoneId),
    specRecord: (s) => specRecord(s),
  };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kl-addon-data-'));

test('every spec is built world-wide from the top 50, with every dungeon', async () => {
  const out = tmp();
  const deps = stubDeps();
  const logs = [];
  const res = await buildAddonData({ out, deps, minPlayers: 1, minSpecs: 3, log: (l) => logs.push(l), now: Date.UTC(2026, 10, 11, 7) });

  assert.deepEqual(deps.calls.analyze.map((o) => [o.specId, o.region, o.sampleSize, o.since]), [
    [63, 'world', 50, null],
    [64, 'world', 50, null],
    [261, 'world', 50, null],
  ]);
  assert.deepEqual(deps.calls.loadDungeon, [9, 10, 9, 10, 9, 10], 'both dungeons of each spec');
  assert.deepEqual(Object.keys(res.records).map(Number), [63, 64, 261]);
  assert.equal(logs.length, 3);

  // The folder the game loads: a .toc like the app's data folder, and the data file.
  assert.equal(res.dir, path.join(out, 'KeystoneLens_DB'));
  const toc = fs.readFileSync(path.join(res.dir, 'KeystoneLens_DB.toc'), 'utf8');
  const addonToc = fs.readFileSync(path.join(__dirname, '..', 'addon', 'KeystoneLens', 'KeystoneLens.toc'), 'utf8');
  assert.equal(readTocField(toc, 'Interface'), readTocField(addonToc, 'Interface'));
  assert.equal(readTocField(toc, 'Version'), '2026.11.11');
  assert.equal(readTocField(toc, 'Dependencies'), 'KeystoneLens');
  assert.match(toc, /\nData\.lua\n/);
  assert.match(readTocField(addonToc, 'OptionalDeps'), /\bKeystoneLens_DB\b/, 'the addon loads after its weekly data');

  const data = fs.readFileSync(path.join(res.dir, 'Data.lua'), 'utf8');
  assert.match(data, /^-- Weekly data for the Keystone Lens addon, built from Raider\.IO's public Mythic\+ data/);
  assert.match(data, /\nKeystoneLensBundledData = \{/);
  assert.doesNotMatch(data, /KeystoneLensAppData/);
  assert.equal(res.bytes, Buffer.byteLength(data));

  // No player names in a public download, only aggregates.
  for (const p of session().players) assert.ok(!data.includes(`"${p.name}"`), `${p.name} is in the data`);

  // The game addon reads it as its weekly data.
  const L = addon.loadAddon({ before: [data] });
  assert.equal(addon.evaluate(L, 'select(2, __ns:GetSpecData(261))'), 'bundle');
  assert.equal(addon.evaluate(L, '#__ns:AvailableSpecs()'), 3);
  assert.deepEqual(addon.errors(L), []);
  fs.rmSync(out, { recursive: true, force: true });
});

test('a spec that fails is left out, and too many failures stop the build', async () => {
  const out = tmp();
  const logs = [];
  const res = await buildAddonData({ out, deps: stubDeps({ fail: [63] }), minPlayers: 1, minSpecs: 2, log: (l) => logs.push(l) });
  assert.deepEqual(Object.keys(res.records).map(Number), [64, 261]);
  assert.deepEqual(res.failed, [{ specId: 63, label: 'Fire Mage', error: 'raider.io answered 500' }]);
  assert.ok(logs.some((l) => /Fire Mage: FAILED: raider\.io answered 500/.test(l)));

  await assert.rejects(buildAddonData({ out, deps: stubDeps({ fail: [63, 64] }), minPlayers: 1, minSpecs: 1, maxMissing: 1, log: () => {} }), /2 specs failed \(at most 1 may\): Fire Mage, Frost Mage/);
  fs.rmSync(out, { recursive: true, force: true });
});

test('specs hardly played in top keys are left out, but a nearly empty week is never published', async () => {
  const out = tmp();
  const logs = [];
  // The synthetic session has 6 players: under a minimum of 10, every spec is left out. That is
  // the data, not an error, so it doesn't count against --max-missing.
  const res = await buildAddonData({ out, deps: stubDeps(), minPlayers: 10, minSpecs: 0, maxMissing: 0, log: (l) => logs.push(l) });
  assert.deepEqual(res.skipped.map((x) => [x.label, x.players]), [['Fire Mage', 6], ['Frost Mage', 6], ['Subtlety Rogue', 6]]);
  assert.deepEqual(res.failed, []);
  assert.ok(logs.some((l) => /Fire Mage: left out, only 6 players in this season's top keys/.test(l)));

  // The default minimum is 5 players, so these 6-player specs are built.
  const ok = await buildAddonData({ out, deps: stubDeps(), minSpecs: 3, log: () => {} });
  assert.equal(Object.keys(ok.records).length, 3);

  // A full run needs at least 20 specs; a test run with --specs at least one.
  await assert.rejects(buildAddonData({ out, deps: stubDeps(), log: () => {} }), /Only 3 specs could be built \(at least 20 are needed\)/);
  await assert.rejects(buildAddonData({ out, only: [64], deps: stubDeps(), minPlayers: 10, log: () => {} }), /Only 0 specs could be built \(at least 1 are needed\)/);
  assert.equal((await buildAddonData({ out, only: [64], deps: stubDeps(), log: () => {} })).records[64].specId, 64);
  fs.rmSync(out, { recursive: true, force: true });
});

test('--specs limits a test run; unknown options are refused', () => {
  assert.deepEqual(specList(CLASSES, [261]).map((s) => s.specId), [261]);
  const args = parseArgs(['--specs', '261,64', '--out', 'x', '--max-missing', '0']);
  assert.deepEqual(args.only, [261, 64]);
  assert.equal(args.out, path.resolve('x'));
  assert.equal(args.maxMissing, 0);
  assert.throws(() => parseArgs(['--region', 'eu']), /Unknown option --region/);
});

test('the build identifies itself and asks raider.io more gently than the app', () => {
  const before = http.userAgentString();
  assert.match(before, /^KeystoneLens\/[\d.]+ \(desktop app; \+https:\/\/github\.com\/mlvgog\/keystone-lens\)$/);
  http.configure({ context: 'addon data build' });
  assert.match(http.userAgentString(), /^KeystoneLens\/[\d.]+ \(addon data build; \+https:\/\/github\.com\/mlvgog\/keystone-lens\)$/);
  http.configure({ context: 'desktop app' });
  assert.equal(http.userAgentString(), before);
});

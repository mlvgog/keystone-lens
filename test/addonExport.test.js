'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { specRecord, dataFileText, tocText, readTocField, writeDataAddon, DATA_GLOBAL } = require('../src/main/addonExport');
const lua = require('./helpers/lua');
const { session } = require('./helpers/session');

test('a spec record holds pick rates, builds, gear, enchants and gems', async () => {
  const r = await specRecord(session());
  assert.equal(r.specId, 64);
  assert.equal(r.class, 'Mage');
  assert.equal(r.spec, 'Frost');
  assert.equal(r.sample, 6);
  assert.equal(r.time, Date.parse('2026-10-20T00:00:00.000Z') / 1000);
  assert.deepEqual(r.hero, [{ id: 40, name: 'Alpha', n: 4 }, { id: 41, name: 'Beta', n: 2 }]);

  // Talents: plain share, choice split per entry, most common rank; unpicked nodes left out.
  assert.deepEqual(r.talents[1], { p: 1 });
  assert.deepEqual(r.talents[2], { p: 1, e: { 21: 0.667, 22: 0.333 } });
  assert.deepEqual(r.talents[3], { p: 1, r: 2 });
  assert.deepEqual(r.talents[6], { p: 0.333 });
  assert.deepEqual(r.talents[4], { p: 1 }, 'hero nodes count the players of that hero tree');

  // Builds: the medoid's picks and choices, so the addon can compare them with yours.
  assert.equal(r.builds.length, 2);
  assert.deepEqual(r.builds[0], { n: 4, p: 0.667, hero: 40, str: 'STRA', picks: { 1: 1, 2: 1, 3: 2, 4: 1 }, choices: { 2: 21 } });
  assert.equal(r.builds[1].str, 'STRB');

  // Gear: rings combined, counted once per player; enchants and gems by game ID.
  assert.deepEqual(r.gear.rings.map((x) => [x.id, x.n]), [[400, 6], [401, 4], [402, 2]]);
  assert.equal(r.gear.head[0].tier, true);
  assert.deepEqual(r.enchants.rings, [{ id: 7001, name: 'Radiant Crit', n: 4 }, { id: 7002, name: 'Radiant Haste', n: 2 }]);
  assert.deepEqual(r.gems, [{ id: 9001, name: 'Masterful Ruby', n: 8 }, { id: 9002, name: 'Quick Onyx', n: 4 }]);
  assert.equal(r.gemSockets, 12);

  // Stats: average rating from gear (4 players with gear A, 2 with gear B) and each stat's share.
  assert.deepEqual(r.statRatings, { crit: 967, haste: 1233, mastery: 433, vers: 133 });
  assert.equal(r.stats.haste, 0.445, 'the average of each player\'s share');

  // Dungeons: the list (with keystone map IDs) and per-dungeon data for loaded ones only.
  assert.deepEqual(r.dungeonList, [{ id: 9, name: 'Somewhere', short: 'SW', map: 501 }, { id: 10, name: 'Elsewhere', short: 'EW', map: undefined }]);
  assert.deepEqual(Object.keys(r.dungeons), ['9']);
  assert.equal(r.dungeons[9].sample, 3);
  assert.deepEqual(r.dungeons[9].builds[0].choices, { 2: 22 });
});

test('raid sessions are never exported', async () => {
  const s = session();
  s.meta.mode = 'raid';
  await assert.rejects(specRecord(s), /not exported/);
});

test('the data file loads in Lua with every spec', async () => {
  const one = await specRecord(session());
  const other = { ...one, specId: 63, spec: 'Fire' };
  const text = dataFileText({ 64: one, 63: other }, { appVersion: '1.2.0', now: 1761300000000 });
  const L = lua.newState();
  lua.run(L, text, 'Data.lua');
  assert.equal(lua.evaluate(L, `${DATA_GLOBAL}.schema`), 1);
  assert.equal(lua.evaluate(L, `${DATA_GLOBAL}.source`), 'app');
  assert.equal(lua.evaluate(L, `${DATA_GLOBAL}.app`), '1.2.0');
  assert.equal(lua.evaluate(L, `${DATA_GLOBAL}.time`), 1761300000);
  assert.equal(lua.evaluate(L, `${DATA_GLOBAL}.specs[64].spec`), 'Frost');
  assert.equal(lua.evaluate(L, `${DATA_GLOBAL}.specs[63].spec`), 'Fire');
  assert.equal(lua.evaluate(L, `${DATA_GLOBAL}.specs[64].talents[2].e[21]`), 0.667);
  assert.equal(lua.evaluate(L, `${DATA_GLOBAL}.specs[64].builds[1].picks[3]`), 2);
  assert.equal(lua.evaluate(L, `${DATA_GLOBAL}.specs[64].gear.rings[1].id`), 400);
  assert.equal(lua.evaluate(L, `${DATA_GLOBAL}.specs[64].dungeons[9].sample`), 3);
});

test('the data addon copies the Interface value of the installed addon and is written whole', async () => {
  const addons = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-addons-'));
  await assert.rejects(writeDataAddon(addons, {}, { appVersion: '1.2.0' }), /Install the Keystone Lens addon/);

  fs.mkdirSync(path.join(addons, 'KeystoneLens'));
  fs.writeFileSync(path.join(addons, 'KeystoneLens', 'KeystoneLens.toc'), '## Interface: 120007, 120100\n## Title: Keystone Lens\n');
  const dir = await writeDataAddon(addons, { 64: await specRecord(session()) }, { appVersion: '1.2.0' });
  const toc = fs.readFileSync(path.join(dir, 'KeystoneLens_Data.toc'), 'utf8');
  assert.equal(readTocField(toc, 'Interface'), '120007, 120100');
  assert.equal(readTocField(toc, 'Dependencies'), 'KeystoneLens');
  assert.match(toc, /\nData\.lua\n/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Data.lua', 'KeystoneLens_Data.toc'], 'no temporary files left');
  assert.match(fs.readFileSync(path.join(dir, 'Data.lua'), 'utf8'), /^-- Written by the Keystone Lens app/);
});

test('toc fields are read case-insensitively', () => {
  assert.equal(readTocField('## interface:  110000 \n', 'Interface'), '110000');
  assert.equal(readTocField(tocText({ interfaceVersion: '1', appVersion: '2' }), 'Version'), '2');
  assert.equal(readTocField('no fields', 'Version'), null);
});

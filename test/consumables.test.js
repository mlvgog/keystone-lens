'use strict';

// Consumables (flasks, food, augment runes) from the buffs Raider.IO records at the boss pulls of
// logged runs: parsing the run details, telling consumables apart with the game tables, and the
// summary the app and the addon show.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Stand-in for raider.io, set before raiderio.js takes its reference to fetchJson.
const http = require('../src/main/http');
const fetched = [];
let respond = () => {
  throw new Error('no response set');
};
http.fetchJson = async (url) => (fetched.push(url), respond(url));

const cache = require('../src/main/cache');
const raiderio = require('../src/main/sources/raiderio');
const consumables = require('../src/main/consumables');
const { buildView } = require('../src/main/views');
const { specRecord } = require('../src/main/addonExport');
const { session, auraInfo } = require('./helpers/session');

const aura = (id, name, icon = 'x') => ({ id, name, icon, school: 1, rank: null, hasCooldown: false });
const member = (id, name, auras) => ({ character: { id, name, spec: { id: 64 } }, interestingAuras: auras });

/** A run-details answer as raider.io sends it (trimmed), logged or not. */
function runDetails({ logged = true } = {}) {
  return {
    keystone_run_id: 77,
    completed_at: '2026-11-10T20:00:00.000Z',
    mythic_level: 20,
    score: 450,
    dungeon: { id: 9, name: 'Somewhere', short_name: 'SW' },
    roster: [
      { character: { id: 1, name: 'Ana', spec: { id: 64 }, talentLoadout: null }, items: { item_level_equipped: 330, items: {} } },
      { character: { id: 2, name: 'Bo', spec: { id: 250 }, talentLoadout: null }, items: { item_level_equipped: 331, items: {} } },
    ],
    logged_run_id: logged ? 5 : null,
    logged_details: logged
      ? {
          encounters: [
            { id: 1, roster: [member(1, 'Ana', [aura(465, 'Devotion Aura'), aura(1235110, 'Flask of the Blood Knights')]), member(2, 'Bo', [])] },
            {
              id: 2,
              roster: [
                member(1, 'Ana', [aura(1235110, 'Flask of the Blood Knights'), aura(1285644, 'Hearty Well Fed', 'spell_misc_food')]),
                member(2, 'Bo', [aura(1264426, 'Void-Touched')]),
              ],
            },
          ],
        }
      : null,
  };
}

test('the buffs at each boss pull are kept per player; a run that was not logged has none', () => {
  const run = raiderio.parseRunDetails(77, runDetails());
  assert.equal(run.logged, true);
  assert.equal(run.v, 2);
  const ana = run.roster.find((m) => m.name === 'Ana');
  assert.deepEqual(ana.buffs, {
    pulls: 2,
    auras: [
      { id: 465, name: 'Devotion Aura', icon: 'x', pulls: 1 },
      { id: 1235110, name: 'Flask of the Blood Knights', icon: 'x', pulls: 2 },
      { id: 1285644, name: 'Hearty Well Fed', icon: 'spell_misc_food', pulls: 1 },
    ],
  });
  assert.deepEqual(run.roster.find((m) => m.name === 'Bo').buffs, { pulls: 2, auras: [{ id: 1264426, name: 'Void-Touched', icon: 'x', pulls: 1 }] });

  const plain = raiderio.parseRunDetails(77, runDetails({ logged: false }));
  assert.equal(plain.logged, false);
  assert.ok(plain.roster.every((m) => m.buffs === null));
  assert.equal(raiderio.pullBuffs({ encounters: [] }), null);
});

test('run snapshots stored before buffs were kept are downloaded again once', async () => {
  cache.init(fs.mkdtempSync(path.join(os.tmpdir(), 'kl-runs-')));
  const url = 'https://raider.io/api/v1/mythic-plus/run-details?season=season-mn-2&id=77';
  await cache.write('run', url, { id: 77, level: 20, roster: [] }); // an older version's snapshot
  respond = () => runDetails();
  fetched.length = 0;
  const run = await raiderio.getRunDetails({ season: 'season-mn-2', id: 77 });
  assert.equal(run.logged, true);
  assert.deepEqual(fetched, [url]);
  await raiderio.getRunDetails({ season: 'season-mn-2', id: 77 });
  assert.equal(fetched.length, 1, 'the new snapshot is kept');

  // Runs raider.io no longer has are remembered too.
  respond = () => {
    throw Object.assign(new Error('Not found'), { status: 404 });
  };
  assert.deepEqual(await raiderio.getRunDetails({ season: 'season-mn-2', id: 78 }), { v: 2, id: 78, missing: true, roster: [] });
});

/** wago.tools tables as the game has them for these spells (trimmed to the columns used). */
const TABLES = {
  ItemEffect: [
    { ID: 210513, SpellID: 1235110 },
    { ID: 210514, SpellID: 1235110 },
    { ID: 226529, SpellID: 1264426 },
    { ID: 300, SpellID: 999 }, // a trinket's on-use effect
  ],
  ItemXItemEffect: [
    { ItemEffectID: 210513, ItemID: 241325 },
    { ItemEffectID: 210514, ItemID: 241324 },
    { ItemEffectID: 226529, ItemID: 259085 },
    { ItemEffectID: 300, ItemID: 777 },
  ],
  Item: [
    { ID: 241324, ClassID: 0, SubclassID: 3 },
    { ID: 241325, ClassID: 0, SubclassID: 3 },
    { ID: 259085, ClassID: 0, SubclassID: 8 },
    { ID: 777, ClassID: 4, SubclassID: 0 },
  ],
  ItemSparse: [{ ID: 259085, Display_lang: 'Void-Touched Augment Rune' }],
  SpellEffect: [
    { SpellID: 1285644, EffectAura: 189, EffectMiscValue_0: 0 },
    { SpellID: 1285644, EffectAura: 29, EffectMiscValue_0: 2 },
    { SpellID: 1305153, EffectAura: 189, EffectMiscValue_0: 917504 },
  ],
};

function tables() {
  const asked = [];
  const rows = async (table, column, ids) => {
    asked.push(table);
    const want = new Set(ids.map(Number));
    return (TABLES[table] || []).filter((r) => want.has(Number(r[column])));
  };
  const stored = {};
  const cachedById = async (kind, ids, fetchMissing) => {
    const missing = ids.filter((id) => !(id in stored));
    if (missing.length) Object.assign(stored, await fetchMissing(missing, {}));
    return Object.fromEntries(ids.map((id) => [id, stored[id] ?? null]));
  };
  return { rows, cachedById, asked };
}

test('the game tables tell flasks, augment runes and food from other buffs', async () => {
  const t = tables();
  const info = await consumables.classifyAuras(
    [
      aura(1235110, 'Flask of the Blood Knights', 'flask_icon'),
      aura(1264426, 'Void-Touched', 'rune_icon'),
      aura(1285644, 'Hearty Well Fed', 'spell_misc_food'),
      aura(1305153, 'Hearty Well Fed', 'spell_misc_food'),
      aura(465, 'Devotion Aura'),
      aura(999, 'Trinket Proc'),
    ],
    t
  );
  assert.deepEqual(info[1235110], { kind: 'flask', name: 'Flask of the Blood Knights', icon: 'flask_icon', items: [241324, 241325] });
  assert.deepEqual(info[1264426], { kind: 'rune', name: 'Void-Touched Augment Rune', icon: 'rune_icon', items: [259085] });
  assert.deepEqual(info[1285644], { kind: 'food', name: 'Primary stat food', icon: 'spell_misc_food', items: [], stat: 'Primary stat' });
  assert.equal(info[1305153].name, 'Haste food');
  assert.equal(info[465], null);
  assert.equal(info[999], null);

  // Known spells are not looked up again.
  t.asked.length = 0;
  await consumables.classifyAuras([aura(1235110, 'Flask of the Blood Knights')], t);
  assert.deepEqual(t.asked, []);
});

test('food is named after the stats it raises', () => {
  assert.equal(consumables.foodStat([917504]), 'Haste');
  assert.equal(consumables.foodStat([2 ** 25]), 'Mastery');
  assert.equal(consumables.foodStat([1792]), 'Crit');
  assert.equal(consumables.foodStat([2 ** 29]), 'Versatility');
  assert.equal(consumables.foodStat([917504 | 2 ** 25]), 'Haste & Mastery');
  assert.equal(consumables.foodStat([0]), 'Primary stat');
  assert.equal(consumables.foodStat([]), 'Primary stat');
});

test('each logged player counts once per kind, with the consumable of most of their pulls', async () => {
  const view = await buildView(session(), {}, {});
  const c = view.consumables;
  assert.equal(c.players, 4, 'P5 and P6 have no logged run');
  assert.equal(c.total, 6);
  assert.equal(c.incomplete, false);
  const kind = (key) => c.kinds.find((k) => k.key === key);
  assert.deepEqual(
    kind('flask').options.map((o) => [o.name, o.count, o.share]),
    [
      ['Flask of A', 2, 0.5],
      ['Flask of B', 2, 0.5],
    ]
  );
  assert.equal(kind('flask').used, 4);
  // Two dishes that give the same buff are one option.
  assert.deepEqual(
    kind('food').options.map((o) => [o.name, o.id, o.count]),
    [
      ['Haste food', 2001, 3],
      ['Primary stat food', 2003, 1],
    ]
  );
  assert.equal(kind('rune').used, 3);
  assert.deepEqual(kind('rune').options[0].items, [6001]);
  assert.deepEqual(
    c.kinds.map((k) => k.label),
    ['Flask', 'Food', 'Augment rune']
  );

  // Per dungeon: the players' runs in that dungeon.
  const dungeon = await buildView(session(), { dungeon: 9 }, {});
  assert.equal(dungeon.consumables.players, 1);
  assert.equal(dungeon.consumables.kinds[0].options[0].name, 'Flask of B');

  // Buffs the game tables could not tell apart (offline): marked, and left out of the addon.
  const offline = session();
  delete offline.auraInfo[1002];
  assert.equal((await buildView(offline, {}, {})).consumables.incomplete, true);
  assert.equal((await specRecord(offline)).consumables, undefined);

  // Raid sessions come from Warcraft Logs: no consumables.
  const raid = session();
  raid.meta.mode = 'raid';
  assert.equal((await buildView(raid, {}, {})).consumables, null);
});

test('auras already classified are not asked for again', () => {
  const s = session();
  const entries = s.players.flatMap((p) => [p.main, ...Object.values(p.dungeons)]);
  assert.deepEqual(consumables.unclassifiedAuras(entries, auraInfo), []);
  assert.deepEqual(
    consumables.unclassifiedAuras(entries, {}).map((a) => a.id),
    [465, 1001, 2001, 3001, 1002, 2003, 2002]
  );
});

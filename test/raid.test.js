'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapTalents, mapGear, buildRaidSession, bossDifferences, gemLabel } = require('../src/main/raid');
const { buildView } = require('../src/main/views');
const { parseItemXml } = require('../src/main/itemInfo');

const TREE = {
  specId: 261,
  classNodes: [
    { id: 1, type: 'single', maxRanks: 1, entries: [{ id: 101, maxRanks: 1, name: 'One' }] },
    { id: 2, type: 'single', maxRanks: 2, entries: [{ id: 102, maxRanks: 2, name: 'Two' }] },
  ],
  specNodes: [
    { id: 3, type: 'choice', maxRanks: 1, entries: [{ id: 103, maxRanks: 1, name: 'Left' }, { id: 104, maxRanks: 1, name: 'Right' }] },
    { id: 4, type: 'tiered', maxRanks: 4, entries: [{ id: 105, maxRanks: 1 }, { id: 106, maxRanks: 2 }, { id: 107, maxRanks: 1 }] },
  ],
  heroNodes: [
    { id: 10, type: 'single', maxRanks: 1, subTreeId: 51, entryNode: true, freeNode: true, entries: [{ id: 110, maxRanks: 1 }] },
    { id: 20, type: 'single', maxRanks: 1, subTreeId: 53, entryNode: true, freeNode: true, entries: [{ id: 120, maxRanks: 1 }] },
  ],
  subTrees: [
    { id: 51, name: 'Trickster', icon: 'a' },
    { id: 53, name: 'Deathstalker', icon: 'b' },
  ],
};

test('Warcraft Logs talents map to node picks: ranks, choices, apex tiers, hero tree', () => {
  const t = mapTalents(
    [
      { id: 101, points: 1 },
      { id: 102, points: 1 },
      { id: 104, points: 1 },
      { id: 105, points: 1 },
      { id: 106, points: 2 },
      { id: 110, points: 1 },
      { id: 999, points: 1 }, // not in this tree
    ],
    TREE
  );
  assert.equal(t.heroSubTreeId, 51);
  const byId = Object.fromEntries(t.nodes.map((n) => [n.nodeId, n]));
  assert.deepEqual(Object.keys(byId).map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 10]);
  assert.equal(byId[2].rank, 1);
  assert.deepEqual([byId[3].entryIndex, byId[3].entryId], [1, 104]);
  assert.deepEqual([byId[4].rank, byId[4].entryIndex, byId[4].entryId], [3, 1, 106]);
});

test('Warcraft Logs gear maps to the app slots (shirt and tabard dropped)', () => {
  const gear = Array.from({ length: 18 }, () => null);
  gear[0] = { id: 271510, name: 'Helm', icon: 'inv_helm.jpg', quality: 'epic', itemLevel: 321, bonusIDs: [12846, 6652], gems: [240983], enchant: 8017 };
  gear[3] = { id: 45579, name: 'Shirt', icon: 'x.jpg', quality: 'common', itemLevel: 1, bonusIDs: [], gems: [], enchant: null };
  gear[14] = { id: 251132, name: 'Cloak', icon: 'cape.jpg', quality: 'rare', itemLevel: 321, bonusIDs: [], gems: [], enchant: null };
  const items = mapGear(gear);
  assert.deepEqual(Object.keys(items), ['head', 'back']);
  assert.deepEqual(items.head, {
    id: 271510,
    ilvl: 321,
    name: 'Helm',
    icon: 'inv_helm',
    quality: 4,
    bonuses: [12846, 6652],
    tier: null,
    enchants: [{ id: 8017, name: null, icon: null }],
    gems: [{ id: 240983, name: null, icon: null }],
  });
  assert.equal(items.back.quality, 3);
});

function ranking(name, talents, extra = {}) {
  return { name, server: "Mal'Ganis", region: 'US', amount: 1000, duration: 300000, startTime: 1792691521734, report: 'abc', fight: 3, talents, gear: [], ...extra };
}

const base = [{ id: 101, points: 1 }, { id: 110, points: 1 }];
function bosses() {
  const many = (prefix, extra) => Array.from({ length: 12 }, (_, i) => ranking(`${prefix}${i}`, [...base, ...extra]));
  return [
    // Boss 1: everyone takes "Two"; boss 2: nobody does.
    { id: 900, name: 'First Boss', rankings: many('a', [{ id: 102, points: 2 }]) },
    { id: 901, name: 'Second Boss', rankings: [ranking('a0', base), ...many('b', [])] },
  ];
}

test('a raid session works with the views: one entry per player and boss', async () => {
  const s = buildRaidSession({ meta: { specName: 'Subtlety', className: 'Rogue' }, tree: TREE, trimmedTree: TREE, bosses: bosses() });
  assert.equal(s.meta.mode, 'raid');
  assert.deepEqual(s.meta.dungeons.map((d) => d.name), ['First Boss', 'Second Boss']);
  assert.equal(s.players.length, 24); // a0 is ranked on both bosses
  const a0 = s.players.find((p) => p.name === 'a0');
  assert.deepEqual(Object.keys(a0.dungeons).map(Number), [900, 901]);
  assert.equal(a0.realmSlug, 'malganis');
  assert.equal(a0.main.run.url, 'https://www.warcraftlogs.com/reports/abc#fight=3');

  const all = await buildView(s, {}, {});
  assert.equal(all.sampleSize, 24);
  const first = await buildView(s, { dungeon: 900 }, {});
  assert.equal(first.sampleSize, 12);
  assert.equal(first.talents.nodes[2].pct, 1);
});

test('boss differences: big changes only, with enough players', () => {
  const s = buildRaidSession({ meta: {}, tree: TREE, trimmedTree: TREE, bosses: bosses() });
  const diff = bossDifferences(s, TREE, 900);
  assert.deepEqual(diff.map((d) => [d.nodeId, d.name, d.boss, Math.round(d.others * 100)]), [[2, 'Two', 1, 0]]);
  assert.deepEqual(bossDifferences(s, TREE, 900, { minPlayers: 50 }), []);
});

test('gem labels from the item XML stat line', () => {
  const xml = '<wowhead><item><htmlTooltip><![CDATA[<table><tr><td><b>Gem</b><br>+16 Mastery &amp; +7 Critical Strike<br></td></tr></table>]]></htmlTooltip></item></wowhead>';
  const stats = parseItemXml(xml).stats;
  assert.deepEqual(stats, [{ value: 16, stat: 'Mastery' }, { value: 7, stat: 'Critical Strike' }]);
  assert.equal(gemLabel(stats), '16 Mast & 7 Crit');
  assert.equal(gemLabel([{ value: 32, stat: 'Primary Stat' }]), '32 Primary');
});

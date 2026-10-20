'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateTalents, aggregateGear, tierSetSummary, cleanEnchantName, stripEscapes } = require('../src/main/aggregate');

// A tiny tree: 2 class nodes (one choice), 1 multi-rank spec node, 1 apex (tiered),
// and two hero sub-trees with one node each.
const tree = {
  classNodes: [
    { id: 1, type: 'single', entries: [{ id: 101, type: 'active' }] },
    { id: 2, type: 'choice', entries: [{ id: 201 }, { id: 202 }] },
  ],
  specNodes: [
    { id: 3, type: 'single', maxRanks: 2, entries: [{ id: 301 }] },
    { id: 4, type: 'tiered', maxRanks: 4, entries: [{ id: 401 }, { id: 402 }, { id: 403 }] },
  ],
  heroNodes: [
    { id: 5, type: 'single', subTreeId: 40, entryNode: true, entries: [{ id: 501, icon: 'hero_a' }] },
    { id: 6, type: 'single', subTreeId: 41, entryNode: true, entries: [{ id: 601, icon: 'hero_b' }] },
  ],
  subTreeNodes: [
    { id: 9, type: 'subtree', entries: [{ traitSubTreeId: 40, name: 'Alpha' }, { traitSubTreeId: 41, name: 'Beta' }] },
  ],
};

function talents(hero, nodes, loadoutText = 'X') {
  return { heroSubTreeId: hero, loadoutText, nodes };
}

const players = [
  { name: 'A', talents: talents(40, [{ nodeId: 1, rank: 1 }, { nodeId: 2, entryId: 201, rank: 1 }, { nodeId: 3, rank: 2 }, { nodeId: 4, entryId: 403, rank: 4 }, { nodeId: 5, rank: 1 }], 'build-A') },
  { name: 'B', talents: talents(40, [{ nodeId: 1, rank: 1 }, { nodeId: 2, entryId: 201, rank: 1 }, { nodeId: 3, rank: 1 }, { nodeId: 5, rank: 1 }], 'build-B') },
  { name: 'C', talents: talents(41, [{ nodeId: 1, rank: 1 }, { nodeId: 2, entryId: 202, rank: 1 }, { nodeId: 3, rank: 2 }, { nodeId: 4, entryId: 403, rank: 4 }, { nodeId: 6, rank: 1 }], 'build-C') },
  { name: 'D', talents: talents(40, [{ nodeId: 2, entryId: 201, rank: 1 }, { nodeId: 3, rank: 2 }, { nodeId: 4, entryId: 402, rank: 3 }, { nodeId: 5, rank: 1 }, { nodeId: 5, rank: 1 }], 'build-D') },
];

test('talent pick rates, choice entries and rank histograms', () => {
  const t = aggregateTalents(tree, players);
  assert.equal(t.sampleSize, 4);
  assert.equal(t.nodes[1].picked, 3);
  assert.equal(t.nodes[1].pct, 0.75);
  assert.deepEqual(t.nodes[2].entries, { 201: 3, 202: 1 });
  assert.equal(t.nodes[2].pct, 1);
  assert.deepEqual(t.nodes[3].ranks, { 1: 1, 2: 3 });
  assert.equal(t.nodes[3].avgRank, 7 / 4);
  assert.deepEqual(t.nodes[4].ranks, { 3: 1, 4: 2 });
  assert.equal(t.nodes[4].pct, 0.75);
});

test('hero nodes are measured against players on that hero tree; duplicates count once', () => {
  const t = aggregateTalents(tree, players);
  assert.deepEqual(
    t.hero.map((h) => [h.name, h.count, h.pct, h.icon]),
    [
      ['Alpha', 3, 0.75, 'hero_a'],
      ['Beta', 1, 0.25, 'hero_b'],
    ]
  );
  assert.equal(t.nodes[5].total, 3);
  assert.equal(t.nodes[5].picked, 3, 'player D lists node 5 twice but is counted once');
  assert.equal(t.nodes[5].pct, 1);
  assert.equal(t.nodes[6].total, 1);
  assert.equal(t.nodes[6].pct, 1);
});

test('representative build is the one closest to the majority', () => {
  const t = aggregateTalents(tree, players);
  assert.equal(t.representative.name, 'A');
  assert.equal(t.representative.loadoutText, 'build-A');
  assert.ok(t.representative.agreement > 0.7 && t.representative.agreement <= 1);
});

function item(id, ilvl, extra = {}) {
  return { id, ilvl, name: `Item ${id}`, icon: 'inv_x', quality: 4, bonuses: [1, 2], enchants: [], gems: [], tier: null, ...extra };
}

const gearPlayers = [
  {
    name: 'A',
    items: {
      hands: item(10, 334, { tier: '36', enchants: [{ name: '|cnIQ4:Battle Art: Falco Strikes|r' }] }),
      finger1: item(20, 334, { enchants: [{ name: 'Enchant Ring - Radiant Mastery' }] }),
      finger2: item(21, 334, { gems: [{ name: 'Gem A' }, { name: 'Gem A' }] }),
      trinket1: item(30, 334),
      trinket2: item(31, 334),
      mainhand: item(40, 334),
    },
  },
  {
    name: 'B',
    items: {
      hands: item(10, 321, { tier: '36' }),
      finger1: item(21, 334),
      finger2: item(22, 334),
      trinket1: item(31, 334),
      trinket2: item(32, 334),
      mainhand: item(41, 334),
      offhand: item(50, 334),
    },
  },
  {
    name: 'C',
    items: {
      hands: item(11, 334),
      finger1: item(20, 334),
      finger2: item(21, 334),
      trinket1: item(30, 334),
      trinket2: item(31, 334),
      mainhand: item(40, 334),
    },
  },
];

test('gear: per-slot counts, combined rings/trinkets and the two-hander row', () => {
  const g = Object.fromEntries(aggregateGear(gearPlayers).map((x) => [x.key, x]));
  const N = gearPlayers.length;

  assert.deepEqual(g.hands.items.map((i) => [i.id, i.count]), [[10, 2], [11, 1]]);
  assert.equal(g.hands.items[0].pct, 2 / 3);
  assert.deepEqual(g.hands.items[0].ilvl, { min: 321, max: 334, common: 334 });
  assert.equal(g.hands.items[0].tier, true);
  assert.deepEqual(g.hands.items[0].enchants, [{ name: 'Battle Art: Falco Strikes', count: 1 }]);

  // rings: each player wears two, counts are players per item
  assert.deepEqual(g.rings.items.map((i) => [i.id, i.count]), [[21, 3], [20, 2], [22, 1]]);
  assert.equal(g.rings.items.reduce((s, i) => s + i.count, 0) + g.rings.empty, 2 * N);
  assert.deepEqual(g.rings.items.find((i) => i.id === 21).gems, [{ name: 'Gem A', count: 1 }]);
  assert.deepEqual(g.rings.items.find((i) => i.id === 20).enchants, [{ name: 'Radiant Mastery', count: 1 }]);

  assert.deepEqual(g.trinkets.items.map((i) => [i.id, i.count]), [[31, 3], [30, 2], [32, 1]]);

  // single slots sum to N; missing off-hands become the "two-hander" count
  for (const key of ['hands', 'mainhand', 'offhand', 'head']) {
    assert.equal(g[key].items.reduce((s, i) => s + i.count, 0) + g[key].empty, N, key);
  }
  assert.equal(g.offhand.empty, 2);
  assert.deepEqual(g.mainhand.items[0].players, ['A', 'C']);
  assert.deepEqual(g.mainhand.items[0].variant, { bonuses: [1, 2], ilvl: 334 });
});

test('tier set summary', () => {
  assert.deepEqual(tierSetSummary(gearPlayers), { four: 0, two: 0, none: 3 });
  const four = { items: { head: { tier: 1 }, shoulder: { tier: 1 }, chest: { tier: 1 }, hands: { tier: 1 } } };
  const two = { items: { head: { tier: 1 }, legs: { tier: 1 }, shirt: { tier: 1 } } };
  assert.deepEqual(tierSetSummary([four, two, four]), { four: 2, two: 1, none: 0 }, 'shirt slot is not gear');
});

test('WoW escape sequences are stripped from names', () => {
  assert.equal(stripEscapes('|cffa335eeMark|r |A:Professions-ChatIcon-Quality-Tier3:20:20|a'), 'Mark');
  assert.equal(stripEscapes('|T123:0|t Gem'), 'Gem');
  assert.equal(cleanEnchantName('Enchant Chest - Mark of the Worldsoul'), 'Mark of the Worldsoul');
});

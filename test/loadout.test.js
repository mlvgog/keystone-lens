'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decodeLoadout, loadoutSpecId, ALPHABET } = require('../src/main/loadout');

/** Test-side encoder for Blizzard's export format (lowest bit first). */
function encode(specId, tree, picks, version = 2) {
  const bits = [];
  const put = (value, n) => {
    for (let i = 0; i < n; i++) bits.push((value >> i) & 1);
  };
  put(version, 8);
  put(specId, 16);
  for (let i = 0; i < 16; i++) put(0xab, 8);
  for (const id of tree.fullNodeOrder) {
    const p = picks[id];
    put(p ? 1 : 0, 1);
    if (!p) continue;
    put(p.granted ? 0 : 1, 1);
    if (p.granted) continue;
    put(p.rank != null ? 1 : 0, 1);
    if (p.rank != null) put(p.rank, 6);
    put(p.choice != null ? 1 : 0, 1);
    if (p.choice != null) put(p.choice, 2);
  }
  while (bits.length % 6) bits.push(0);
  let out = '';
  for (let i = 0; i < bits.length; i += 6) out += ALPHABET[bits.slice(i, i + 6).reduce((v, b, j) => v | (b << j), 0)];
  return out;
}

const TREE = {
  specId: 261,
  // Every node of the class's game tree, including ones this spec does not have (40, 99).
  fullNodeOrder: [1, 2, 3, 4, 5, 10, 11, 20, 21, 40, 99],
  classNodes: [
    { id: 1, type: 'single', maxRanks: 1, entries: [{ id: 101, maxRanks: 1 }] },
    { id: 2, type: 'single', maxRanks: 2, entries: [{ id: 102, maxRanks: 2 }] },
    { id: 3, type: 'choice', maxRanks: 1, entries: [{ id: 103, maxRanks: 1 }, { id: 104, maxRanks: 1 }] },
  ],
  specNodes: [
    { id: 4, type: 'tiered', maxRanks: 4, entries: [{ id: 105, maxRanks: 1 }, { id: 106, maxRanks: 2 }, { id: 107, maxRanks: 1 }] },
    { id: 5, type: 'single', maxRanks: 1, entries: [{ id: 108, maxRanks: 1 }] },
  ],
  heroNodes: [
    { id: 10, type: 'single', maxRanks: 1, subTreeId: 51, entries: [{ id: 110, maxRanks: 1 }] },
    { id: 11, type: 'single', maxRanks: 1, subTreeId: 51, entries: [{ id: 111, maxRanks: 1 }] },
    { id: 20, type: 'single', maxRanks: 1, subTreeId: 53, entries: [{ id: 120, maxRanks: 1 }] },
  ],
  subTreeNodes: [{ id: 21, type: 'subtree', maxRanks: 1, entries: [{ id: 130, traitSubTreeId: 53 }, { id: 131, traitSubTreeId: 51 }] }],
};

test('picks, partial ranks, choices, apex tiers and free nodes', () => {
  const text = encode(261, TREE, {
    1: {},
    2: { rank: 1 },
    3: { choice: 1 },
    4: { rank: 3 },
    5: { granted: true },
    10: { granted: true }, // root of the chosen hero tree
    11: {},
    20: { granted: true }, // root of the other hero tree: dropped
    21: { choice: 1 },
    40: { granted: true }, // another spec's node: dropped
  });
  assert.equal(loadoutSpecId(text), 261);
  const d = decodeLoadout(text, TREE);
  assert.equal(d.heroSubTreeId, 51);
  const byId = Object.fromEntries(d.nodes.map((n) => [n.nodeId, n]));
  assert.deepEqual(Object.keys(byId).map(Number), [1, 2, 3, 4, 5, 10, 11, 21]);
  assert.deepEqual(byId[1], { nodeId: 1, type: 0, entryIndex: 0, entryId: 101, rank: 1, granted: false });
  assert.equal(byId[2].rank, 1);
  assert.deepEqual([byId[3].type, byId[3].entryIndex, byId[3].entryId], [2, 1, 104]);
  // Apex: rank 3 of tiers 1 + 2 + 1 is the second tier.
  assert.deepEqual([byId[4].type, byId[4].rank, byId[4].entryIndex, byId[4].entryId], [1, 3, 1, 106]);
  assert.deepEqual([byId[5].granted, byId[10].granted, byId[11].granted], [true, true, false]);
  assert.deepEqual([byId[21].type, byId[21].entryId], [3, 131]);
});

test('readable errors for other specs, versions and garbage', () => {
  assert.throws(() => decodeLoadout(encode(260, TREE, {}), TREE), /another spec/);
  assert.throws(() => decodeLoadout(encode(261, TREE, {}, 1), TREE), /version 1/);
  assert.throws(() => decodeLoadout('not a talent string!', TREE), /not a talent string/);
  assert.throws(() => decodeLoadout('CUQA', TREE), /cut off/);
});

test('a real build decodes exactly like raider.io decodes it', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'loadout-261.json'), 'utf8'));
  const d = decodeLoadout(fx.loadoutText, fx.tree);
  assert.equal(d.heroSubTreeId, fx.expected.heroSubTreeId);
  const sort = (list) => [...list].sort((a, b) => a.nodeId - b.nodeId);
  assert.deepEqual(sort(d.nodes), sort(fx.expected.nodes));
});

test('import strings made from talent picks decode back to the same picks', () => {
  const { encodeLoadout } = require('../src/main/loadout');
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'loadout-261.json'), 'utf8'));
  const picks = decodeLoadout(fx.loadoutText, fx.tree);
  const again = decodeLoadout(encodeLoadout(picks, fx.tree), fx.tree);
  const sort = (list) => [...list].sort((a, b) => a.nodeId - b.nodeId);
  assert.equal(again.heroSubTreeId, picks.heroSubTreeId);
  assert.deepEqual(sort(again.nodes), sort(picks.nodes));
  // Synthetic tree: free nodes, partial ranks, choices and apex tiers survive the round trip.
  const d = decodeLoadout(encode(261, TREE, { 1: {}, 2: { rank: 1 }, 3: { choice: 1 }, 4: { rank: 3 }, 5: { granted: true }, 10: { granted: true }, 11: {}, 21: { choice: 1 } }), TREE);
  assert.deepEqual(sort(decodeLoadout(encodeLoadout(d, TREE), TREE).nodes), sort(d.nodes));
});

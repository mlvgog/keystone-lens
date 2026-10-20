'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clusterBuilds, buildDiffs, distance, signature } = require('../src/main/builds');

const ids = Array.from({ length: 12 }, (_, i) => i + 1);
const tree = {
  classNodes: ids.slice(0, 6).map((id) => ({ id, type: id === 2 ? 'choice' : 'single', entries: [{ id: id * 10, name: `N${id}` }, { id: id * 10 + 1, name: `N${id}b` }] })),
  specNodes: ids.slice(6).map((id) => ({ id, type: 'single', entries: [{ id: id * 10, name: `N${id}` }] })),
  heroNodes: [
    { id: 100, subTreeId: 40, entries: [{ id: 1000 }] },
    { id: 101, subTreeId: 41, entries: [{ id: 1010 }] },
  ],
};

function player(name, picks, hero = 40) {
  return {
    name,
    talents: {
      heroSubTreeId: hero,
      loadoutText: `L-${name}`,
      nodes: [...picks.map((id) => ({ nodeId: id, entryId: id * 10, rank: 1 })), { nodeId: hero === 40 ? 100 : 101, entryId: 0, rank: 1 }],
    },
  };
}

const A = [1, 2, 3, 4, 5, 6, 7, 8];
const B = [1, 2, 3, 9, 10, 11, 12];
const players = [
  player('a1', A),
  player('a2', A),
  player('a3', [...A.slice(0, 7)]), // one node less
  player('a4', [...A, 9]), // one node more
  player('a5', A),
  player('b1', B, 41),
  player('b2', B, 41),
  player('b3', [...B, 4], 41),
  player('odd', [5, 6, 7, 8, 9, 10, 11, 12], 41),
];

test('distance counts differing nodes; granted nodes are ignored', () => {
  const allowed = new Set([1, 2, 3]);
  const a = signature({ nodes: [{ nodeId: 1, entryId: 10, rank: 1 }, { nodeId: 2, entryId: 20, rank: 1 }, { nodeId: 3, rank: 1, granted: true }] }, allowed);
  const b = signature({ nodes: [{ nodeId: 1, entryId: 10, rank: 2 }, { nodeId: 2, entryId: 21, rank: 1 }] }, allowed);
  assert.equal(a.size, 2);
  assert.equal(distance(a, b), 2);
  assert.equal(distance(a, a), 0);
});

test('players with nearly identical picks share a build', () => {
  const res = clusterBuilds(tree, players, { threshold: 2 });
  assert.deepEqual(res.builds.map((b) => b.size), [5, 3]);
  assert.equal(res.singles, 1);
  const [a, b] = res.builds;
  assert.deepEqual(a.members, [0, 1, 2, 3, 4]);
  assert.equal(a.heroSubTreeId, 40);
  assert.equal(b.heroSubTreeId, 41);
  assert.ok(['a1', 'a2', 'a5'].includes(a.medoidName), 'the medoid is a central (unmodified) build');
  assert.equal(a.loadoutText, `L-${a.medoidName}`);
  assert.equal(res.assignment[8], null, 'the outlier belongs to no build');
  assert.equal(res.assignment[6], b.id);
});

test('the default threshold adapts to the spec but stays within 4..10', () => {
  const res = clusterBuilds(tree, players);
  assert.ok(res.threshold >= 4 && res.threshold <= 10);
  assert.equal(clusterBuilds(tree, []).builds.length, 0);
});

test('build differences against the overall majority', () => {
  const stats = (pcts) => Object.fromEntries(Object.entries(pcts).map(([id, pct]) => [id, { pct, total: 10, entries: {} }]));
  const base = stats({ 1: 1, 4: 0.8, 9: 0.2, 2: 1 });
  const build = stats({ 1: 1, 4: 0, 9: 1, 2: 1 });
  base[2].entries = { 20: 9, 21: 1 };
  build[2].entries = { 20: 2, 21: 8 };
  const diffs = buildDiffs(tree, build, base);
  const byNode = Object.fromEntries(diffs.map((d) => [d.nodeId, d]));
  assert.equal(byNode[9].kind, 'add');
  assert.equal(byNode[4].kind, 'drop');
  assert.equal(byNode[2].kind, 'swap');
  assert.equal(byNode[2].name, 'N2b');
  assert.equal(byNode[1], undefined);
  assert.ok(diffs[0].delta >= diffs[diffs.length - 1].delta, 'sorted by size of the difference');
});

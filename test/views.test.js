'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildView, playerDetail } = require('../src/main/views');
const history = require('../src/main/history');
const { statProfile, summarizeGear } = require('../src/main/gearSummary');
const { variantKeyOf } = require('../src/main/aggregate');

const tree = {
  classNodes: [
    { id: 1, type: 'single', entries: [{ id: 10, name: 'One' }] },
    { id: 2, type: 'single', entries: [{ id: 20, name: 'Two' }] },
  ],
  specNodes: [{ id: 3, type: 'single', entries: [{ id: 30, name: 'Three' }] }],
  heroNodes: [
    { id: 4, subTreeId: 40, entryNode: true, entries: [{ id: 40, icon: 'a' }] },
    { id: 5, subTreeId: 41, entryNode: true, entries: [{ id: 50, icon: 'b' }] },
  ],
  subTrees: [
    { id: 40, name: 'Alpha', icon: 'a' },
    { id: 41, name: 'Beta', icon: 'b' },
  ],
};

const item = (id, ilvl, extra = {}) => ({ id, ilvl, name: `Item ${id}`, icon: 'x', quality: 4, bonuses: [], enchants: [], gems: [], tier: null, ...extra });

function entry(picks, hero, items, level = 20) {
  return {
    run: { id: level, dungeon: 'Somewhere', level, score: 400, completedAt: '2026-10-10T00:00:00Z', version: '12.1.0' },
    fallback: false,
    talents: { heroSubTreeId: hero, loadoutText: `L${picks.join('')}`, nodes: [...picks, hero === 40 ? 4 : 5].map((n) => ({ nodeId: n, entryId: n * 10, rank: 1 })) },
    items,
    itemLevel: 330,
  };
}

function session() {
  const players = [
    { name: 'P1', main: entry([1, 2, 3], 40, { head: item(100, 334), mainhand: item(200, 334) }), dungeons: { 9: entry([1, 3], 40, { head: item(101, 330) }) } },
    { name: 'P2', main: entry([1, 2, 3], 40, { head: item(100, 334), mainhand: item(200, 334) }), dungeons: { 9: null } },
    { name: 'P3', main: entry([1, 3], 41, { head: item(101, 321), mainhand: item(201, 334), offhand: item(300, 334) }), dungeons: { 9: entry([2, 3], 41, { head: item(101, 321) }) } },
    { name: 'P4', main: entry([1, 3], 41, { head: item(100, 334), mainhand: item(201, 334), offhand: item(300, 334) }), dungeons: {} },
  ].map((p, i) => ({ rank: i + 1, realm: 'R', realmSlug: 'r', region: 'eu', score: 3000 - i, links: {}, candidates: [], ...p }));
  return {
    meta: { classSlug: 'mage', specSlug: 'frost', region: 'world', requested: 4, since: null, patch: '12.1.0', generatedAt: '2026-10-20T00:00:00.000Z', dungeons: [{ id: 9, name: 'Somewhere' }] },
    tree,
    players,
    itemInfo: {},
    itemSources: { 100: { kind: 'raid', label: 'Raid', detail: 'Big Raid' }, 200: { kind: 'crafted', label: 'Crafted', slot: 17 }, 201: { slot: 13 }, 300: { slot: 23 } },
  };
}

test('unfiltered view: everyone, hero shares, tooltips and sources attached', async () => {
  const s = session();
  const v = await buildView(s, {}, { getTooltip: async (x) => ({ tooltip: `<b>${x.id}</b>` }) });
  assert.equal(v.sampleSize, 4);
  assert.equal(v.baseSize, 4);
  assert.deepEqual(v.hero.map((h) => [h.name, h.count]), [['Alpha', 2], ['Beta', 2]]);
  assert.equal(v.talents.nodes[2].pct, 0.5);
  const head = v.gear.find((g) => g.key === 'head');
  assert.equal(head.items[0].id, 100);
  assert.equal(head.items[0].tooltip, '<b>100</b>');
  assert.equal(head.items[0].source.detail, 'Big Raid');
  assert.deepEqual(v.players.map((p) => p.name), ['P1', 'P2', 'P3', 'P4']);
  assert.deepEqual(v.gearSummary.weapons, [{ label: 'One-hander + off-hand', count: 2 }, { label: 'Two-hander', count: 2 }]);
});

test('hero filter narrows talents, gear and players', async () => {
  const v = await buildView(session(), { hero: 41 });
  assert.equal(v.sampleSize, 2);
  assert.equal(v.baseSize, 4, 'hero shares still describe everyone');
  assert.equal(v.talents.nodes[2].pct, 0);
  assert.equal(v.talents.nodes[5].pct, 1);
  assert.deepEqual(v.players.map((p) => p.name), ['P3', 'P4']);
});

test('dungeon view uses each player’s key in that dungeon and skips players without one', async () => {
  const v = await buildView(session(), { dungeon: 9 });
  assert.equal(v.dungeon.name, 'Somewhere');
  assert.equal(v.sampleSize, 2);
  assert.deepEqual(v.players.map((p) => p.name), ['P1', 'P3']);
  assert.equal(v.gear.find((g) => g.key === 'head').items[0].id, 101);
});

test('build filter keeps the build’s members and flags differing nodes', async () => {
  const s = session();
  const all = await buildView(s, {});
  assert.ok(all.builds.list.length >= 1);
  const b = all.builds.list[0];
  const v = await buildView(s, { build: b.id });
  assert.equal(v.sampleSize, b.size);
  assert.deepEqual(v.players.map((p) => p.index).sort(), [...b.members].sort());
});

test('trends compare with a saved snapshot, only without other filters', async () => {
  const s = session();
  const now = await buildView(s, {});
  const old = history.snapshotOf(now, s.meta);
  old.nodes[2] = 0.9; // node 2 dropped from 90% to 50%
  old.items.head[100] = 0.25; // item 100 rose from 25% to 75%
  const deps = { getSnapshot: async () => old };
  const v = await buildView(s, { trendsSince: 'x' }, deps);
  assert.equal(v.trends.nodes[2], -0.4);
  assert.equal(v.trends.items.head[100], 0.5);
  assert.equal(v.trends.biggest[0].type, 'item');
  const filtered = await buildView(s, { trendsSince: 'x', hero: 40 }, deps);
  assert.equal(filtered.trends, null);
});

test('player detail includes item sources', () => {
  const d = playerDetail(session(), 0);
  assert.equal(d.name, 'P1');
  assert.equal(d.items.head.source.detail, 'Big Raid');
  assert.equal(playerDetail(session(), 1, 9), null, 'P2 has no key in dungeon 9');
});

test('history keeps one snapshot per id, newest first, capped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplus-history-'));
  history.init(dir);
  const key = history.keyFor(session().meta);
  for (let i = 0; i < 45; i++) {
    const at = new Date(Date.UTC(2026, 8, 1 + i)).toISOString();
    await history.save(key, { id: at, generatedAt: at, patch: '12.1.0', sampleSize: 4, nodes: {}, entries: {}, hero: {}, items: {} });
  }
  const at = new Date(Date.UTC(2026, 8, 45)).toISOString();
  await history.save(key, { id: at, generatedAt: at, patch: '12.1.1', sampleSize: 4, nodes: {}, entries: {}, hero: {}, items: {} });
  const list = await history.list(key);
  assert.equal(list.length, 40);
  assert.equal(list[0].patch, '12.1.1');
  assert.ok(Date.parse(list[0].generatedAt) > Date.parse(list[1].generatedAt));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stat profile and gear summary', () => {
  const head = item(1, 334, { enchants: [{ name: 'Enchant Head - Rune' }], gems: [{ name: '16 Mast & 7 Crit' }] });
  const ring = item(2, 334);
  const players = [
    { name: 'A', items: { head, finger1: ring } },
    { name: 'B', items: { head: item(1, 334), finger1: ring } },
  ];
  const info = {
    [variantKeyOf(head)]: { stats: { crit: 100, haste: 0, mastery: 0, vers: 0 }, embellished: true },
    [variantKeyOf(item(1, 334))]: { stats: { crit: 100, haste: 0, mastery: 0, vers: 0 }, embellished: true },
    [variantKeyOf(ring)]: { stats: { crit: 0, haste: 100, mastery: 0, vers: 0 }, embellished: true },
  };
  const profile = statProfile(players, info);
  const share = Object.fromEntries(profile.stats.map((s) => [s.key, s.share]));
  assert.ok(Math.abs(share.crit + share.haste + share.mastery + share.vers - 1) < 1e-9);
  assert.equal(profile.order[0], 'Critical Strike');
  const summary = summarizeGear(players, info, {});
  assert.deepEqual(summary.enchants, [{ key: 'head', label: 'Head', players: 1, top: [{ name: 'Rune', count: 1 }] }]);
  assert.equal(summary.gems.avgSockets, 0.5);
  assert.equal(summary.embellishments.withTwo, 2);
  assert.equal(summary.embellishments.items[0].count, 2);
});

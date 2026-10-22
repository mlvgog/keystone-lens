'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { averageItemLevel, quantile, summarize, percentileOf, buildTable, compareYou, defaultLevels, sameDungeon } = require('../src/main/throughput');
const { wclName } = require('../src/main/sources/wcl');

const run = (amount, extra = {}) => ({ amount, duration: 1_800_000, level: 18, ...extra });

test('quantiles and summaries', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([10], 0.25), 10);
  assert.equal(quantile([], 0.5), null);
  const s = summarize([run(100), run(300), run(200, { ilvl: 320 }), run(400, { ilvl: 330 })]);
  assert.equal(s.n, 4);
  assert.equal(s.median, 250);
  assert.equal(s.mean, 250);
  assert.equal(s.p25, 175);
  assert.equal(s.p75, 325);
  assert.equal(s.min, 100);
  assert.equal(s.max, 400);
  assert.equal(s.ilvl, 325);
  assert.equal(summarize([]), null);
});

test('percentile counts ties as half', () => {
  const runs = [run(100), run(200), run(300), run(400)];
  assert.equal(percentileOf(runs, 250), 0.5);
  assert.equal(percentileOf(runs, 100), 0.125);
  assert.equal(percentileOf(runs, 500), 1);
  assert.equal(percentileOf([], 1), null);
});

test('equipped item level: shirt and tabard ignored, a two-hander counts twice', () => {
  const gear = Array.from({ length: 19 }, (_, i) => ({ id: i + 1, itemLevel: '320' }));
  gear[3] = { id: 99, itemLevel: '1' }; // shirt
  gear[18] = { id: 98, itemLevel: '1' }; // tabard
  assert.equal(averageItemLevel(gear), 320);
  const twoHander = gear.map((g) => ({ ...g }));
  twoHander[15] = { id: 50, itemLevel: '336' };
  twoHander[16] = { id: 0, itemLevel: '0' }; // empty off hand
  assert.equal(averageItemLevel(twoHander), 322); // (14 * 320 + 2 * 336) / 16
  assert.equal(averageItemLevel([]), null);
  assert.equal(averageItemLevel([{ id: 1, itemLevel: '320' }]), null, 'too few items to trust');
});

const dungeons = [
  { id: 1, name: 'Alpha' },
  { id: 2, name: 'Beta' },
];
const runs = {
  1: { 17: [run(100, { level: 17, ilvl: 320 }), run(120, { level: 17, ilvl: 321 })], 18: [run(140, { level: 18, ilvl: 326 })] },
  2: { 17: [run(200, { level: 17, ilvl: 320 })], 18: [] },
};

test('table by key level', () => {
  const t = buildTable({ dungeons, runs, levels: [17, 18] });
  assert.deepEqual(t.columns.map((c) => c.label), ['+17', '+18']);
  assert.equal(t.rows[0].cells[17].median, 110);
  assert.equal(t.rows[0].cells[18].n, 1);
  assert.equal(t.rows[1].cells[18], null);
  assert.equal(t.rows[0].all.n, 3);
  assert.equal(t.total.cells[17].n, 3);
  assert.equal(t.total.all.n, 4);
});

test('table by item level pools key levels into item-level ranges', () => {
  const t = buildTable({ dungeons, runs, levels: [17, 18], groupBy: 'ilvl', minPerColumn: 1 });
  assert.deepEqual(t.columns.map((c) => c.label), ['318–320', '321–323', '324–326']);
  assert.equal(t.rows[0].cells[318].n, 1);
  assert.equal(t.rows[1].cells[318].median, 200);
  assert.equal(t.total.cells[318].n, 2);
  const strict = buildTable({ dungeons, runs, levels: [17, 18], groupBy: 'ilvl', minPerColumn: 2 });
  assert.deepEqual(strict.columns.map((c) => c.key), [318], 'thin item-level ranges are hidden');
});

test('your runs: compared at the same key level, without yourself, only with enough runs', () => {
  const sample = Array.from({ length: 10 }, (_, i) => run(100 + i * 10, { level: 18, name: `P${i}`, server: 'X' }));
  sample.push(run(500, { level: 18, name: 'Me', server: 'Home Realm' })); // my own run is in the rankings
  const specRuns = { 1: { 18: sample, 19: [run(300, { level: 19, name: 'Other', server: 'X' })] } };
  const mine = { 1: [run(150, { level: 18, name: 'Me' }), run(500, { level: 18, name: 'Me' }), run(310, { level: 19, name: 'Me' }), run(999, { level: 25 })] };
  const res = compareYou({ dungeons: [dungeons[0]], runs: specRuns, yourRuns: mine, levels: [18, 19], self: { name: 'Me', realm: 'Home Realm' } });
  const d = res[1];
  assert.equal(d.runs.length, 3, 'keys outside the level range are ignored');
  const at18 = d.byLevel[18];
  assert.equal(at18.amount, 500, 'best run per level');
  assert.equal(at18.n, 10, 'my own logged run is not part of the comparison');
  assert.equal(at18.median, 145);
  assert.equal(at18.percentile, 1);
  assert.equal(Math.round(at18.delta * 1000) / 1000, Math.round((500 / 145 - 1) * 1000) / 1000);
  const at19 = d.byLevel[19];
  assert.equal(at19.median, null, 'only one other run at +19');
  assert.equal(at19.percentile, null);
  assert.equal(d.best.level, 18, 'the headline is the highest level that can be compared');
});

test('defaults and name matching', () => {
  assert.deepEqual(defaultLevels([17, 21, 19]), { from: 16, to: 21 }, 'top players’ 6 highest levels');
  assert.deepEqual(defaultLevels([5]), { from: 5, to: 10 });
  assert.deepEqual(defaultLevels([17, 21], [9, 12, 11]), { from: 7, to: 12 }, 'your own 6 highest levels win');
  assert.ok(sameDungeon("Kings' Rest", "King's Rest"));
  assert.ok(!sameDungeon('Murder Row', 'Altar of Fangs'));
  assert.equal(wclName('Death Knight'), 'DeathKnight');
  assert.equal(wclName('Beast Mastery'), 'BeastMastery');
});

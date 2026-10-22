'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { itemStats, isEmbellished, parseSimcTable } = require('../src/main/sources/itemData');

// Real game-table values (build 12.1.5) for item levels 219 (an item's base level), 331 and 344.
function multAt(values) {
  const arr = [];
  for (const [ilvl, v] of Object.entries(values)) arr[Number(ilvl) - 1] = v;
  return arr;
}
const armorRatings = multAt({ 219: 1.244931535, 331: 0.8131689, 344: 0.758561541 });
const stamina = multAt({ 219: 10.37114118, 331: 13.7292879, 344: 14.12120732 });
const TABLES = {
  budget: {
    219: [122.80396270752, 92.10297393799, 69.07723236084, 61.40198135376, 61.40198135376],
    331: [348.67669677734, 261.5075378418, 196.13064575195, 174.33834838867, 174.33834838867],
    344: [393.5751953125, 295.18139648438, 221.38604736328, 196.78759765625, 196.78759765625],
  },
  ratingMult: [armorRatings, armorRatings, armorRatings, multAt({ 219: 1.30965491, 344: 1.10491686 })],
  staminaMult: [stamina, stamina, stamina, stamina],
};

// Tempered Horns of the Jade Warlord (head): Str/Int, Stamina, Crit, Haste.
const HELM = { inventoryType: 1, limitCategory: 0, sockets: 0, stats: [[74, 5259], [7, 7889], [32, 4881], [36, 2119]] };

test('item stats at an item level match the in-game tooltip', () => {
  // Wowhead / in-game at 344: +207 [Strength or Intellect], +4,385 Stamina, +146 Crit, +63 Haste.
  assert.deepEqual(itemStats(HELM, [], 344, TABLES), {
    primary: { name: 'Strength/Intellect', value: 207 },
    stamina: 4385,
    secondary: { crit: 146, haste: 63, mastery: 0, vers: 0 },
    randomStats: 0,
    sockets: 0,
  });
  // Base version (the item XML): +65, +1,005, +75 Crit, +32 Haste.
  const base = itemStats(HELM, [], 219, TABLES);
  assert.deepEqual([base.primary.value, base.stamina, base.secondary.crit, base.secondary.haste], [65, 1005, 75, 32]);
});

test('crafted items get the secondary stats chosen when crafting, plus bonus sockets', () => {
  // Adherent's Silken Shroud (back) crafted with Mastery + Haste at 331: 56 / 56 in game.
  const cloak = { inventoryType: 16, limitCategory: 0, sockets: 0, stats: [[71, 5259], [7, 7889], [24, 3500], [25, 3500]] };
  const bonuses = [
    { type: 25, values: [49, 100, 0, 0], order: 0 },
    { type: 25, values: [36, 100, 0, 0], order: 1 },
    { type: 6, values: [1, 0, 0, 0], order: 0 },
  ];
  const s = itemStats(cloak, bonuses, 331, TABLES);
  assert.deepEqual(s.secondary, { crit: 0, haste: 56, mastery: 56, vers: 0 });
  assert.equal(s.primary.name, 'Agility/Strength/Intellect');
  assert.equal(s.sockets, 1);
  assert.equal(s.randomStats, 0);
  // Without a crafting choice the two stats were rolled on drop (e.g. Bound Serpent's Jade Eye).
  assert.equal(itemStats(cloak, [], 331, TABLES).randomStats, 2);
});

test('embellishment comes from the "Embellished (2)" limit category', () => {
  assert.equal(isEmbellished(HELM, []), false);
  assert.equal(isEmbellished(HELM, [{ type: 35, values: [512, 0, 0, 0], order: 0 }]), true);
  assert.equal(isEmbellished({ ...HELM, limitCategory: 512 }, []), true);
  assert.equal(isEmbellished(HELM, [{ type: 25, values: [12715, 0, 0, 0], order: 0 }]), false);
});

test('SimulationCraft tables are read with comments stripped', () => {
  const text = 'static constexpr double __x[][3] = {\n  // Armor\n  {\n    1.5,\t1.25,\t2,\t//    3\n  },\n  {\n    3, 4, 5,\n  },\n};';
  assert.deepEqual(parseSimcTable(text, '__x'), [[1.5, 1.25, 2], [3, 4, 5]]);
});

test('crafted stats from a SimulationCraft export win over the bonus IDs', () => {
  const cloak = { inventoryType: 16, limitCategory: 0, sockets: 0, stats: [[71, 5259], [7, 7889], [24, 3500], [25, 3500]] };
  const bonuses = [
    { type: 25, values: [49, 100, 0, 0], order: 0 },
    { type: 25, values: [36, 100, 0, 0], order: 1 },
  ];
  assert.deepEqual(itemStats(cloak, bonuses, 331, TABLES, { craftedStats: [40, 49] }).secondary, { crit: 0, haste: 0, mastery: 56, vers: 56 });
});

test('catalysed items keep the stats of the item they were made from', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cache = require('../src/main/cache');
  const { describeVariants } = require('../src/main/sources/itemData');
  cache.init(fs.mkdtempSync(path.join(os.tmpdir(), 'kl-items-')));
  await cache.write('gameTables', 'item-scaling-v1', TABLES);
  // Chosen Bloodslayer's Spirit Shroud (Mastery/Crit) made from Spare Speaker's Hood (Haste/Crit).
  await cache.write('itemData', '271510', { inventoryType: 1, limitCategory: 0, sockets: 0, stats: [[73, 5259], [7, 7889], [49, 4667], [32, 2333]] });
  await cache.write('itemData', '273791', { inventoryType: 1, limitCategory: 0, sockets: 0, stats: [[73, 5259], [7, 7889], [36, 4000], [32, 3000]] });
  await cache.write('itemBonus', '12854', [{ type: 3, values: [4, 0, 0, 0], order: 1 }]);
  const out = await describeVariants([
    { key: 'catalysed', id: 271510, bonuses: [12854], ilvl: 344, statsFrom: 273791 },
    { key: 'plain', id: 271510, bonuses: [12854], ilvl: 344 },
  ]);
  assert.deepEqual(out.catalysed.stats, { crit: 90, haste: 119, mastery: 0, vers: 0 });
  assert.deepEqual(out.plain.stats, { crit: 70, haste: 0, mastery: 139, vers: 0 });
  assert.equal(out.catalysed.quality, 4);
});

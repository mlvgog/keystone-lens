'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStats, gemStats, isEmbellished, droppedBy, parseSourceXml, classifySource, isTwoHandSlot } = require('../src/main/itemInfo');

const TOOLTIP =
  '<table><tr><td><b class="q4">Speakeasy Shroud</b><br>Item Level <!--ilvl-->334</span>' +
  '<span><!--stat71-->+106 [Agility or Strength or Intellect]</span><br><span><!--stat7-->+2,199 Stamina</span>' +
  '<br><span class="q2">+<!--rtg32-->66 Critical Strike</span><br><span class="q2">+<!--rtg49-->1,047 Mastery</span>' +
  '<br>Unique-Equipped: Embellished (2)<div class="whtt-extra whtt-droppedby">Dropped by: Zaen Bladesorrow</div></td></tr></table>';

test('secondary stats come from the rating markers (with thousands separators)', () => {
  assert.deepEqual(parseStats(TOOLTIP), { crit: 66, haste: 0, mastery: 1047, vers: 0 });
  assert.deepEqual(parseStats(''), { crit: 0, haste: 0, mastery: 0, vers: 0 });
});

test('gem names, embellishments and drop source', () => {
  assert.deepEqual(gemStats('16 Mast & 7 Crit'), { crit: 7, haste: 0, mastery: 16, vers: 0 });
  assert.deepEqual(gemStats('16 Haste & 7 Vers'), { crit: 0, haste: 16, mastery: 0, vers: 7 });
  assert.deepEqual(gemStats('32 Primary'), { crit: 0, haste: 0, mastery: 0, vers: 0 });
  assert.equal(isEmbellished(TOOLTIP), true);
  assert.equal(isEmbellished('<b>Plain item</b>'), false);
  assert.equal(droppedBy(TOOLTIP), 'Zaen Bladesorrow');
  assert.equal(droppedBy('<b>no source</b>'), null);
});

test('wowhead item XML', () => {
  const xml =
    '<?xml version="1.0"?><wowhead><item id="245770"><json><![CDATA["classs":2,"slot":17,"source":[1],' +
    '"sourcemore":[{"c":11,"n":"Aln\'hara Cane","s":773,"t":6}]]]></json></item></wowhead>';
  assert.deepEqual(parseSourceXml(xml), { source: [1], more: [{ c: 11, n: "Aln'hara Cane", s: 773, t: 6 }], slot: 17 });
  assert.deepEqual(parseSourceXml('<wowhead><error>Item not found!</error></wowhead>'), { source: [], more: [], slot: null });
  assert.equal(isTwoHandSlot(17), true);
  assert.equal(isTwoHandSlot(13), false);
});

test('source classification', () => {
  const seasonDungeons = [{ id: 16091, name: 'Murder Row' }];
  const raids = [{ zoneId: 16915, name: 'The Venomous Abyss', encounters: ["Ula'tek", 'Sszorak'] }];
  const ctx = { seasonDungeons, raids };
  assert.equal(classifySource({ ...ctx, tier: true }).kind, 'tier');
  assert.deepEqual(classifySource({ ...ctx, src: { source: [1], more: [{ s: 197 }] } }), { kind: 'crafted', label: 'Crafted', detail: 'Tailoring' });
  assert.deepEqual(classifySource({ ...ctx, src: { source: [2], more: [{ z: 16091 }] }, boss: 'Zaen Bladesorrow' }), {
    kind: 'mplus',
    label: 'M+',
    detail: 'Murder Row',
    boss: 'Zaen Bladesorrow',
  });
  assert.equal(classifySource({ ...ctx, src: { source: [2], more: [{ z: 16915 }] } }).detail, 'The Venomous Abyss');
  // Boss known only by name (NPC entry in the XML) still maps to its raid.
  const byName = classifySource({ ...ctx, src: { source: [2], more: [{ t: 1, n: "Ula'tek" }] } });
  assert.equal(byName.kind, 'raid');
  assert.equal(byName.boss, "Ula'tek");
  assert.deepEqual(classifySource({ ...ctx, src: { source: [2], more: [] }, boss: 'Somebody' }), { kind: 'drop', label: 'Drop', detail: 'Somebody' });
  assert.equal(classifySource({ ...ctx, src: { source: [5], more: [] } }).label, 'Vendor');
  assert.equal(classifySource({ ...ctx, src: {} }).label, 'Other');
});

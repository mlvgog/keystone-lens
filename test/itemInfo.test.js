'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { gemStats, parseItemXml, classifySource, isTwoHandSlot } = require('../src/main/itemInfo');

// Shortened from www.wowhead.com/item=270175&xml (Voracious Heart of Ula'tek, base item level 219).
const TRINKET_XML =
  '<?xml version="1.0" encoding="UTF-8"?><wowhead><item id="270175"><name><![CDATA[Voracious Heart of Ula\'tek]]></name><level>219</level>' +
  '<htmlTooltip><![CDATA[<table><tr><td><!--nstart--><b class="q4">Voracious Heart of Ula\'tek</b><!--nend--><span class="q"><br>Item Level <!--ilvl-->219</span>' +
  '<br>Binds when picked up<table width="100%"><tr><td>Trinket</td><th><!--scstart4:-4--><span class="q1"></span><!--scend--></th></tr></table>' +
  '<span class="q2">+<!--rtg32-->76 Critical Strike</span></td></tr></table><table><tr><td><span id="useText2" class="q2">Use: ' +
  '<a href="https://www.wowhead.com/spell=1297761" class="q2">Bite the heart, gaining <!--pts1:0:0:1297760:1.21834-->150<!----> Strength or Agility for 20 sec.' +
  '<br /><br />Deals <!--pts2:0:0:1297760:19.8644-->3525<!----> Physical damage.</a> (1 Min, 30 Sec Cooldown)</span>' +
  '<div class="whtt-extra whtt-droppedby">Dropped by: Ula&#39;tek</div></td></tr></table>]]></htmlTooltip>' +
  '<json><![CDATA["classs":4,"slot":12,"source":[2],"sourcemore":[{"n":"Ula\'tek","t":1,"z":16915}]]]></json></item></wowhead>';

test('gem names', () => {
  assert.deepEqual(gemStats('16 Mast & 7 Crit'), { crit: 7, haste: 0, mastery: 16, vers: 0 });
  assert.deepEqual(gemStats('16 Haste & 7 Vers'), { crit: 0, haste: 16, mastery: 0, vers: 7 });
  assert.deepEqual(gemStats('32 Primary'), { crit: 0, haste: 0, mastery: 0, vers: 0 });
});

test('item XML: source, slot type and boss', () => {
  const x = parseItemXml(TRINKET_XML);
  assert.deepEqual(x.source, [2]);
  assert.deepEqual(x.more, [{ n: "Ula'tek", t: 1, z: 16915 }]);
  assert.equal(x.slot, 12);
  assert.equal(x.slotType, 'Trinket');
  assert.equal(x.droppedBy, "Ula'tek");
  const missing = parseItemXml('<wowhead><error>Item not found!</error></wowhead>');
  assert.deepEqual([missing.source, missing.slotType, missing.droppedBy], [[], null, null]);
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
  assert.equal(classifySource({ ...ctx, src: parseItemXml(TRINKET_XML) }).detail, 'The Venomous Abyss');
  // Boss known only by name (NPC entry in the XML) still maps to its raid.
  const byName = classifySource({ ...ctx, src: { source: [2], more: [{ t: 1, n: "Ula'tek" }] } });
  assert.equal(byName.kind, 'raid');
  assert.equal(byName.boss, "Ula'tek");
  assert.deepEqual(classifySource({ ...ctx, src: { source: [2], more: [] }, boss: 'Somebody' }), { kind: 'drop', label: 'Drop', detail: 'Somebody' });
  assert.equal(classifySource({ ...ctx, src: { source: [5], more: [] } }).label, 'Vendor');
  assert.equal(classifySource({ ...ctx, src: {} }).label, 'Other');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSimc } = require('../src/main/simc');
const { averageItemLevel } = require('../src/main/simcImport');

// Shape of a real SimulationCraft addon export (character made up).
const EXPORT = `# Testrogue - Subtlety - 2026-10-22 19:36 - EU/Tarren Mill
# SimC Addon 12.1.5-02
# WoW 12.1.5.70448, TOC 120105

rogue="Testrogue"
level=90
race=night_elf
region=eu
server=tarren-mill
role=attack
spec=subtlety
# loot_spec=subtlety

talents=CUQAACTIVE

# Saved Loadout: big
# talents=CUQABIG
# Saved Loadout: current gaming time
# talents=CUQACURRENT

# Chosen Bloodslayer's Spirit Shroud (334)
head=,id=271510,enchant_id=8017,bonus_id=40/13696/13692/13698/12854,redirected_base_stats=273791
# Aqirbane Reliquary (334)
neck=,id=268265,gem_id=240983/240900,bonus_id=6652/13668/13334/13987/12854
# Darnassus Tabard (1)
tabard=,id=45579,content_tuning=876
# Silvermoon Agent's Deflectors (331)
wrist=,id=244576,bonus_id=12214/13667/12497/13751/14001/8793/13836/13696,content_tuning=3615,crafted_stats=40/49,crafting_quality=5
# Sharpened Lightwood Slasher (340)
main_hand=,id=275070,enchant_id=8689,bonus_id=6652/12856
# Farstrider's Mercy (338)
off_hand=,id=237837,enchant_id=8689,bonus_id=12214/13852/12497/13751/14001/12693/8960/8793/13836,crafted_stats=32/49

### Additional Character Info
#
# upgrade_currencies=c:3442:19/c:3445:6
#
# Checksum: 6b8a401a
`;

test('character, talents and saved loadouts', () => {
  const s = parseSimc(EXPORT);
  assert.deepEqual(
    [s.className, s.name, s.region, s.realmSlug, s.specName, s.level, s.talents],
    ['Rogue', 'Testrogue', 'eu', 'tarren-mill', 'Subtlety', 90, 'CUQAACTIVE']
  );
  assert.deepEqual(s.loadouts, [
    { name: 'big', talents: 'CUQABIG' },
    { name: 'current gaming time', talents: 'CUQACURRENT' },
  ]);
});

test('items with bonus IDs, gems, enchant, crafted stats, catalyst source, item level and name', () => {
  const s = parseSimc(EXPORT);
  assert.deepEqual(s.items.map((i) => i.slot), ['head', 'neck', 'wrist', 'mainhand', 'offhand']);
  const [head, neck, wrist] = s.items;
  assert.deepEqual(head, {
    slot: 'head',
    id: 271510,
    bonuses: [40, 13696, 13692, 13698, 12854],
    enchantId: 8017,
    gemIds: [],
    craftedStats: [],
    statsFrom: 273791,
    ilvl: 334,
    name: "Chosen Bloodslayer's Spirit Shroud",
  });
  assert.deepEqual(neck.gemIds, [240983, 240900]);
  assert.deepEqual([wrist.craftedStats, wrist.ilvl, wrist.statsFrom], [[40, 49], 331, null]);
});

test('text that is not a SimulationCraft export', () => {
  assert.throws(() => parseSimc('hello'), /not a SimulationCraft export/);
  assert.throws(() => parseSimc('rogue="Nameless"\nlevel=90'), /not a SimulationCraft export/);
});

test('equipped item level counts a two-hander for both hands', () => {
  const one = (ilvl, extra = {}) => ({ ilvl, ...extra });
  const slots = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'finger1', 'finger2', 'trinket1', 'trinket2'];
  const base = Object.fromEntries(slots.map((s) => [s, one(320)]));
  assert.equal(averageItemLevel({ ...base, mainhand: one(336), offhand: one(336) }), 322);
  assert.equal(averageItemLevel({ ...base, mainhand: one(336, { twoHand: true }) }), 322);
  assert.equal(averageItemLevel({ ...base, mainhand: one(336) }), 301);
});

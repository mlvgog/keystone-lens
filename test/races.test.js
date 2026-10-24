'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RACES, raceOf, raceByKey, hasBit, parseRacialSpells, racialsFor } = require('../src/main/races');
const { createDiscovery } = require('../src/main/discovery');
const { parseSimc } = require('../src/main/simc');
const { buildView } = require('../src/main/views');
const { session } = require('./helpers/session');

// A few rows in the layout of SimulationCraft's generated racial_spells.inc:
// [race mask, class mask, spell id, name]
const ROWS = [
  [0x8, 0x3fff, 58984, 'Shadowmeld'],
  [0x8, 0x408, 21009, 'Elusiveness'],
  [0x200, 0x3fff, 154742, 'Arcane Acuity'],
  [0x200, 0x2, 155145, 'Arcane Torrent'],
  [0x200, 0x1, 69179, 'Arcane Torrent'],
  [0x200, 0x100, 28730, 'Arcane Torrent'],
  [0x18000, 0x1000, 369536, 'Soar'],
  [0x18000, 0x3fff, 358731, 'Glide'],
  [0x18000, 0x3fff, 358733, 'Glide'],
  [0x18000, 0x3fff, 357214, 'Wing Buffet'],
  [0x180000, 0x0, 1238623, 'Lash Out'],
  [0x3800000, 0x3fff, 107079, 'Quaking Palm'],
  [0x80000000, 0x3fff, 287712, 'Haymaker'],
  [0x80000000, 0x3fff, 291417, "Rime of the \\\"Ancient\\\" Mariner"],
];
const hex = (n, width) => `0x${n.toString(16).padStart(width, '0')}`;
const SIMC = [
  '// Racial abilities, wow build 12.1.5.70575',
  `static constexpr std::array<racial_spell_entry_t, ${ROWS.length}> __racial_spell_data { {`,
  ...ROWS.map(([race, cls, id, name]) => `  { ${hex(race, 16)}, ${hex(cls, 8)}, ${String(id).padStart(7)}, "${name}" },`),
  '} };',
].join('\n');

test('every race has its own race bits, and every race id belongs to one race', () => {
  const bits = RACES.flatMap((r) => r.bits);
  assert.equal(new Set(bits).size, bits.length);
  const ids = RACES.flatMap((r) => r.ids);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(RACES.map((r) => r.key)).size, RACES.length);
});

test('races are found by game id, raider.io name, SimulationCraft name and game file name', () => {
  assert.equal(raceOf({ id: 4 }).key, 'nightelf');
  assert.equal(raceOf({ name: 'Night Elf' }).key, 'nightelf');
  assert.equal(raceOf({ name: "Mag'har Orc" }).key, 'magharorc');
  assert.equal(raceOf({ name: 'dark_iron_dwarf' }).key, 'darkirondwarf');
  assert.equal(raceOf({ name: 'Scourge' }).key, 'undead');
  assert.equal(raceOf({ name: 'EarthenDwarf' }).key, 'earthen');
  // Faction variants are one race.
  assert.equal(raceOf({ id: 70 }).key, 'dracthyr');
  assert.equal(raceOf({ id: 52 }).key, 'dracthyr');
  assert.equal(raceOf({ name: 'pandaren_horde' }).key, 'pandaren');
  assert.equal(raceOf({ id: 26, name: 'Pandaren' }).faction, 'both');
  // The id wins over the name; unknown races are null.
  assert.equal(raceOf({ id: 10, name: 'Orc' }).key, 'bloodelf');
  assert.equal(raceOf({ name: 'Murloc' }), null);
  assert.equal(raceOf({}), null);
  assert.equal(raceOf(), null);
  assert.equal(raceByKey('kultiran').name, 'Kul Tiran');
});

test('race masks reach bit 31', () => {
  assert.equal(hasBit(0x80000000, 31), true);
  assert.equal(hasBit(0x80000000, 30), false);
  assert.equal(hasBit(0x3800000, 24), true);
  assert.equal(hasBit(0, 0), false);
});

test('SimulationCraft racial spell table is parsed', () => {
  const spells = parseRacialSpells(SIMC);
  assert.equal(spells.length, ROWS.length);
  assert.deepEqual(spells[0], { raceMask: 8, classMask: 0x3fff, id: 58984, name: 'Shadowmeld' });
  assert.deepEqual(spells.at(-2), { raceMask: 0x80000000, classMask: 0x3fff, id: 287712, name: 'Haymaker' });
  assert.equal(spells.at(-1).name, 'Rime of the "Ancient" Mariner');
  assert.throws(() => parseRacialSpells('nothing here'), /Unexpected SimulationCraft racial spell data/);
});

test('racials are picked for the race and the class', () => {
  const spells = parseRacialSpells(SIMC);
  const names = (race, classId) => racialsFor(spells, race, classId).map((s) => `${s.id} ${s.name}`);
  // Blood Elf Paladin (class 2) gets the paladin Arcane Torrent only.
  assert.deepEqual(names('bloodelf', 2), ['154742 Arcane Acuity', '155145 Arcane Torrent']);
  assert.deepEqual(names('bloodelf', 1), ['154742 Arcane Acuity', '69179 Arcane Torrent']);
  // Night Elf: Elusiveness is for rogues (4) and druids (11).
  assert.deepEqual(names('nightelf', 4), ['58984 Shadowmeld', '21009 Elusiveness']);
  assert.deepEqual(names('nightelf', 8), ['58984 Shadowmeld']);
  // Dracthyr: Soar is for Evokers (13); Glide is listed twice and shown once.
  assert.deepEqual(names('dracthyr', 13), ['369536 Soar', '358731 Glide', '357214 Wing Buffet']);
  assert.deepEqual(names('dracthyr', 1), ['358731 Glide', '357214 Wing Buffet']);
  // Class mask 0 means every class; Pandaren and Kul Tiran use the high bits.
  assert.deepEqual(names('haranir', 5), ['1238623 Lash Out']);
  assert.deepEqual(names('pandaren', 10), ['107079 Quaking Palm']);
  assert.equal(names('kultiran', 3).length, 2);
  // Without a class every variant is a candidate (the first one of each name is kept).
  assert.deepEqual(names('bloodelf', null), ['154742 Arcane Acuity', '155145 Arcane Torrent']);
  assert.deepEqual(racialsFor(spells, 'murloc', 1), []);
  assert.deepEqual(racialsFor(null, 'human', 1), []);
});

test('discovery keeps the race of the top-runs roster', async () => {
  const run = (id, roster) => ({ id, zoneId: 1, level: 20, roster });
  const member = (characterId, race) => ({ characterId, name: `C${characterId}`, specId: 64, realmSlug: 'r', region: 'eu', race });
  const pages = { a: [[run(1, [member(1, { id: 4, name: 'Night Elf' }), member(2, null)])], []] };
  const d = createDiscovery({ dungeons: ['a'], specId: 64, fetchPage: async (slug, page) => pages[slug][page] || [] });
  await d.until(10);
  assert.deepEqual(d.players.map((p) => p.race), [{ id: 4, name: 'Night Elf' }, null]);
});

test('a SimulationCraft export gives the race', () => {
  const s = parseSimc('mage="Nameless"\nlevel=90\nrace=void_elf\nspec=frost\ntalents=ABC');
  assert.equal(s.race, 'void_elf');
  assert.equal(raceOf({ name: s.race }).key, 'voidelf');
});

test('views count the races of the players shown', async () => {
  const v = await buildView(session(), {});
  assert.deepEqual(
    v.races.list.map((r) => [r.key, r.name, r.count]),
    [
      ['nightelf', 'Night Elf', 3],
      ['dwarf', 'Dwarf', 1],
      ['pandaren', 'Pandaren', 1],
    ]
  );
  assert.equal(v.races.list[0].share, 0.5);
  assert.equal(v.races.list[0].faction, 'alliance');
  assert.equal(v.races.unknown, 1);
  assert.deepEqual(v.players.map((p) => p.race), ['Night Elf', 'Night Elf', 'Dwarf', null, 'Pandaren', 'Night Elf']);

  // In one dungeon: only the players with a key there (P1, P2, P3).
  const d = await buildView(session(), { dungeon: 9 });
  assert.deepEqual(d.races.list.map((r) => [r.key, r.count]), [['nightelf', 2], ['dwarf', 1]]);
  assert.equal(d.races.unknown, 0);

  // Raid mode has no races.
  const raid = session();
  raid.meta.mode = 'raid';
  assert.equal((await buildView(raid, {})).races, null);
});

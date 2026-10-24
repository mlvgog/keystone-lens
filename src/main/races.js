'use strict';

const { fetchText } = require('./http');
const cache = require('./cache');
const talentTrees = require('./sources/talentTrees');

/**
 * Playable races and their racial abilities.
 * - RACES: the game's race IDs and "playable race bits" (the bit a race has in a race mask).
 *   Faction variants of one race (Pandaren, Dracthyr, Earthen, Haranir) are one entry.
 * - Racial abilities: SimulationCraft's generated racial spell list (GPL-3.0, read at runtime,
 *   not bundled), one row per spell with a race mask and a class mask. Icons from wago.tools.
 */

const SIMC_RACIALS_URL = 'https://raw.githubusercontent.com/simulationcraft/simc/HEAD/engine/dbc/generated/racial_spells.inc';
const CACHE_KEY = 'racials-v1';

// faction: 'alliance' | 'horde' | 'both' (a race that can join either faction)
const RACES = [
  { key: 'human', name: 'Human', ids: [1], bits: [0], faction: 'alliance' },
  { key: 'orc', name: 'Orc', ids: [2], bits: [1], faction: 'horde' },
  { key: 'dwarf', name: 'Dwarf', ids: [3], bits: [2], faction: 'alliance' },
  { key: 'nightelf', name: 'Night Elf', ids: [4], bits: [3], faction: 'alliance' },
  { key: 'undead', name: 'Undead', ids: [5], bits: [4], faction: 'horde', aliases: ['scourge', 'forsaken'] },
  { key: 'tauren', name: 'Tauren', ids: [6], bits: [5], faction: 'horde' },
  { key: 'gnome', name: 'Gnome', ids: [7], bits: [6], faction: 'alliance' },
  { key: 'troll', name: 'Troll', ids: [8], bits: [7], faction: 'horde' },
  { key: 'goblin', name: 'Goblin', ids: [9], bits: [8], faction: 'horde' },
  { key: 'bloodelf', name: 'Blood Elf', ids: [10], bits: [9], faction: 'horde' },
  { key: 'draenei', name: 'Draenei', ids: [11], bits: [10], faction: 'alliance' },
  { key: 'darkirondwarf', name: 'Dark Iron Dwarf', ids: [34], bits: [11], faction: 'alliance' },
  { key: 'vulpera', name: 'Vulpera', ids: [35], bits: [12], faction: 'horde' },
  { key: 'magharorc', name: "Mag'har Orc", ids: [36], bits: [13], faction: 'horde' },
  { key: 'mechagnome', name: 'Mechagnome', ids: [37], bits: [14], faction: 'alliance' },
  { key: 'dracthyr', name: 'Dracthyr', ids: [52, 70], bits: [15, 16], faction: 'both' },
  { key: 'earthen', name: 'Earthen', ids: [85, 84], bits: [17, 18], faction: 'both', aliases: ['earthendwarf'] },
  { key: 'haranir', name: 'Haranir', ids: [86, 91], bits: [19, 20], faction: 'both', aliases: ['harronir'] },
  { key: 'worgen', name: 'Worgen', ids: [22], bits: [21], faction: 'alliance' },
  { key: 'pandaren', name: 'Pandaren', ids: [24, 25, 26], bits: [23, 24, 25], faction: 'both' },
  { key: 'nightborne', name: 'Nightborne', ids: [27], bits: [26], faction: 'horde' },
  { key: 'highmountaintauren', name: 'Highmountain Tauren', ids: [28], bits: [27], faction: 'horde', aliases: ['highmountain'] },
  { key: 'voidelf', name: 'Void Elf', ids: [29], bits: [28], faction: 'alliance' },
  { key: 'lightforgeddraenei', name: 'Lightforged Draenei', ids: [30], bits: [29], faction: 'alliance', aliases: ['lightforged'] },
  { key: 'zandalaritroll', name: 'Zandalari Troll', ids: [31], bits: [30], faction: 'horde', aliases: ['zandalari'] },
  { key: 'kultiran', name: 'Kul Tiran', ids: [32], bits: [31], faction: 'alliance', aliases: ['kultiranhuman'] },
];

const BY_KEY = new Map(RACES.map((r) => [r.key, r]));
const BY_ID = new Map(RACES.flatMap((r) => r.ids.map((id) => [id, r])));
const BY_NAME = new Map(RACES.flatMap((r) => [r.key, ...(r.aliases || [])].map((n) => [n, r])));

/** "Mag'har Orc", "night_elf", "DarkIronDwarf", "pandaren_horde" -> "magharorc", "nightelf", ... */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/(alliance|horde|neutral)$/, '');
}

/** The race for a game race ID or a race name (raider.io, SimulationCraft or the game's file name). */
function raceOf({ id, name } = {}) {
  return (id != null && BY_ID.get(Number(id))) || BY_NAME.get(normalizeName(name)) || null;
}

function raceByKey(key) {
  return BY_KEY.get(key) || null;
}

/** Whether bit `bit` is set in `mask` (masks go up to bit 31, past JavaScript's signed bit operators). */
function hasBit(mask, bit) {
  return Math.floor(Number(mask) / 2 ** bit) % 2 === 1;
}

/** SimulationCraft's `__racial_spell_data` table: [{ raceMask, classMask, id, name }]. */
function parseRacialSpells(text) {
  const start = String(text || '').indexOf('__racial_spell_data');
  if (start < 0) throw new Error('Unexpected SimulationCraft racial spell data format');
  const body = text.slice(start, text.indexOf('} };', start));
  const row = /\{\s*(0x[0-9a-fA-F]+),\s*(0x[0-9a-fA-F]+),\s*(\d+),\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  return [...body.matchAll(row)].map((m) => ({
    raceMask: Number(BigInt(m[1])),
    classMask: Number(BigInt(m[2])),
    id: Number(m[3]),
    name: m[4].replace(/\\(.)/g, '$1'),
  }));
}

/**
 * Racial abilities of a race for a class: [{ id, name, icon }]. A class mask of 0 means every
 * class. Spells listed under several IDs for one class (Glide, Visage) appear once.
 */
function racialsFor(spells, raceKey, classId) {
  const race = BY_KEY.get(raceKey);
  if (!race || !Array.isArray(spells)) return [];
  const seen = new Set();
  const out = [];
  for (const s of spells) {
    if (!race.bits.some((b) => hasBit(s.raceMask, b))) continue;
    if (classId && s.classMask && !hasBit(s.classMask, classId - 1)) continue;
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push({ id: s.id, name: s.name, icon: s.icon || null });
  }
  return out;
}

async function download({ signal } = {}) {
  const spells = parseRacialSpells(await fetchText(SIMC_RACIALS_URL, { signal }));
  try {
    const misc = await talentTrees.getRowsById('SpellMisc', 'SpellID', spells.map((s) => s.id), { signal });
    const fileOf = new Map();
    for (const r of misc) if (+r.SpellIconFileDataID && !fileOf.has(+r.SpellID)) fileOf.set(+r.SpellID, +r.SpellIconFileDataID);
    const icons = await talentTrees.iconNames([...fileOf.values()], { signal });
    for (const s of spells) s.icon = icons.get(fileOf.get(s.id)) || null;
  } catch (err) {
    if (err.name === 'AbortError') throw err; // otherwise the list shows without icons
  }
  return spells;
}

let inMemory = null;

/** Every racial spell (see parseRacialSpells, plus `icon`). Downloaded once a day; the old list is kept offline. */
async function getRacials({ signal } = {}) {
  if (inMemory) return inMemory;
  const saved = await cache.read('racials', CACHE_KEY, { ignoreTtl: true, withTime: true });
  if (Array.isArray(saved?.value) && Date.now() - saved.at < cache.TTL.racials) return (inMemory = saved.value);
  try {
    const spells = await download({ signal });
    await cache.write('racials', CACHE_KEY, spells);
    return (inMemory = spells);
  } catch (err) {
    if (err.name !== 'AbortError' && Array.isArray(saved?.value)) return (inMemory = saved.value);
    throw err;
  }
}

/** Racial abilities of every race for one class: { [raceKey]: [{ id, name, icon }] }. */
async function racialsByRace(classId, opts) {
  const spells = await getRacials(opts);
  return Object.fromEntries(RACES.map((r) => [r.key, racialsFor(spells, r.key, classId)]));
}

module.exports = { RACES, raceOf, raceByKey, normalizeName, hasBit, parseRacialSpells, racialsFor, getRacials, racialsByRace };

'use strict';

/**
 * The SimulationCraft addon export (/simc in game): character, talent strings and equipped items.
 */

const CLASSES = {
  warrior: 'Warrior',
  paladin: 'Paladin',
  hunter: 'Hunter',
  rogue: 'Rogue',
  priest: 'Priest',
  deathknight: 'Death Knight',
  shaman: 'Shaman',
  mage: 'Mage',
  warlock: 'Warlock',
  monk: 'Monk',
  druid: 'Druid',
  demonhunter: 'Demon Hunter',
  evoker: 'Evoker',
};

// SimulationCraft slot -> the app's (raider.io's) slot name. Shirt and tabard are left out.
const SLOTS = {
  head: 'head',
  neck: 'neck',
  shoulder: 'shoulder',
  shoulders: 'shoulder',
  back: 'back',
  chest: 'chest',
  wrist: 'wrist',
  wrists: 'wrist',
  hands: 'hands',
  waist: 'waist',
  legs: 'legs',
  feet: 'feet',
  finger1: 'finger1',
  finger2: 'finger2',
  trinket1: 'trinket1',
  trinket2: 'trinket2',
  main_hand: 'mainhand',
  off_hand: 'offhand',
};

function simcError(message) {
  const err = new Error(message);
  err.code = 'BAD_SIMC';
  return err;
}

function titleCase(text) {
  return String(text || '')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

const numbers = (value) => String(value || '').split('/').map(Number).filter((n) => Number.isFinite(n) && n > 0);

/** `id=1,bonus_id=1/2,...` -> { id, bonuses, enchantId, gemIds, craftedStats, statsFrom }. */
function parseItem(value) {
  const opts = {};
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) opts[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  const id = Number(opts.id);
  if (!id) return null;
  return {
    id,
    bonuses: numbers(opts.bonus_id),
    enchantId: Number(opts.enchant_id) || null,
    gemIds: numbers(opts.gem_id),
    craftedStats: numbers(opts.crafted_stats),
    statsFrom: Number(opts.redirected_base_stats) || null,
  };
}

/**
 * { className, name, region, realmSlug, race (e.g. "nightelf"), specName, level, talents, loadouts: [{ name, talents }],
 *   items: [{ slot, id, bonuses, enchantId, gemIds, craftedStats, statsFrom, ilvl, name }] }.
 * Item level and name come from the "# Name (ilvl)" comment the addon writes above each item.
 */
function parseSimc(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
  const out = { className: null, name: null, region: null, realmSlug: null, race: null, specName: null, level: null, talents: null, loadouts: [], items: [] };
  let comment = null;
  let loadoutName = null;
  for (const line of lines) {
    if (!line) {
      comment = null;
      continue;
    }
    if (line.startsWith('#')) {
      const body = line.replace(/^#+\s*/, '');
      const saved = /^Saved Loadout:\s*(.*)$/i.exec(body);
      const savedTalents = /^talents=(\S+)/.exec(body);
      if (saved) loadoutName = saved[1].trim() || 'Saved loadout';
      else if (savedTalents && loadoutName) {
        out.loadouts.push({ name: loadoutName, talents: savedTalents[1] });
        loadoutName = null;
      }
      comment = body;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (!out.className && CLASSES[key]) {
      out.className = CLASSES[key];
      out.name = value.replace(/^"|"$/g, '');
    } else if (key === 'level') out.level = Number(value) || null;
    else if (key === 'region') out.region = value.toLowerCase();
    else if (key === 'server') out.realmSlug = value.toLowerCase();
    else if (key === 'race') out.race = value.toLowerCase();
    else if (key === 'spec') out.specName = titleCase(value);
    else if (key === 'talents') out.talents = value;
    else if (SLOTS[key]) {
      const item = parseItem(value);
      if (item) {
        const m = /^(.*)\((\d+)\)\s*$/.exec(comment || '');
        out.items.push({ slot: SLOTS[key], ...item, ilvl: m ? Number(m[2]) : null, name: m ? m[1].trim() : null });
      }
    }
    comment = null;
  }
  if (!out.className || !out.talents) throw simcError('This is not a SimulationCraft export. In game, type /simc and copy all of the text.');
  return out;
}

module.exports = { parseSimc, CLASSES, SLOTS };

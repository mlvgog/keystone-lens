'use strict';

const { fetchText } = require('../http');
const cache = require('../cache');
const { parseCsv } = require('./talentTrees');

/**
 * Item stats and embellishments from the game's own tables (no tooltip scraping):
 * - wago.tools exports of ItemSparse (stat allocation per item), ItemBonus (what bonus IDs do)
 *   and RandPropPoints (stat budget per item level);
 * - SimulationCraft's generated scale data (GPL-3.0, read at runtime) for the combat rating and
 *   stamina multipliers per item level, which are game tables wago.tools does not export.
 * Validated against Wowhead's tooltips: identical secondary stats for every tested item variant.
 */

const WAGO = 'https://wago.tools/db2';
const SIMC_SCALE_URL = 'https://raw.githubusercontent.com/simulationcraft/simc/HEAD/engine/dbc/generated/sc_scale_data.inc';
const BATCH = 300;

const RATINGS = { 32: 'crit', 36: 'haste', 49: 'mastery', 40: 'vers' };
const PRIMARY = {
  3: 'Agility',
  4: 'Strength',
  5: 'Intellect',
  71: 'Agility/Strength/Intellect',
  72: 'Agility/Strength',
  73: 'Agility/Intellect',
  74: 'Strength/Intellect',
};
const STAMINA = 7;
// Crafted items carry placeholder stats that become the stats chosen when crafting.
const CRAFTED_STAT_SLOTS = [24, 25];
const BONUS = { socket: 6, craftedStat: 25, limitCategory: 35 };
const EMBELLISHED_LIMIT = 512; // "Unique-Equipped: Embellished (2)"

// Stat budget column (RandPropPoints EpicF_n) and combat rating multiplier table by inventory type.
const BUDGET_COLUMN = { 1: 0, 5: 0, 7: 0, 20: 0, 17: 0, 15: 0, 26: 0, 3: 1, 6: 1, 8: 1, 10: 1, 12: 1, 2: 2, 9: 2, 11: 2, 14: 2, 16: 2, 23: 2, 13: 3, 21: 3, 22: 3 };
const MULT = { armor: 0, weapon: 1, trinket: 2, jewelry: 3 };
const MULT_TABLE = { 2: MULT.jewelry, 11: MULT.jewelry, 12: MULT.trinket, 13: MULT.weapon, 15: MULT.weapon, 17: MULT.weapon, 21: MULT.weapon, 22: MULT.weapon, 26: MULT.weapon };

/** Rows of a wago.tools table whose `column` is one of `ids`. */
async function rowsById(table, column, ids, { signal } = {}) {
  const list = [...new Set(ids)].filter(Boolean);
  const batches = [];
  for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
  const pages = await Promise.all(
    batches.map(async (b) => parseCsv(await fetchText(`${WAGO}/${table}/csv?filter%5B${column}%5D=${encodeURIComponent(b.join('|'))}`, { signal })))
  );
  return pages.flat();
}

/** A `double name[][N] = { {..}, {..} }` table from SimulationCraft's generated C++ (comments stripped). */
function parseSimcTable(text, name) {
  const start = text.indexOf(name);
  if (start < 0) throw new Error(`Missing ${name} in SimulationCraft scale data`);
  const body = text.slice(text.indexOf('{', start) + 1, text.indexOf('};', start)).replace(/\/\/[^\n]*/g, ' ');
  return [...body.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1].split(',').map((x) => x.trim()).filter(Boolean).map(Number));
}

/** Item-level tables: { budget: { ilvl: [EpicF_0..4] }, ratingMult: [[...]], staminaMult: [[...]] }. */
async function getScaleTables({ signal } = {}) {
  return cache.cached('gameTables', 'item-scaling-v1', async () => {
    const [rpp, simc] = await Promise.all([fetchText(`${WAGO}/RandPropPoints/csv`, { signal }), fetchText(SIMC_SCALE_URL, { signal })]);
    const budget = {};
    for (const r of parseCsv(rpp)) budget[r.ID] = [0, 1, 2, 3, 4].map((i) => Number(r[`EpicF_${i}`]) || 0);
    return {
      budget,
      ratingMult: parseSimcTable(simc, '__combat_ratings_mult_by_ilvl'),
      staminaMult: parseSimcTable(simc, '__stamina_mult_by_ilvl'),
    };
  });
}

/** Cached per id; only the missing ids are fetched. */
async function cachedById(kind, ids, fetchMissing, { signal } = {}) {
  const out = {};
  const missing = [];
  for (const id of [...new Set(ids)].filter(Boolean)) {
    const hit = await cache.read(kind, String(id));
    if (hit !== undefined) out[id] = hit;
    else missing.push(id);
  }
  if (missing.length) {
    const fetched = await fetchMissing(missing, { signal });
    for (const id of missing) {
      out[id] = fetched[id] ?? null;
      await cache.write(kind, String(id), out[id]);
    }
  }
  return out;
}

/** ItemSparse facts per item id: { inventoryType, limitCategory, sockets, stats: [[statId, allocation]] }. */
function getItems(ids, opts) {
  return cachedById(
    'itemData',
    ids,
    async (missing, o) => {
      const out = {};
      for (const r of await rowsById('ItemSparse', 'ID', missing, o)) {
        const stats = [];
        for (let i = 0; i < 10; i++) {
          const stat = Number(r[`StatModifier_bonusStat_${i}`]);
          const alloc = Number(r[`StatPercentEditor_${i}`]) || 0;
          if (stat > 0 && alloc) stats.push([stat, alloc]);
        }
        out[r.ID] = {
          inventoryType: Number(r.InventoryType) || 0,
          limitCategory: Number(r.LimitCategory) || 0,
          sockets: [0, 1, 2].filter((i) => Number(r[`SocketType_${i}`])).length,
          stats,
        };
      }
      return out;
    },
    opts
  );
}

/** ItemBonus rows per bonus list id: [{ type, values: [v0..v3], order }]. */
function getBonusLists(ids, opts) {
  return cachedById(
    'itemBonus',
    ids,
    async (missing, o) => {
      const out = Object.fromEntries(missing.map((id) => [id, []]));
      for (const r of await rowsById('ItemBonus', 'ParentItemBonusListID', missing, o)) {
        out[r.ParentItemBonusListID]?.push({
          type: Number(r.Type),
          values: [0, 1, 2, 3].map((i) => Number(r[`Value_${i}`]) || 0),
          order: Number(r.OrderIndex) || 0,
        });
      }
      return out;
    },
    opts
  );
}

/**
 * Stats of one item variant at item level `ilvl`: { primary: { name, value } | null, stamina,
 * secondary: { crit, haste, mastery, vers }, randomStats, sockets }. `randomStats` counts secondary
 * stats the item rolled when it dropped, which the data does not say.
 * `item` from getItems, `bonusRows` = the ItemBonus rows of its bonus IDs.
 */
function itemStats(item, bonusRows, ilvl, tables) {
  const budget = tables.budget[ilvl]?.[BUDGET_COLUMN[item.inventoryType] ?? 0] || 0;
  const mult = MULT_TABLE[item.inventoryType] ?? MULT.armor;
  const ratingMult = tables.ratingMult[mult]?.[ilvl - 1] ?? 1;
  const staminaMult = tables.staminaMult[mult]?.[ilvl - 1] ?? 1;
  const chosen = bonusRows
    .filter((b) => b.type === BONUS.craftedStat)
    .sort((a, b) => a.order - b.order)
    .map((b) => b.values[0]);
  const secondary = { crit: 0, haste: 0, mastery: 0, vers: 0 };
  let primary = null;
  let stamina = 0;
  let randomStats = 0;
  for (const [rawStat, alloc] of item.stats) {
    const slot = CRAFTED_STAT_SLOTS.indexOf(rawStat);
    const stat = slot >= 0 ? chosen[slot] : rawStat;
    if (slot >= 0 && stat === undefined) randomStats++;
    const value = budget * alloc * 0.0001;
    if (RATINGS[stat]) secondary[RATINGS[stat]] += Math.round(value * ratingMult);
    else if (stat === STAMINA) stamina = Math.round(value * staminaMult);
    else if (PRIMARY[stat]) primary = { name: PRIMARY[stat], value: Math.round(value) };
  }
  const extraSockets = bonusRows.filter((b) => b.type === BONUS.socket).reduce((s, b) => s + (b.values[0] || 0), 0);
  return { primary, stamina, secondary, randomStats, sockets: item.sockets + extraSockets };
}

/** Embellished items are limited to two equipped ("Unique-Equipped: Embellished (2)"). */
function isEmbellished(item, bonusRows) {
  return item.limitCategory === EMBELLISHED_LIMIT || bonusRows.some((b) => b.type === BONUS.limitCategory && b.values[0] === EMBELLISHED_LIMIT);
}

/**
 * Stats and embellishment of item variants: variants = [{ key, id, bonuses, ilvl }] ->
 * { [key]: { stats, primary, stamina, sockets, embellished } } (missing items are left out).
 */
async function describeVariants(variants, { signal } = {}) {
  if (!variants.length) return {};
  const [tables, items, bonuses] = await Promise.all([
    getScaleTables({ signal }),
    getItems(variants.map((v) => v.id), { signal }),
    getBonusLists(variants.flatMap((v) => v.bonuses || []), { signal }),
  ]);
  const out = {};
  for (const v of variants) {
    const item = items[v.id];
    if (!item) continue;
    const rows = (v.bonuses || []).flatMap((b) => bonuses[b] || []);
    const s = itemStats(item, rows, v.ilvl, tables);
    out[v.key] = {
      stats: s.secondary,
      primary: s.primary,
      stamina: s.stamina,
      randomStats: s.randomStats,
      sockets: s.sockets,
      embellished: isEmbellished(item, rows),
    };
  }
  return out;
}

module.exports = { describeVariants, itemStats, isEmbellished, parseSimcTable, getScaleTables };

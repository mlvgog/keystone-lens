'use strict';

const { SLOT_GROUPS, gearItems, cleanEnchantName, stripEscapes, variantKeyOf, tierSetSummary } = require('./aggregate');
const { gemStats, emptyStats, isTwoHandSlot } = require('./itemInfo');

const STATS = [
  { key: 'crit', label: 'Critical Strike' },
  { key: 'haste', label: 'Haste' },
  { key: 'mastery', label: 'Mastery' },
  { key: 'vers', label: 'Versatility' },
];
const TIER_SLOTS = [
  ['head', 'Head'],
  ['shoulder', 'Shoulder'],
  ['chest', 'Chest'],
  ['hands', 'Hands'],
  ['legs', 'Legs'],
];

function inc(obj, key, by = 1) {
  obj[key] = (obj[key] || 0) + by;
}

function addStats(into, add) {
  for (const k of Object.keys(into)) into[k] += add[k] || 0;
}

function mean(values) {
  return values.length ? values.reduce((s, x) => s + x, 0) / values.length : 0;
}

function top(counts, n) {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n);
}

/** Secondary stat totals of one player from gear (exact item variants) and gems. */
function playerSecondaryStats(player, itemInfo) {
  const total = emptyStats();
  let items = 0;
  let known = 0;
  for (const it of gearItems(player)) {
    items++;
    const info = itemInfo[variantKeyOf(it)];
    if (info) {
      known++;
      addStats(total, info.stats);
    }
    for (const g of it.gems || []) addStats(total, gemStats(g.name));
  }
  return { total, coverage: items ? known / items : 0 };
}

/**
 * Average secondary stat distribution of the players' gear (enchants excluded).
 * Only players whose items could almost all be looked up are counted.
 */
function statProfile(players, itemInfo) {
  const per = players.map((p) => playerSecondaryStats(p, itemInfo)).filter((x) => x.coverage >= 0.8);
  if (!per.length) return null;
  const stats = STATS.map(({ key, label }) => {
    const shares = per.map((x) => {
      const sum = Object.values(x.total).reduce((a, b) => a + b, 0);
      return sum ? x.total[key] / sum : 0;
    });
    return {
      key,
      label,
      avg: mean(per.map((x) => x.total[key])),
      share: mean(shares),
      minShare: Math.min(...shares),
      maxShare: Math.max(...shares),
    };
  });
  return { players: per.length, stats, order: [...stats].sort((a, b) => b.share - a.share).map((s) => s.label) };
}

function weaponSetup(player, itemSources) {
  const mh = player.items?.mainhand;
  const oh = player.items?.offhand;
  if (!mh) return null;
  const mhSlot = itemSources[mh.id]?.slot;
  if (!oh) return isTwoHandSlot(mhSlot) || mhSlot == null ? 'Two-hander' : 'Main hand only';
  const ohSlot = itemSources[oh.id]?.slot;
  if (isTwoHandSlot(ohSlot)) return 'Two two-handers';
  if (ohSlot === 14) return 'One-hander + shield';
  if (ohSlot === 23) return 'One-hander + off-hand';
  if (ohSlot === 13 || ohSlot === 22 || ohSlot === 21) return 'Dual wield';
  return 'Main hand + off hand';
}

/** Enchants per slot, gems, embellishments, tier usage per slot and weapon setups. */
function summarizeGear(players, itemInfo, itemSources = {}) {
  const N = players.length;

  const enchants = [];
  for (const g of SLOT_GROUPS) {
    const counts = {};
    let enchanted = 0;
    for (const p of players) {
      const names = new Set();
      for (const slot of g.slots) for (const e of p.items?.[slot]?.enchants || []) names.add(cleanEnchantName(e.name));
      if (names.size) enchanted++;
      for (const name of names) inc(counts, name);
    }
    if (enchanted) enchants.push({ key: g.key, label: g.label, players: enchanted, top: top(counts, 2) });
  }

  const gemCounts = {};
  let sockets = 0;
  for (const p of players) {
    for (const it of gearItems(p)) {
      for (const gem of it.gems || []) {
        inc(gemCounts, stripEscapes(gem.name));
        sockets++;
      }
    }
  }

  const embellished = new Map();
  let withTwo = 0;
  let withAny = 0;
  for (const p of players) {
    let count = 0;
    const seen = new Set();
    for (const it of gearItems(p)) {
      if (!itemInfo[variantKeyOf(it)]?.embellished) continue;
      count++;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      const entry = embellished.get(it.id) || { id: it.id, name: it.name, icon: it.icon, quality: it.quality, count: 0 };
      entry.count++;
      embellished.set(it.id, entry);
    }
    if (count >= 2) withTwo++;
    if (count >= 1) withAny++;
  }

  const setups = {};
  for (const p of players) {
    const s = weaponSetup(p, itemSources);
    if (s) inc(setups, s);
  }

  return {
    sampleSize: N,
    enchants,
    gems: { top: top(gemCounts, 6), avgSockets: N ? sockets / N : 0 },
    embellishments: { items: [...embellished.values()].sort((a, b) => b.count - a.count), withTwo, withAny },
    tier: {
      ...tierSetSummary(players),
      slots: TIER_SLOTS.map(([slot, label]) => ({ slot, label, count: players.filter((p) => p.items?.[slot]?.tier).length })),
    },
    weapons: Object.entries(setups)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

module.exports = { statProfile, summarizeGear, playerSecondaryStats, weaponSetup, STATS };

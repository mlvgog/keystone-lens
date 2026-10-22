'use strict';

/**
 * Damage / healing statistics from Warcraft Logs runs: per dungeon and key level (or item
 * level), and how a character's own logged runs compare with the spec at the same key level.
 */

// Warcraft Logs gear order; the shirt (3) and tabard (18) don't count towards item level.
const ILVL_SLOTS = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const MAIN_HAND = 15;
const OFF_HAND = 16;
const ILVL_BUCKET = 3;

/** Equipped item level like the game shows it (a two-hander counts for both hands). */
function averageItemLevel(gear) {
  if (!Array.isArray(gear) || !gear.length) return null;
  const level = (i) => {
    const g = gear[i];
    const v = g && g.id ? Number(g.itemLevel) : 0;
    return Number.isFinite(v) && v > 1 ? v : 0;
  };
  let sum = 0;
  let count = 0;
  for (const i of ILVL_SLOTS) {
    let v = level(i);
    if (i === OFF_HAND && !v) v = level(MAIN_HAND);
    if (v) {
      sum += v;
      count++;
    }
  }
  return count >= 12 ? Math.round((sum / ILVL_SLOTS.length) * 10) / 10 : null;
}

/** Linear-interpolated quantile of an ascending array. */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function mean(values) {
  return values.length ? values.reduce((s, x) => s + x, 0) / values.length : null;
}

/** { n, mean, median, p25, p75, min, max, ilvl, duration } of a list of runs (null when empty). */
function summarize(runs) {
  if (!runs.length) return null;
  const amounts = runs.map((r) => r.amount).sort((a, b) => a - b);
  const ilvls = runs.map((r) => r.ilvl).filter((x) => x);
  return {
    n: amounts.length,
    mean: mean(amounts),
    median: quantile(amounts, 0.5),
    p25: quantile(amounts, 0.25),
    p75: quantile(amounts, 0.75),
    min: amounts[0],
    max: amounts[amounts.length - 1],
    ilvl: ilvls.length ? mean(ilvls) : null,
    duration: mean(runs.map((r) => r.duration)),
  };
}

/** Share of runs with a lower amount (0..1), counting ties as half. */
function percentileOf(runs, amount) {
  if (!runs.length) return null;
  let below = 0;
  let equal = 0;
  for (const r of runs) {
    if (r.amount < amount) below++;
    else if (r.amount === amount) equal++;
  }
  return (below + equal / 2) / runs.length;
}

function bucketOf(ilvl) {
  return Math.floor(ilvl / ILVL_BUCKET) * ILVL_BUCKET;
}

/**
 * Table for the UI.
 * dungeons: [{ id: encounterId, name }]; runs: { [encounterId]: { [level]: [run] } }
 * groupBy: 'level' (columns = key levels) or 'ilvl' (columns = item level ranges, all levels pooled)
 */
function buildTable({ dungeons, runs, levels, groupBy = 'level', minPerColumn = 3 }) {
  const all = (encId) => levels.flatMap((l) => runs[encId]?.[l] || []);
  let columns;
  let pick;
  if (groupBy === 'ilvl') {
    const counts = {};
    for (const d of dungeons) for (const r of all(d.id)) if (r.ilvl) counts[bucketOf(r.ilvl)] = (counts[bucketOf(r.ilvl)] || 0) + 1;
    columns = Object.keys(counts)
      .map(Number)
      .filter((b) => counts[b] >= minPerColumn)
      .sort((a, b) => a - b)
      .map((b) => ({ key: b, label: `${b}–${b + ILVL_BUCKET - 1}` }));
    pick = (encId, col) => all(encId).filter((r) => r.ilvl && bucketOf(r.ilvl) === col.key);
  } else {
    columns = levels.map((l) => ({ key: l, label: `+${l}` }));
    pick = (encId, col) => runs[encId]?.[col.key] || [];
  }
  const rows = dungeons.map((d) => ({
    id: d.id,
    name: d.name,
    cells: Object.fromEntries(columns.map((c) => [c.key, summarize(pick(d.id, c))])),
    all: summarize(groupBy === 'ilvl' ? all(d.id).filter((r) => r.ilvl) : all(d.id)),
  }));
  const total = {
    cells: Object.fromEntries(columns.map((c) => [c.key, summarize(dungeons.flatMap((d) => pick(d.id, c)))])),
    all: summarize(dungeons.flatMap((d) => (groupBy === 'ilvl' ? all(d.id).filter((r) => r.ilvl) : all(d.id)))),
  };
  return { groupBy, columns, rows, total };
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Your logged runs against the spec at the same key level (your own runs are left out of
 * the comparison sample). yourRuns: { [encounterId]: [run] }; self: { name, realm }.
 * Returns per dungeon { runs, byLevel, best }; each compared run has
 * { ...run, n, median, percentile, delta } (delta = amount / median - 1). With fewer than
 * `minSample` other runs at that level, median/percentile/delta are null.
 * `best` = your best run at the highest key level that can be compared.
 */
function compareYou({ dungeons, runs, yourRuns, levels, self = {}, minSample = 5 }) {
  const inRange = new Set(levels);
  const isSelf = (r) => norm(r.name) === norm(self.name) && (!self.realm || norm(r.server) === norm(self.realm));
  const out = {};
  for (const d of dungeons) {
    const mine = (yourRuns?.[d.id] || []).filter((r) => inRange.has(r.level));
    const compared = mine
      .map((r) => {
        const sample = (runs[d.id]?.[r.level] || []).filter((x) => !isSelf(x));
        const enough = sample.length >= minSample;
        const s = enough ? summarize(sample) : null;
        return {
          ...r,
          n: sample.length,
          median: s?.median ?? null,
          percentile: enough ? percentileOf(sample, r.amount) : null,
          delta: s?.median ? r.amount / s.median - 1 : null,
        };
      })
      .sort((a, b) => b.level - a.level || b.amount - a.amount);
    const byLevel = {};
    for (const r of compared) if (!byLevel[r.level] || r.amount > byLevel[r.level].amount) byLevel[r.level] = r;
    const comparable = compared.filter((r) => r.median != null);
    const pool = comparable.length ? comparable : compared;
    const top = pool.length ? Math.max(...pool.map((r) => r.level)) : null;
    const best = pool.filter((r) => r.level === top).reduce((b, r) => (!b || r.amount > b.amount ? r : b), null);
    out[d.id] = { runs: compared, byLevel, best };
  }
  return out;
}

/**
 * Key levels for a first look (each level costs one Warcraft Logs lookup per dungeon):
 * the `count` highest levels you have logged, or those the sampled top players ran.
 */
function defaultLevels(topLevels, yourLevels = [], count = 6) {
  const mine = yourLevels.filter(Number.isFinite);
  const max = mine.length ? Math.max(...mine) : Math.max(...topLevels.filter(Number.isFinite), 10);
  return { from: Math.max(2, max - count + 1), to: max };
}

/** "Kings' Rest" and "King's Rest" are the same dungeon. */
function sameDungeon(a, b) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(a) === norm(b);
}

module.exports = { averageItemLevel, quantile, summarize, percentileOf, buildTable, compareYou, defaultLevels, sameDungeon, ILVL_BUCKET };

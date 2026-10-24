'use strict';

const { aggregateTalents, aggregateGear, variantKeyOf } = require('./aggregate');
const { clusterBuilds, buildDiffs } = require('./builds');
const { statProfile, summarizeGear } = require('./gearSummary');
const history = require('./history');
const { raceByKey } = require('./races');

/** The key a player is represented by: their overall pick, or their key in one dungeon. */
function dataFor(player, dungeon) {
  return dungeon ? player.dungeons?.[dungeon] || null : player.main;
}

function samplePlayers(session, dungeon) {
  return session.players.map((p, index) => ({ p, index, d: dataFor(p, dungeon) })).filter((x) => x.d);
}

const toAgg = (x) => ({ name: x.p.name, talents: x.d.talents, items: x.d.items });

/**
 * How many of the players play each race: { list: [{ key, name, faction, count, share }], unknown }.
 * null in raid mode (Warcraft Logs has no races).
 */
function raceSummary(entries, meta) {
  if (meta.mode === 'raid') return null;
  const counts = new Map();
  let unknown = 0;
  for (const { p } of entries) {
    const race = p.race ? raceByKey(p.race) : null;
    if (!race) unknown++;
    else counts.set(race.key, (counts.get(race.key) || 0) + 1);
  }
  const list = [...counts]
    .map(([key, count]) => {
      const r = raceByKey(key);
      return { key, name: r.name, faction: r.faction, count, share: entries.length ? count / entries.length : 0 };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { list, unknown };
}

function normalizeFilters(filters = {}) {
  return {
    dungeon: filters.dungeon ?? null,
    hero: filters.hero ?? null,
    build: filters.build ?? null,
    trendsSince: filters.trendsSince ?? null,
  };
}

/**
 * Talent, gear and player statistics for a filtered part of a session.
 * filters: { dungeon: zoneId|null, hero: subTreeId|null, build: buildId|null, trendsSince: snapshotId|null }
 * deps: { getSnapshot(id) -> snapshot|null }
 */
async function buildView(session, filters, deps = {}) {
  const f = normalizeFilters(filters);
  const { tree, meta } = session;

  // Everyone with a key for the selected dungeon (or their overall pick).
  const base = samplePlayers(session, f.dungeon);
  const baseAgg = base.map(toAgg);
  const baseTalents = aggregateTalents(tree, baseAgg);
  const heroNames = Object.fromEntries(baseTalents.hero.map((h) => [h.id, h.name]));

  // Popular builds are found on the whole (dungeon) sample.
  const clusters = clusterBuilds(tree, baseAgg);
  const builds = clusters.builds.map((b) => {
    const stats = aggregateTalents(tree, b.members.map((i) => baseAgg[i]));
    return {
      id: b.id,
      index: b.index,
      size: b.size,
      pct: b.pct,
      heroSubTreeId: b.heroSubTreeId,
      heroName: heroNames[b.heroSubTreeId] || null,
      medoidName: b.medoidName,
      medoidIndex: base[b.medoid].index,
      loadoutText: b.loadoutText,
      members: b.members.map((i) => base[i].index),
      diffs: buildDiffs(tree, stats.nodes, baseTalents.nodes).slice(0, 8),
    };
  });
  const buildOf = new Map(base.map((x, i) => [x.index, clusters.assignment[i]]));

  let filtered = base;
  if (f.hero != null) filtered = filtered.filter((x) => x.d.talents.heroSubTreeId === f.hero);
  const build = f.build ? builds.find((b) => b.id === f.build) || null : null;
  if (build) filtered = filtered.filter((x) => build.members.includes(x.index));
  const agg = filtered.map(toAgg);

  const talents = filtered === base ? baseTalents : aggregateTalents(tree, agg);
  const gear = aggregateGear(agg);
  for (const g of gear) {
    for (const item of g.items) {
      const src = session.itemSources?.[item.id] || null;
      item.source = src;
      // Stats, sockets and embellishment of the most common variant (see collector.enrichItems).
      const info = session.itemInfo?.[variantKeyOf({ id: item.id, bonuses: item.variant.bonuses, ilvl: item.variant.ilvl })] || null;
      item.details = info || src ? { ...info, slotType: src?.slotType || null } : null;
    }
  }

  const players = filtered.map(({ p, index, d }) => ({
    index,
    rank: p.rank,
    name: p.name,
    realm: p.realm,
    realmSlug: p.realmSlug,
    region: p.region,
    race: p.race ? raceByKey(p.race)?.name || null : null,
    score: p.score,
    scoreColor: p.scoreColor,
    links: p.links,
    itemLevel: d.itemLevel,
    heroSubTreeId: d.talents.heroSubTreeId,
    heroName: heroNames[d.talents.heroSubTreeId] || null,
    loadoutText: d.talents.loadoutText,
    fallback: d.fallback,
    run: d.run,
    buildId: buildOf.get(index) || null,
  }));

  const view = {
    filters: f,
    dungeon: f.dungeon ? meta.dungeons.find((d) => d.id === f.dungeon) || { id: f.dungeon, name: 'Unknown dungeon' } : null,
    baseSize: base.length,
    sampleSize: filtered.length,
    hero: baseTalents.hero,
    builds: { list: builds, singles: clusters.singles },
    talents,
    diffNodes: build ? build.diffs.map((d) => d.nodeId) : [],
    gear,
    gearSummary: summarizeGear(agg, session.itemInfo || {}, session.itemSources || {}),
    statProfile: statProfile(agg, session.itemInfo || {}),
    races: raceSummary(filtered, meta),
    avgItemLevel: filtered.length ? filtered.reduce((s, x) => s + (x.d.itemLevel || 0), 0) / filtered.length : 0,
    fallbackCount: filtered.filter((x) => x.d.fallback).length,
    players,
    trends: null,
  };

  const unfiltered = !f.dungeon && f.hero == null && !f.build;
  if (f.trendsSince && unfiltered && deps.getSnapshot) {
    const previous = await deps.getSnapshot(f.trendsSince);
    if (previous) view.trends = history.deltas(history.snapshotOf(view, meta), previous);
  }
  return view;
}

/** Full data of one sampled player (for "inspect"). */
function playerDetail(session, index, dungeon = null) {
  const p = session.players[index];
  if (!p) return null;
  const d = dataFor(p, dungeon);
  if (!d) return null;
  const items = Object.fromEntries(
    Object.entries(d.items || {}).map(([slot, it]) => {
      const source = session.itemSources?.[it.id] || null;
      const info = session.itemInfo?.[variantKeyOf(it)] || null;
      return [slot, { ...it, source, details: info ? { ...info, slotType: source?.slotType || null } : null }];
    })
  );
  return {
    index,
    rank: p.rank,
    name: p.name,
    realm: p.realm,
    region: p.region,
    score: p.score,
    scoreColor: p.scoreColor,
    links: p.links,
    run: d.run,
    fallback: d.fallback,
    itemLevel: d.itemLevel,
    talents: d.talents,
    items,
  };
}

module.exports = { buildView, playerDetail, samplePlayers, normalizeFilters };

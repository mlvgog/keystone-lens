'use strict';

const { fetchJson } = require('../http');
const cache = require('../cache');

const BASE = 'https://raider.io';

/**
 * Find the current main M+ season: the newest `is_main_season` season that has
 * already started in the US. Expansions are probed from newest to oldest.
 */
async function getCurrentSeason({ signal, force } = {}) {
  return cache.cached('season', 'current-v2', async () => {
    const now = Date.now();
    for (let expansion = 16; expansion >= 9; expansion--) {
      let data;
      try {
        data = await fetchJson(`${BASE}/api/v1/mythic-plus/static-data?expansion_id=${expansion}`, { signal });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        continue;
      }
      const started = (data.seasons || [])
        .filter((s) => s.is_main_season && s.starts?.us && Date.parse(s.starts.us) <= now)
        .sort((a, b) => Date.parse(b.starts.us) - Date.parse(a.starts.us));
      if (started.length) {
        const s = started[0];
        return {
          slug: s.slug,
          name: s.name,
          shortName: s.short_name,
          expansionId: expansion,
          dungeons: (s.dungeons || []).map((d) => ({ id: d.id, name: d.name, shortName: d.short_name, slug: d.slug })),
        };
      }
    }
    throw new Error('Could not determine the current Mythic+ season from raider.io');
  }, { force });
}

/** Raids of an expansion: [{ zoneId, name, encounters: [name] }] (used to tag item sources). */
async function getRaids(expansionId, { signal } = {}) {
  const url = `${BASE}/api/v1/raiding/static-data?expansion_id=${expansionId}`;
  try {
    return await cache.cached('season', url, async () => {
      const data = await fetchJson(url, { signal });
      return (data.raids || []).map((r) => ({ zoneId: r.id, name: r.name, encounters: (r.encounters || []).map((e) => e.name) }));
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return []; // source tags degrade gracefully
  }
}

/** One page (100 players) of the raider.io character rankings for a spec. */
async function getSpecRankings({ season, region, classSlug, specSlug, page }, { signal, force } = {}) {
  const url =
    `${BASE}/api/mythic-plus/rankings/specs?region=${encodeURIComponent(region)}` +
    `&season=${encodeURIComponent(season)}&class=${encodeURIComponent(classSlug)}` +
    `&spec=${encodeURIComponent(specSlug)}&page=${page}`;
  return cache.cached('rankings', url, async () => {
    const data = await fetchJson(url, { signal });
    const ranked = data?.rankings?.rankedCharacters || [];
    return {
      lastPage: data?.rankings?.ui?.lastPage ?? 0,
      players: ranked.map((r) => ({
        rank: r.rank,
        score: r.score,
        scoreColor: r.scoreColor,
        characterId: r.character.id,
        name: r.character.name,
        classSlug: r.character.class?.slug,
        realm: r.character.realm?.name,
        realmSlug: r.character.realm?.slug,
        region: r.character.region?.slug,
        runs: (r.runs || []).map((run) => ({
          id: run.keystoneRunId,
          zoneId: run.zoneId,
          level: run.mythicLevel,
          score: run.score,
          period: run.period,
        })),
      })),
    };
  }, { force });
}

/** The character's 10 most recent keys (any spec). */
async function getRecentRuns({ region, realmSlug, name }, { signal, force } = {}) {
  const url =
    `${BASE}/api/v1/characters/profile?region=${encodeURIComponent(region)}` +
    `&realm=${encodeURIComponent(realmSlug)}&name=${encodeURIComponent(name)}` +
    `&fields=mythic_plus_recent_runs`;
  return cache.cached('profile', url, async () => {
    try {
      const data = await fetchJson(url, { signal });
      return (data.mythic_plus_recent_runs || []).map((r) => ({
        id: r.keystone_run_id,
        zoneId: r.zone_id,
        level: r.mythic_level,
        score: r.score,
        completedAt: r.completed_at,
      }));
    } catch (err) {
      // Missing/renamed characters are not fatal: we still have their ranked runs.
      if (err.status === 400 || err.status === 404) return [];
      throw err;
    }
  }, { force });
}

function trimItem(it) {
  return {
    id: it.item_id,
    ilvl: it.item_level,
    name: it.name,
    icon: it.icon,
    quality: it.item_quality,
    bonuses: it.bonuses || [],
    tier: it.tier || null,
    enchants: (it.enchants_detail || []).map((e) => ({ id: e.id, name: e.name, icon: e.icon })),
    gems: (it.gems_detail || []).map((g) => ({ id: g.id, name: g.name, icon: g.icon })),
  };
}

function trimLoadoutNodes(loadout) {
  return (loadout || []).map((e) => {
    const entries = e.node?.entries || [];
    return {
      nodeId: e.node?.id,
      type: e.node?.type,
      entryIndex: e.entryIndex,
      entryId: entries[e.entryIndex]?.id ?? null,
      rank: e.rank,
      granted: !!e.grantedNode,
    };
  });
}

function trimLoadout(tl) {
  if (!tl) return null;
  return {
    specId: tl.specId,
    heroSubTreeId: tl.heroSubTreeId ?? null,
    loadoutText: tl.loadoutText || tl.exportLoadoutText || null,
    version: tl.dbcIndexVersion || null,
    nodes: trimLoadoutNodes(tl.loadout),
  };
}

/** Run snapshot: who was in the group, with their talents and gear at that time. Cached forever. */
async function getRunDetails({ season, id }, { signal } = {}) {
  const url = `${BASE}/api/v1/mythic-plus/run-details?season=${encodeURIComponent(season)}&id=${id}`;
  return cache.cached('run', url, async () => {
    let d;
    try {
      d = await fetchJson(url, { signal });
    } catch (err) {
      if (err.status === 400 || err.status === 404) return { id, missing: true, roster: [] };
      throw err;
    }
    return {
      id,
      completedAt: d.completed_at,
      level: d.mythic_level,
      score: d.score,
      dungeon: { name: d.dungeon?.name, shortName: d.dungeon?.short_name, zoneId: d.dungeon?.id ?? null },
      roster: (d.roster || []).map((r) => ({
        characterId: r.character?.id,
        name: r.character?.name,
        specId: r.character?.spec?.id,
        talents: trimLoadout(r.character?.talentLoadout),
        itemLevel: r.items?.item_level_equipped ?? null,
        items: Object.fromEntries(Object.entries(r.items?.items || {}).map(([slot, it]) => [slot, trimItem(it)])),
      })),
    };
  });
}

/**
 * A character's current talents and gear (for "compare with my character").
 * Throws a readable error when the character does not exist.
 */
async function getCharacter({ region, realm, name }, { signal, force } = {}) {
  const realmSlug = slugifyRealm(realm);
  const url =
    `${BASE}/api/v1/characters/profile?region=${encodeURIComponent(region)}` +
    `&realm=${encodeURIComponent(realmSlug)}&name=${encodeURIComponent(name.trim())}&fields=gear,talents`;
  return cache.cached('character', url, async () => {
    let d;
    try {
      d = await fetchJson(url, { signal });
    } catch (err) {
      if (err.status === 400 || err.status === 404) {
        throw new Error(`Character "${name}" on ${realm} (${String(region).toUpperCase()}) was not found on raider.io.`);
      }
      throw err;
    }
    const tl = d.talentLoadout || {};
    const heroNode = (tl.loadout || []).find((e) => e.node?.subTreeId && e.rank > 0);
    return {
      name: d.name,
      realm: d.realm,
      realmSlug,
      region: d.region || region,
      className: d.class,
      activeSpecName: d.active_spec_name,
      itemLevel: d.gear?.item_level_equipped ?? null,
      profileUrl: d.profile_url,
      thumbnail: d.thumbnail_url,
      talents: {
        specId: tl.loadout_spec_id ?? null,
        heroSubTreeId: heroNode?.node?.subTreeId ?? null,
        loadoutText: tl.loadout_text || null,
        version: null,
        nodes: trimLoadoutNodes(tl.loadout),
      },
      items: Object.fromEntries(Object.entries(d.gear?.items || {}).map(([slot, it]) => [slot, trimItem(it)])),
    };
  }, { force });
}

/** "Tarren Mill" -> "tarren-mill", "Mal'Ganis" -> "malganis" (raider.io realm slugs). */
function slugifyRealm(realm) {
  return String(realm || '')
    .trim()
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

function profileUrl(p) {
  return `${BASE}/characters/${p.region}/${p.realmSlug}/${encodeURIComponent(p.name)}`;
}

function runUrl(season, id) {
  return `${BASE}/mythic-plus-runs/${season}/${id}`;
}

module.exports = { getCurrentSeason, getRaids, getSpecRankings, getRecentRuns, getRunDetails, getCharacter, slugifyRealm, profileUrl, runUrl };

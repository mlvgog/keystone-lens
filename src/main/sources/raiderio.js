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

/**
 * Realm names of a region from raider.io's leaderboard-capacity listing (grouped by connected
 * realm): [{ name, altName }] sorted by name. `altName` is the localized name (KR/TW/CN).
 */
function parseRealmListing(json) {
  const byName = new Map();
  for (const group of json?.realmListing?.realms || []) {
    for (const r of group.connectedRealms || []) {
      if (!r?.name || byName.has(r.name)) continue;
      byName.set(r.name, { name: r.name, altName: r.altName && r.altName !== r.name ? r.altName : null });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** All realms of a region (for realm autocomplete). Cached for a week. */
async function getRealms(region, { signal } = {}) {
  const url = `${BASE}/api/v1/mythic-plus/leaderboard-capacity?region=${encodeURIComponent(region)}`;
  return cache.cached('realms', url, async () => parseRealmListing(await fetchJson(url, { signal })));
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

/** raider.io serves this many pages (of 20 runs) per top-runs list without an access key. */
const TOP_RUN_PAGES = 100;

/** Runs of the published top-runs list, with the roster of each run. */
function parseTopRuns(json) {
  return (json?.rankings || [])
    .filter((r) => r?.run?.keystone_run_id)
    .map((r) => ({
      id: r.run.keystone_run_id,
      zoneId: r.run.dungeon?.id ?? null,
      level: r.run.mythic_level,
      score: r.score ?? null,
      completedAt: r.run.completed_at || null,
      roster: (r.run.roster || [])
        .filter((m) => m?.character?.id)
        .map((m) => ({
          characterId: m.character.id,
          name: m.character.name,
          classSlug: m.character.class?.slug || null,
          specId: m.character.spec?.id ?? null,
          realm: m.character.realm?.name || null,
          realmSlug: m.character.realm?.slug || null,
          region: m.character.region?.slug || null,
        })),
    }));
}

/** One page (20 runs) of the season's top keys in one dungeon; [] past the last page. */
async function getTopRuns({ season, region, dungeon, page }, { signal, force } = {}) {
  if (page >= TOP_RUN_PAGES) return [];
  const url =
    `${BASE}/api/v1/mythic-plus/runs?season=${encodeURIComponent(season)}` +
    `&region=${encodeURIComponent(region)}&dungeon=${encodeURIComponent(dungeon)}&page=${page}`;
  return cache.cached('rankings', url, async () => {
    try {
      return parseTopRuns(await fetchJson(url, { signal }));
    } catch (err) {
      if (err.status === 400) return [];
      throw err;
    }
  }, { force });
}

/** Season scores, best key per dungeon and the 10 most recent keys from a character profile. */
function parseMythicPlusProfile(json) {
  const run = (r) => ({
    id: r.keystone_run_id,
    zoneId: r.zone_id ?? null,
    level: r.mythic_level,
    score: r.score,
    completedAt: r.completed_at || null,
  });
  return {
    segments: json?.mythic_plus_scores_by_season?.[0]?.segments || {},
    bestRuns: (json?.mythic_plus_best_runs || []).filter((r) => r?.keystone_run_id).map(run),
    recentRuns: (json?.mythic_plus_recent_runs || []).filter((r) => r?.keystone_run_id).map(run),
  };
}

/**
 * Score and colour of one spec. raider.io numbers a class's specs spec_0..spec_3 in ascending
 * spec id order (Holy, Protection, Retribution).
 */
function specScore(segments, specIndex) {
  const s = specIndex >= 0 ? segments?.[`spec_${specIndex}`] : null;
  return { score: s?.score || 0, color: s?.color || null };
}

/** A character's Mythic+ profile (see parseMythicPlusProfile), or null when raider.io does not know it. */
async function getMythicPlusProfile({ region, realmSlug, name }, { signal, force } = {}) {
  const url =
    `${BASE}/api/v1/characters/profile?region=${encodeURIComponent(region)}` +
    `&realm=${encodeURIComponent(realmSlug)}&name=${encodeURIComponent(name)}` +
    `&fields=mythic_plus_scores_by_season:current,mythic_plus_best_runs,mythic_plus_recent_runs`;
  return cache.cached('profile', url, async () => {
    try {
      return parseMythicPlusProfile(await fetchJson(url, { signal }));
    } catch (err) {
      // Missing/renamed characters are not fatal: we still have the key they were found in.
      if (err.status === 400 || err.status === 404) return { segments: {}, bestRuns: [], recentRuns: [], missing: true };
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

module.exports = {
  getCurrentSeason,
  getRaids,
  getRealms,
  parseRealmListing,
  TOP_RUN_PAGES,
  getTopRuns,
  parseTopRuns,
  getMythicPlusProfile,
  parseMythicPlusProfile,
  specScore,
  getRunDetails,
  getCharacter,
  slugifyRealm,
  profileUrl,
  runUrl,
};

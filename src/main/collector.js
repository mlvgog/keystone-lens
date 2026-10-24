'use strict';

const cache = require('./cache');
const raiderio = require('./sources/raiderio');
const talentTrees = require('./sources/talentTrees');
const itemData = require('./sources/itemData');
const wowhead = require('./sources/wowhead');
const { buildCandidates, mostRecentCandidate, findMember, maxVersion, selectRun } = require('./selection');
const { createDiscovery, poolTarget, rankByScore, specIndexOf } = require('./discovery');
const { heroSubTrees, variantKeyOf, gearItems } = require('./aggregate');
const { classifySource } = require('./itemInfo');

const PHASES = [
  { name: 'Loading talent data', weight: 3 },
  { name: 'Finding players in top keys', weight: 12 },
  { name: 'Scanning players’ keys', weight: 31 },
  { name: 'Selecting best current-patch keys', weight: 20 },
  { name: 'Loading item data', weight: 30 },
  { name: 'Building report', weight: 4 },
];

const SESSION_VERSION = 6;
const RECENT_PROBES = 10;
const ARMORY_LOCALE = { us: 'en-us', eu: 'en-gb', kr: 'ko-kr', tw: 'zh-tw' };

class Progress {
  constructor(onProgress, phases = PHASES, kind = 'analysis') {
    this.onProgress = onProgress || (() => {});
    this.phases = phases;
    this.kind = kind;
    this.phaseIndex = 0;
    this.done = 0;
    this.total = 0;
    this.label = '';
  }

  phase(index, total = 0, label = '') {
    this.phaseIndex = index;
    this.done = 0;
    this.total = total;
    this.label = label;
    this.emit();
  }

  step(label, log) {
    this.done++;
    if (label !== undefined) this.label = label;
    this.emit(log);
  }

  setTotal(total) {
    this.total = total;
    this.emit();
  }

  set(done, label) {
    this.done = done;
    if (label !== undefined) this.label = label;
    this.emit();
  }

  emit(log) {
    const totalWeight = this.phases.reduce((s, p) => s + p.weight, 0);
    let w = 0;
    for (let i = 0; i < this.phaseIndex; i++) w += this.phases[i].weight;
    const frac = this.total ? Math.min(1, this.done / this.total) : 0;
    w += this.phases[this.phaseIndex].weight * frac;
    this.onProgress({
      kind: this.kind,
      phases: this.phases.map((p) => p.name),
      phaseIndex: this.phaseIndex,
      phase: this.phases[this.phaseIndex].name,
      done: this.done,
      total: this.total,
      label: this.label,
      overall: w / totalWeight,
      log: log || null,
    });
  }
}

function playerLabel(p) {
  return `${p.name}-${p.realm} (${String(p.region || '').toUpperCase()})`;
}

function trimTree(tree) {
  const trimNode = (n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    posX: n.posX,
    posY: n.posY,
    maxRanks: n.maxRanks ?? 1,
    entryNode: !!n.entryNode,
    freeNode: !!n.freeNode,
    next: n.next || [],
    reqPoints: n.reqPoints || 0,
    subTreeId: n.subTreeId ?? null,
    rankLevels: n.rankLevels || null,
    entries: (n.entries || []).map((e) => ({
      id: e.id,
      name: e.name,
      spellId: e.spellId,
      icon: e.icon,
      type: e.type,
      maxRanks: e.maxRanks,
    })),
  });
  // Guard against placeholder nodes without a real entry.
  const real = (n) => (n.entries || []).some((e) => e.id);
  return {
    classNodes: tree.classNodes.filter(real).map(trimNode),
    specNodes: tree.specNodes.filter(real).map(trimNode),
    heroNodes: tree.heroNodes.filter(real).map(trimNode),
    subTrees: heroSubTrees(tree),
  };
}

function linksFor(p) {
  const name = encodeURIComponent(String(p.name).toLowerCase());
  const armoryLocale = ARMORY_LOCALE[p.region];
  return {
    raiderio: raiderio.profileUrl(p),
    wcl: `https://www.warcraftlogs.com/character/${p.region}/${p.realmSlug}/${name}`,
    armory: armoryLocale ? `https://worldofwarcraft.blizzard.com/${armoryLocale}/character/${p.region}/${p.realmSlug}/${name}` : null,
  };
}

/** What a player is represented by for one selection (overall or per dungeon). */
function entryFor(run, member, fallback, seasonSlug) {
  return {
    run: {
      id: run.id,
      url: raiderio.runUrl(seasonSlug, run.id),
      dungeon: run.dungeon?.name,
      shortName: run.dungeon?.shortName,
      zoneId: run.dungeon?.zoneId ?? null,
      level: run.level,
      score: run.score,
      completedAt: run.completedAt,
      version: member.talents.version,
    },
    fallback,
    talents: member.talents,
    items: member.items,
    itemLevel: member.itemLevel,
  };
}

function analysisKey({ classSlug, specSlug, region, sampleSize, since }) {
  return JSON.stringify({ classSlug, specSlug, region, sampleSize, since, v: SESSION_VERSION });
}

/** Run snapshots are shared between group members, so fetches are de-duplicated. */
function runGetter(seasonSlug, signal) {
  const runPromises = new Map();
  return (id) => {
    if (!runPromises.has(id)) {
      runPromises.set(
        id,
        raiderio.getRunDetails({ season: seasonSlug, id }, { signal }).catch((err) => {
          if (err.name === 'AbortError') throw err;
          return { id, missing: true, roster: [], error: err.message };
        })
      );
    }
    return runPromises.get(id);
  };
}

/**
 * Look up every item variant the session uses that has not been looked up yet: where the item
 * comes from and its type (Wowhead's item XML), and its stats and embellishment at the variant's
 * item level (game tables).
 */
async function enrichItems(session, { signal, progress, seasonDungeons = session.meta.dungeons }) {
  session.itemInfo ||= {};
  session.itemSources ||= {};
  const variants = new Map();
  const items = new Map();
  for (const p of session.players) {
    for (const d of [p.main, ...Object.values(p.dungeons || {})]) {
      if (!d) continue;
      for (const it of gearItems(d)) {
        const key = variantKeyOf(it);
        if (!session.itemInfo[key]) variants.set(key, it);
        if (!session.itemSources[it.id]) items.set(it.id, it);
      }
    }
  }
  progress.setTotal(items.size + (variants.size ? 1 : 0));
  const raids = items.size ? await raiderio.getRaids(session.meta.season.expansionId || 11, { signal }) : [];

  await Promise.all(
    [...items].map(async ([id, it]) => {
      const src = await wowhead.getItemXml(id, { signal });
      session.itemSources[id] = {
        ...classifySource({ tier: !!it.tier, src, boss: src.droppedBy, seasonDungeons, raids }),
        slot: src.slot ?? null,
        slotType: src.slotType,
      };
      progress.step(it.name);
    })
  );
  if (!variants.size) return;

  const list = [...variants].map(([key, it]) => ({ key, id: it.id, bonuses: it.bonuses, ilvl: it.ilvl }));
  const described = await itemData.describeVariants(list, { signal });
  for (const v of list) session.itemInfo[v.key] = described[v.key] || { stats: null, primary: null, stamina: 0, sockets: 0, embellished: false };
  progress.step('Item stats');
}

/**
 * Collect talents + gear for the top `sampleSize` ranked players of a spec.
 * Returns { session, fromCache } (or null with `cacheOnly` when nothing is cached).
 * A session holds the raw per-player data; views
 * (src/main/views.js) aggregate it.
 */
async function analyze(opts, { signal, onProgress, force = false, allowStale = false, cacheOnly = false } = {}) {
  const { classSlug, specSlug, specId, className, specName, color, specIcon } = opts;
  const region = opts.region || 'world';
  const sampleSize = Math.max(1, Math.min(200, Number(opts.sampleSize) || 50));
  const since = opts.since || null;

  const key = analysisKey({ classSlug, specSlug, region, sampleSize, since });
  if (!force) {
    const hit = await cache.read('analysis', key, { ignoreTtl: allowStale });
    if (hit?.version === SESSION_VERSION) return { session: hit, fromCache: true };
  }
  if (cacheOnly) return null;

  const progress = new Progress(onProgress);

  // 1. Static data
  progress.phase(0, 2, 'Talent trees (SimulationCraft + wago.tools)');
  const talentData = await talentTrees.getTalentData({ signal });
  const tree = talentData.find((t) => t.specId === specId);
  if (!tree) throw new Error(`No talent tree data for ${specName} ${className}`);
  progress.step('Current season (raider.io)');
  const season = await raiderio.getCurrentSeason({ signal });
  progress.step(season.name);

  // 2. Players: everyone who played the spec in the season's top keys (published top-runs lists)
  const regionName = region === 'world' ? 'World' : region.toUpperCase();
  const specIndex = specIndexOf(talentData.filter((t) => t.className === className).map((t) => t.specId), specId);
  const discovery = createDiscovery({
    dungeons: season.dungeons.map((d) => d.slug).filter(Boolean),
    specId,
    // Not forced by Refresh: the pages only find players; scores and keys come fresh from profiles.
    fetchPage: (dungeon, page) => raiderio.getTopRuns({ season: season.slug, region, dungeon, page }, { signal }),
  });
  const target = poolTarget(sampleSize);
  const maxPages = season.dungeons.length * raiderio.TOP_RUN_PAGES;
  progress.phase(1, target, `${season.name} · ${regionName}`);
  // Rare specs can need every page, so the bar follows whichever is further along.
  await discovery.until(target, () =>
    progress.set(
      Math.min(target, Math.max(discovery.players.length, Math.round((discovery.pagesRead / maxPages) * target))),
      `${discovery.players.length} ${specName} players in ${discovery.pagesRead} of ${maxPages} pages of top keys`
    )
  );
  if (!discovery.players.length) throw new Error(`No ${specName} ${className} players were found in ${season.name} top keys on raider.io (${regionName}).`);

  const getRun = runGetter(season.slug, signal);

  // 3. Pass A: season score + key history of every player found, ranked by score. Then the best
  //    key of every sampled player is probed, plus the most recent key of the top players, which
  //    is enough to notice that a newer patch is live.
  async function load(player) {
    let profile = { segments: {}, bestRuns: [], recentRuns: [] };
    try {
      profile = await raiderio.getMythicPlusProfile(player, { signal, force });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
    const { score, color } = raiderio.specScore(profile.segments, specIndex);
    return {
      player: { ...player, score, scoreColor: color },
      candidates: buildCandidates([...profile.bestRuns, ...player.foundRuns], profile.recentRuns),
      versions: [],
    };
  }

  async function probe(state, index) {
    const { player, candidates } = state;
    const probes = [candidates[0], index < RECENT_PROBES ? mostRecentCandidate(candidates) : null].filter(Boolean);
    for (const c of new Set(probes)) {
      const member = findMember(await getRun(c.id), player.characterId, specId);
      if (member?.talents?.version) state.versions.push(member.talents.version);
    }
    progress.step(playerLabel(player), `#${player.rank} ${playerLabel(player)} — ${candidates.length} keys found`);
  }

  let loadedCount = 0;
  async function loadAll(players, firstRank) {
    const states = await Promise.all(
      players.map(async (p) => {
        const state = await load(p);
        progress.step(playerLabel(p));
        return state;
      })
    );
    const ranked = rankByScore(states);
    ranked.forEach((s, i) => (s.player.rank = firstRank + i));
    loadedCount += players.length;
    return ranked;
  }

  const found = discovery.players.slice();
  progress.phase(2, found.length + Math.min(sampleSize, found.length), 'Reading key history');
  let ranked = await loadAll(found, 1);
  let prepared = ranked.slice(0, sampleSize);
  await Promise.all(prepared.map((state, index) => probe(state, index)));
  const patch = maxVersion(prepared.flatMap((s) => s.versions));

  // 4. Pass B: pick each player's best key on the current patch (or fall back)
  const selected = [];
  const skipped = [];
  async function resolve(state) {
    const { player, candidates } = state;
    const choice = await selectRun({ candidates, characterId: player.characterId, specId, version: patch, since, getRun });
    if (!choice) {
      skipped.push({ rank: player.rank, name: player.name, realm: player.realm, region: player.region, reason: 'No usable key snapshot (private profile or no key on this spec)' });
      progress.step(playerLabel(player), `✗ #${player.rank} ${playerLabel(player)} skipped — no usable key snapshot`);
      return;
    }
    const { run, member } = choice;
    selected.push({ player, candidates, run, member, fallback: choice.fallback });
    progress.step(
      playerLabel(player),
      `${choice.fallback ? '↺' : '✓'} #${player.rank} ${playerLabel(player)} — +${run.level} ${run.dungeon.name} (${member.talents.version || '?'})${choice.fallback ? ' fallback' : ''}`
    );
  }

  progress.phase(3, prepared.length, 'Matching keys to the current patch');
  await Promise.all(prepared.map(resolve));

  // Backfill with the next players by score (finding more players when needed) when some had to be skipped.
  let cursor = prepared.length;
  while (selected.length < sampleSize) {
    const need = sampleSize - selected.length;
    if (cursor + need > ranked.length && !discovery.exhausted) {
      await discovery.until(discovery.players.length + need);
      const fresh = discovery.players.slice(loadedCount);
      if (fresh.length) {
        progress.setTotal(progress.total + fresh.length);
        ranked = ranked.concat(await loadAll(fresh, ranked.length + 1));
      }
    }
    if (cursor >= ranked.length) break;
    const batch = ranked.slice(cursor, cursor + need);
    cursor += batch.length;
    progress.setTotal(progress.total + batch.length);
    prepared = prepared.concat(batch);
    await Promise.all(batch.map(resolve));
  }

  selected.sort((a, b) => a.player.rank - b.player.rank);
  const sample = selected.slice(0, sampleSize);
  if (!sample.length) throw new Error('No usable player data was found for this spec.');

  const session = {
    version: SESSION_VERSION,
    key,
    meta: {
      className,
      specName,
      classSlug,
      specSlug,
      specId,
      color,
      specIcon,
      region,
      season: { slug: season.slug, name: season.name, expansionId: season.expansionId },
      dungeons: season.dungeons.map((d) => ({ id: d.id, name: d.name, shortName: d.shortName, challengeModeId: d.challengeModeId ?? null })),
      patch,
      since,
      requested: sampleSize,
      sampleSize: sample.length,
      skipped,
      generatedAt: new Date().toISOString(),
    },
    tree: trimTree(tree),
    players: sample.map(({ player, candidates, run, member, fallback }) => ({
      rank: player.rank,
      name: player.name,
      realm: player.realm,
      realmSlug: player.realmSlug,
      region: player.region,
      characterId: player.characterId,
      score: player.score,
      scoreColor: player.scoreColor,
      links: linksFor(player),
      candidates: candidates.map((c) => ({
        id: c.id,
        zoneId: c.zoneId ?? null,
        level: c.level,
        score: c.score,
        completedAt: c.completedAt || null,
        period: c.period || null,
      })),
      main: entryFor(run, member, fallback, season.slug),
      dungeons: {},
    })),
    dungeonsLoaded: [],
    itemInfo: {},
    itemSources: {},
  };

  // 5. Item data: stats, embellishments, sources
  progress.phase(4, 0, 'Item data (Wowhead item XML + game tables)');
  await enrichItems(session, { signal, progress });

  progress.phase(5, 1, 'Building report');
  progress.step('Done');
  await cache.write('analysis', key, session);
  return { session, fromCache: false };
}

/**
 * Load each sampled player's best key in one dungeon (same patch rules), so the views
 * can show per-dungeon talents and gear. Saves the session back to the cache.
 */
async function loadDungeon(session, zoneId, { signal, onProgress } = {}) {
  const dungeon = session.meta.dungeons.find((d) => d.id === zoneId);
  if (!dungeon) throw new Error('Unknown dungeon');
  if (session.dungeonsLoaded?.includes(zoneId)) return session;

  const progress = new Progress(
    onProgress,
    [
      { name: `Loading ${dungeon.name} keys`, weight: 75 },
      { name: 'Loading item data', weight: 25 },
    ],
    'dungeon'
  );
  const getRun = runGetter(session.meta.season.slug, signal);
  try {
    progress.phase(0, session.players.length, dungeon.name);
    await Promise.all(
      session.players.map(async (p) => {
        const candidates = p.candidates.filter((c) => c.zoneId === zoneId);
        const choice = candidates.length
          ? await selectRun({
              candidates,
              characterId: p.characterId,
              specId: session.meta.specId,
              version: session.meta.patch,
              since: session.meta.since,
              getRun,
            })
          : null;
        p.dungeons ||= {};
        p.dungeons[zoneId] = choice ? entryFor(choice.run, choice.member, choice.fallback, session.meta.season.slug) : null;
        progress.step(p.name);
      })
    );
    progress.phase(1, 0, 'Item data (Wowhead item XML + game tables)');
    await enrichItems(session, { signal, progress });
  } catch (err) {
    for (const p of session.players) if (p.dungeons) delete p.dungeons[zoneId];
    throw err;
  }
  session.dungeonsLoaded = [...new Set([...(session.dungeonsLoaded || []), zoneId])];
  await cache.write('analysis', session.key, session);
  return session;
}

module.exports = { analyze, loadDungeon, enrichItems, trimTree, linksFor, Progress, PHASES };

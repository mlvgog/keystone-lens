'use strict';

const cache = require('./cache');
const raiderio = require('./sources/raiderio');
const raidbots = require('./sources/raidbots');
const wowhead = require('./sources/wowhead');
const { buildCandidates, mostRecentCandidate, findMember, maxVersion, selectRun } = require('./selection');
const { heroSubTrees, variantKeyOf, gearItems } = require('./aggregate');
const { parseStats, isEmbellished, droppedBy, classifySource } = require('./itemInfo');

const PHASES = [
  { name: 'Loading talent data', weight: 3 },
  { name: 'Fetching rankings', weight: 3 },
  { name: 'Scanning players’ keys', weight: 40 },
  { name: 'Selecting best current-patch keys', weight: 20 },
  { name: 'Loading item data', weight: 30 },
  { name: 'Building report', weight: 4 },
];

const SESSION_VERSION = 3;
const MAX_RANKING_PAGES = 5;
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
  // raidbots occasionally ships empty placeholder nodes (no name, empty entry) far outside the tree.
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
 * Look up every item variant the session uses that has not been looked up yet:
 * secondary stats + embellishment (from English tooltips) and where the item comes from.
 */
async function enrichItems(session, { signal, progress }) {
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
  progress.setTotal(variants.size + items.size);
  const raids = items.size ? await raiderio.getRaids(session.meta.season.expansionId || 11, { signal }) : [];

  await Promise.all(
    [...variants].map(async ([key, it]) => {
      const tt = await wowhead.getItemTooltip(it, { signal, locale: 0 });
      session.itemInfo[key] = { stats: parseStats(tt.tooltip), embellished: isEmbellished(tt.tooltip), boss: droppedBy(tt.tooltip) };
      progress.step(it.name);
    })
  );
  const bossOf = (id) => Object.entries(session.itemInfo).find(([k, v]) => k.startsWith(`${id}|`) && v.boss)?.[1].boss || null;
  await Promise.all(
    [...items].map(async ([id, it]) => {
      const src = await wowhead.getItemSource(id, { signal });
      session.itemSources[id] = {
        ...classifySource({ tier: !!it.tier, src, boss: bossOf(id), seasonDungeons: session.meta.dungeons, raids }),
        slot: src.slot ?? null,
      };
      progress.step(it.name);
    })
  );
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
  progress.phase(0, 2, 'Talent trees (raidbots)');
  const talentData = await raidbots.getTalentData({ signal });
  const tree = talentData.find((t) => t.specId === specId);
  if (!tree) throw new Error(`No talent tree data for ${specName} ${className}`);
  progress.step('Current season (raider.io)');
  const season = await raiderio.getCurrentSeason({ signal });
  progress.step(season.name);

  // 2. Rankings
  progress.phase(1, 1, `${season.name} · ${region === 'world' ? 'World' : region.toUpperCase()}`);
  const pool = [];
  let nextPage = 0;
  let lastPage = Infinity;
  async function ensurePool(n) {
    while (pool.length < n && nextPage <= lastPage && nextPage < MAX_RANKING_PAGES) {
      const res = await raiderio.getSpecRankings(
        { season: season.slug, region, classSlug, specSlug, page: nextPage },
        { signal, force }
      );
      nextPage++;
      lastPage = res.lastPage;
      if (!res.players.length) break;
      pool.push(...res.players);
    }
  }
  await ensurePool(sampleSize);
  if (!pool.length) throw new Error(`raider.io has no ranked ${specName} ${className} players for ${season.name}.`);
  progress.step(`${pool.length} ranked players loaded`);

  const getRun = runGetter(season.slug, signal);

  // 3. Pass A: candidates + probe the best key of every player. The most recent key of the
  //    top players is probed too, which is enough to notice that a newer patch is live.
  async function prepare(player, index = Infinity) {
    let recent = [];
    try {
      recent = await raiderio.getRecentRuns(player, { signal, force });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
    const candidates = buildCandidates(player.runs, recent);
    const versions = [];
    const probes = [candidates[0], index < RECENT_PROBES ? mostRecentCandidate(candidates) : null].filter(Boolean);
    for (const c of new Set(probes)) {
      const member = findMember(await getRun(c.id), player.characterId, specId);
      if (member?.talents?.version) versions.push(member.talents.version);
    }
    return { player, candidates, versions };
  }

  progress.phase(2, Math.min(sampleSize, pool.length), 'Reading key history');
  let prepared = await Promise.all(
    pool.slice(0, sampleSize).map(async (player, index) => {
      const state = await prepare(player, index);
      progress.step(playerLabel(player), `#${player.rank} ${playerLabel(player)} — ${state.candidates.length} keys found`);
      return state;
    })
  );
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

  // Backfill from further down the rankings when players had to be skipped.
  let cursor = prepared.length;
  while (selected.length < sampleSize) {
    await ensurePool(cursor + (sampleSize - selected.length));
    if (cursor >= pool.length) break;
    const batch = pool.slice(cursor, cursor + (sampleSize - selected.length));
    cursor += batch.length;
    progress.setTotal(progress.total + batch.length);
    const extra = await Promise.all(batch.map((player) => prepare(player)));
    prepared = prepared.concat(extra);
    await Promise.all(extra.map(resolve));
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
      dungeons: season.dungeons.map((d) => ({ id: d.id, name: d.name, shortName: d.shortName })),
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
  progress.phase(4, 0, 'Item data (wowhead)');
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
    progress.phase(1, 0, 'Item data (wowhead)');
    await enrichItems(session, { signal, progress });
  } catch (err) {
    for (const p of session.players) if (p.dungeons) delete p.dungeons[zoneId];
    throw err;
  }
  session.dungeonsLoaded = [...new Set([...(session.dungeonsLoaded || []), zoneId])];
  await cache.write('analysis', session.key, session);
  return session;
}

module.exports = { analyze, loadDungeon, PHASES };

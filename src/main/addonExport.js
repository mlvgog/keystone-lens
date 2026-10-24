'use strict';

/**
 * Data for the Keystone Lens game addon: compact per-spec records built from an analysis
 * (Mythic+ only: Warcraft Logs data must never be written to disk), and the
 * `KeystoneLens_Data` addon folder the game loads them from.
 *
 * Record (per spec, numbers are fractions of the sampled players unless named n = count):
 * { specId, class, spec, region, sample, requested, season, patch, since, time, ilvl,
 *   hero: [{ id, name, n }],
 *   talents: { [nodeId]: { p, e: { [entryId]: share } (choice nodes), r: common rank (multi-rank) } },
 *   builds: [{ n, p, hero, str, picks: { [nodeId]: rank }, choices: { [nodeId]: entryId } }],
 *   gear: { [slotGroup]: [{ id, name, n, ilvl, tier }] },
 *   enchants: { [slotGroup]: [{ id, name, n }] }, gems: [{ id, name, n }], gemSockets (gems socketed in all),
 *   embellishments: [{ id, name, n }], stats: { crit, haste, mastery, vers } (share of their secondary stats),
 *   statRatings: { crit, haste, mastery, vers } (average rating from gear and gems, enchants not counted),
 *   races: [{ key, id (a game race id), ids (all of the race's ids), name, n, faction, spells: [{ id, name }] (racials of this class) }],
 *   dungeonList: [{ id, name, short, map }],
 *   dungeons: { [zoneId]: { sample, hero, talents, builds } } }
 */

const fs = require('fs');
const path = require('path');
const { buildView, samplePlayers } = require('./views');
const { SLOT_GROUPS, cleanEnchantName, stripEscapes } = require('./aggregate');
const { toLua } = require('./lua');
const { raceByKey } = require('./races');

const SCHEMA = 1;
const DATA_ADDON = 'KeystoneLens_Data';
const MAIN_ADDON = 'KeystoneLens';
const DATA_GLOBAL = 'KeystoneLensAppData';
const TOP_ITEMS = 8;
const TOP_ENCHANTS = 3;
const TOP_GEMS = 6;
const MAX_BUILDS = 6;

const round = (x, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;

function treeNodes(tree) {
  return [...(tree.classNodes || []), ...(tree.specNodes || []), ...(tree.heroNodes || [])];
}

function mostCommonRank(ranks) {
  let best = null;
  for (const [r, c] of Object.entries(ranks || {})) if (!best || c > best[1]) best = [Number(r), c];
  return best ? best[0] : 0;
}

/** Pick rates per node; nodes nobody picked are left out (0%). */
function talentsRecord(talents, tree) {
  const byId = new Map(treeNodes(tree).map((n) => [n.id, n]));
  const out = {};
  for (const [id, s] of Object.entries(talents.nodes)) {
    if (!s.picked || !s.total) continue;
    const node = byId.get(Number(id));
    const rec = { p: round(s.pct) };
    if (node?.type === 'choice') {
      rec.e = {};
      for (const [entryId, count] of Object.entries(s.entries)) rec.e[entryId] = round(count / s.total);
    }
    if ((node?.maxRanks || 1) > 1) rec.r = mostCommonRank(s.ranks);
    out[id] = rec;
  }
  return out;
}

function heroRecord(hero) {
  return hero.filter((h) => h.count).map((h) => ({ id: h.id, name: h.name, n: h.count }));
}

/** The talents a build's most typical player picked (free nodes left out, as when builds are grouped). */
function buildPicks(talents, tree) {
  const choiceNodes = new Set(treeNodes(tree).filter((n) => n.type === 'choice').map((n) => n.id));
  const picks = {};
  const choices = {};
  for (const n of talents?.nodes || []) {
    if (!n.rank || n.granted || n.nodeId in picks) continue;
    picks[n.nodeId] = n.rank;
    if (choiceNodes.has(n.nodeId) && n.entryId != null) choices[n.nodeId] = n.entryId;
  }
  return { picks, choices };
}

function buildsRecord(view, session, dungeon) {
  return view.builds.list.slice(0, MAX_BUILDS).map((b) => {
    const p = session.players[b.medoidIndex];
    const d = dungeon ? p?.dungeons?.[dungeon] : p?.main;
    return {
      n: b.size,
      p: round(b.pct),
      hero: b.heroSubTreeId ?? undefined,
      str: b.loadoutText || undefined,
      ...buildPicks(d?.talents, session.tree),
    };
  });
}

function gearRecord(gear) {
  const out = {};
  for (const g of gear) {
    if (!g.items.length) continue;
    out[g.key] = g.items.slice(0, TOP_ITEMS).map((it) => ({
      id: it.id,
      name: it.name || undefined,
      n: it.count,
      ilvl: it.ilvl?.common || undefined,
      tier: it.tier || undefined,
    }));
  }
  return out;
}

function topById(counts, n) {
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.id - b.id)
    .slice(0, n);
}

/** Enchants per slot group and gems by their game IDs, so the addon can match your own gear. */
function enchantsAndGems(players) {
  const enchants = {};
  for (const g of SLOT_GROUPS) {
    const counts = new Map();
    for (const items of players) {
      const seen = new Set();
      for (const slot of g.slots) {
        for (const e of items[slot]?.enchants || []) {
          if (!e.id || seen.has(e.id)) continue;
          seen.add(e.id);
          const entry = counts.get(e.id) || { id: e.id, name: cleanEnchantName(e.name) || undefined, n: 0 };
          entry.n++;
          counts.set(e.id, entry);
        }
      }
    }
    if (counts.size) enchants[g.key] = topById(counts, TOP_ENCHANTS);
  }
  const gems = new Map();
  let sockets = 0;
  for (const items of players) {
    for (const g of SLOT_GROUPS) {
      for (const slot of g.slots) {
        for (const gem of items[slot]?.gems || []) {
          if (!gem.id) continue;
          sockets++;
          const entry = gems.get(gem.id) || { id: gem.id, name: stripEscapes(gem.name) || undefined, n: 0 };
          entry.n++;
          gems.set(gem.id, entry);
        }
      }
    }
  }
  return { enchants, gems: topById(gems, TOP_GEMS), gemSockets: sockets };
}

function statsRecord(profile) {
  if (!profile) return undefined;
  return Object.fromEntries(profile.stats.map((s) => [s.key, round(s.share)]));
}

function statRatingsRecord(profile) {
  if (!profile) return undefined;
  return Object.fromEntries(profile.stats.map((s) => [s.key, Math.round(s.avg)]));
}

/** The races the players play, with each race's racials for the spec's class (when they could be loaded). */
function racesRecord(races, racials) {
  if (!races?.list?.length) return undefined;
  return races.list.map((r) => ({
    key: r.key,
    id: raceByKey(r.key).ids[0],
    ids: raceByKey(r.key).ids,
    name: r.name,
    n: r.count,
    faction: r.faction,
    spells: racials?.[r.key]?.map((s) => ({ id: s.id, name: s.name })),
  }));
}

/**
 * The record of one analysed spec (Mythic+ sessions only).
 * `racials(classId)` -> { [raceKey]: [{ id, name }] } adds the racial abilities (races.racialsByRace);
 * without it, or when it fails (offline), the races are written without them.
 */
async function specRecord(session, { racials = null } = {}) {
  const { meta, tree } = session;
  if (meta.mode === 'raid') throw new Error('Raid data (Warcraft Logs) is not exported to the addon.');
  const view = await buildView(session, {}, {});
  let racialsByRace = null;
  if (racials && view.races?.list?.length) {
    try {
      racialsByRace = await racials(meta.classId ?? null);
    } catch {
      racialsByRace = null;
    }
  }
  const { enchants, gems, gemSockets } = enchantsAndGems(samplePlayers(session, null).map((x) => x.d.items || {}));
  const record = {
    specId: meta.specId,
    class: meta.className,
    spec: meta.specName,
    region: meta.region,
    sample: view.sampleSize,
    requested: meta.requested,
    season: meta.season?.name,
    patch: meta.patch || undefined,
    since: meta.since || undefined,
    time: Math.floor(Date.parse(meta.generatedAt) / 1000) || undefined,
    ilvl: round(view.avgItemLevel, 1),
    hero: heroRecord(view.hero),
    talents: talentsRecord(view.talents, tree),
    builds: buildsRecord(view, session, null),
    gear: gearRecord(view.gear),
    enchants,
    gems,
    gemSockets: gemSockets || undefined,
    embellishments: view.gearSummary.embellishments.items.slice(0, TOP_GEMS).map((e) => ({ id: e.id, name: e.name || undefined, n: e.count })),
    stats: statsRecord(view.statProfile),
    statRatings: statRatingsRecord(view.statProfile),
    races: racesRecord(view.races, racialsByRace),
    dungeonList: meta.dungeons.map((d) => ({ id: d.id, name: d.name, short: d.shortName || undefined, map: d.challengeModeId || undefined })),
    dungeons: {},
  };
  for (const zoneId of session.dungeonsLoaded || []) {
    const dv = await buildView(session, { dungeon: zoneId }, {});
    if (!dv.sampleSize) {
      record.dungeons[zoneId] = { sample: 0 }; // loaded, but nobody has a usable key there
      continue;
    }
    record.dungeons[zoneId] = {
      sample: dv.sampleSize,
      hero: heroRecord(dv.hero),
      talents: talentsRecord(dv.talents, tree),
      builds: buildsRecord(dv, session, zoneId),
    };
  }
  return record;
}

/**
 * The Lua data file. Each spec is built inside its own function: Lua 5.1 limits the number of
 * constants per function, and a file with many specs could otherwise exceed it.
 */
function dataFileText(records, { appVersion = '', now = Date.now() } = {}) {
  const head = { schema: SCHEMA, source: 'app', app: appVersion || undefined, time: Math.floor(now / 1000), specs: {} };
  const lines = [
    '-- Written by the Keystone Lens app (https://github.com/mlvgog/keystone-lens).',
    '-- Do not edit: the app rewrites this file. Delete the KeystoneLens_Data folder to remove the data.',
    `${DATA_GLOBAL} = ${toLua(head)}`,
  ];
  for (const rec of Object.values(records).sort((a, b) => a.specId - b.specId)) {
    lines.push(`${DATA_GLOBAL}.specs[${Number(rec.specId)}] = (function() return ${toLua(rec)} end)()`);
  }
  return `${lines.join('\n')}\n`;
}

/** `## Interface:` value of a .toc file, or null. */
function readTocField(text, field) {
  const m = new RegExp(`^##\\s*${field}\\s*:\\s*(.+?)\\s*$`, 'mi').exec(String(text || ''));
  return m ? m[1] : null;
}

function tocText({ interfaceVersion, appVersion }) {
  return [
    `## Interface: ${interfaceVersion}`,
    '## Title: Keystone Lens Data',
    '## Notes: Talent and gear data for the Keystone Lens addon, written by the Keystone Lens app. Loads when you log in or /reload.',
    '## Author: Keystone Lens app',
    `## Version: ${appVersion || '0'}`,
    `## Dependencies: ${MAIN_ADDON}`,
    `## Group: ${MAIN_ADDON}`,
    '',
    'Data.lua',
    '',
  ].join('\n');
}

/** Write a file so that a reader never sees it half written. */
async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, text);
  await fs.promises.rename(tmp, file);
}

/**
 * Write `AddOns/KeystoneLens_Data` with the given records. The Interface value is copied from
 * the installed KeystoneLens addon (else `fallbackInterface`) so the game doesn't flag the data
 * folder as out of date.
 */
async function writeDataAddon(addonsDir, records, { appVersion, fallbackInterface, now } = {}) {
  let interfaceVersion = fallbackInterface || null;
  try {
    interfaceVersion = readTocField(await fs.promises.readFile(path.join(addonsDir, MAIN_ADDON, `${MAIN_ADDON}.toc`), 'utf8'), 'Interface') || interfaceVersion;
  } catch {
    // main addon not installed (yet)
  }
  if (!interfaceVersion) throw new Error('Install the Keystone Lens addon first.');
  const dir = path.join(addonsDir, DATA_ADDON);
  await fs.promises.mkdir(dir, { recursive: true });
  await writeAtomic(path.join(dir, 'Data.lua'), dataFileText(records, { appVersion, now }));
  await writeAtomic(path.join(dir, `${DATA_ADDON}.toc`), tocText({ interfaceVersion, appVersion }));
  return dir;
}

module.exports = {
  SCHEMA,
  DATA_ADDON,
  MAIN_ADDON,
  DATA_GLOBAL,
  specRecord,
  talentsRecord,
  buildPicks,
  dataFileText,
  tocText,
  readTocField,
  writeDataAddon,
};

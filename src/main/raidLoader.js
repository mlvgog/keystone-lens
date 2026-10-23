'use strict';

const wcl = require('./sources/wcl');
const talentTrees = require('./sources/talentTrees');
const raiderio = require('./sources/raiderio');
const wowhead = require('./sources/wowhead');
const itemData = require('./sources/itemData');
const { enrichItems, trimTree, linksFor, Progress } = require('./collector');
const { buildRaidSession, gemLabel, DIFFICULTIES } = require('./raid');
const { encodeLoadout } = require('./loadout');

const PHASES = [
  { name: 'Loading raid and talent data', weight: 5 },
  { name: 'Loading boss rankings (Warcraft Logs)', weight: 60 },
  { name: 'Loading item data', weight: 35 },
];

/**
 * Raid mode session for a spec and difficulty: the top logged kills on every boss of the current
 * raid. opts: { specId, className, specName, classSlug, specSlug, color, specIcon, difficulty, metric }.
 * When Warcraft Logs' hourly limit runs out part-way, the bosses loaded so far are used and the
 * rest are listed in meta.missing.
 */
async function loadRaid(opts, { signal, onProgress, force = false } = {}) {
  const difficulty = [3, 4, 5].includes(Number(opts.difficulty)) ? Number(opts.difficulty) : 5;
  const metric = opts.metric === 'hps' ? 'hps' : 'dps';
  const progress = new Progress(onProgress, PHASES);

  progress.phase(0, 3, 'Talent trees');
  const tree = (await talentTrees.getTalentData({ signal })).find((t) => t.specId === opts.specId);
  if (!tree) throw new Error(`No talent tree data for ${opts.specName} ${opts.className}`);
  progress.step('Current raid (Warcraft Logs)');
  const zone = await wcl.getRaidZone({ signal });
  progress.step('Current M+ season (raider.io)');
  const season = await raiderio.getCurrentSeason({ signal });
  progress.step(zone.name);

  progress.phase(1, zone.encounters.length, `${zone.name} · ${DIFFICULTIES[difficulty]}`);
  const bosses = [];
  const missing = [];
  let limit = null;
  for (const enc of zone.encounters) {
    if (limit) {
      missing.push(enc.name);
      continue;
    }
    try {
      const rankings = await wcl.getBossRankings(
        { encounterId: enc.id, difficulty, className: opts.className, specName: opts.specName, metric },
        { signal, force }
      );
      if (rankings.length) bosses.push({ id: enc.id, name: enc.name, rankings });
      progress.step(enc.name, `${rankings.length ? '✓' : '✗'} ${enc.name} — ${rankings.length} logged kills`);
    } catch (err) {
      if (err.code !== 'WCL_LIMIT') throw err;
      limit = err;
      missing.push(enc.name);
      progress.step(enc.name, `✗ ${enc.name} — Warcraft Logs' hourly limit reached`);
    }
  }
  if (!bosses.length) throw limit || new Error(`Warcraft Logs has no ${DIFFICULTIES[difficulty]} kills logged for ${opts.specName} ${opts.className} yet.`);

  const session = buildRaidSession({
    meta: {
      className: opts.className,
      specName: opts.specName,
      classSlug: opts.classSlug,
      specSlug: opts.specSlug,
      specId: opts.specId,
      color: opts.color,
      specIcon: opts.specIcon,
      region: 'world',
      difficulty,
      difficultyName: DIFFICULTIES[difficulty],
      metric,
      zone: { id: zone.id, name: zone.name },
      season: { slug: season.slug, name: zone.name, expansionId: season.expansionId },
      missing,
    },
    tree,
    trimmedTree: trimTree(tree),
    bosses,
    links: linksFor,
  });

  // Import strings for "Copy build" (Warcraft Logs gives the picks, not the string).
  for (const p of session.players) for (const d of Object.values(p.dungeons)) if (d) d.talents.loadoutText = encodeLoadout(d.talents, tree);

  // Item details: tier set (from the item XML), enchant and gem names, then stats and sources.
  progress.phase(2, 0, 'Item data (Wowhead item XML + game tables)');
  const items = session.players.flatMap((p) => Object.values(p.dungeons).flatMap((d) => Object.values(d?.items || {})));
  const itemIds = [...new Set(items.map((it) => it.id))];
  const gemIds = [...new Set(items.flatMap((it) => it.gems.map((g) => g.id)))];
  const [xml, gemXml, enchants] = await Promise.all([
    Promise.all(itemIds.map((id) => wowhead.getItemXml(id, { signal }))),
    Promise.all(gemIds.map((id) => wowhead.getItemXml(id, { signal }))),
    itemData.getEnchantNames(items.flatMap((it) => it.enchants.map((e) => e.id)), { signal }),
  ]);
  const setOf = new Map(itemIds.map((id, i) => [id, xml[i]?.itemSet]));
  const gemName = new Map(gemIds.map((id, i) => [id, gemLabel(gemXml[i]?.stats) || gemXml[i]?.name || null]));
  for (const it of items) {
    if (setOf.get(it.id)) it.tier = String(setOf.get(it.id));
    for (const g of it.gems) g.name = gemName.get(g.id) || null;
    for (const e of it.enchants) e.name = enchants[e.id] || null;
  }
  await enrichItems(session, { signal, progress, seasonDungeons: season.dungeons });
  return session;
}

module.exports = { loadRaid, PHASES };

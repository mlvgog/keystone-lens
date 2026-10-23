'use strict';

/**
 * Raid mode: the top logged kills of a spec on every boss of the current raid (Warcraft Logs
 * rankings, with each player's talents and gear at that kill), shaped like an M+ session so the
 * existing views work unchanged: every ranked player once, their kill on each boss in the slot
 * M+ uses for dungeons, and their best-ranked kill as the overall entry.
 * Raid data comes from Warcraft Logs and is kept in memory only.
 */

const { aggregateTalents } = require('./aggregate');
const { averageItemLevel } = require('./throughput');

// Warcraft Logs gear order (game inventory slots); shirt and tabard are left out.
const WCL_SLOTS = ['head', 'neck', 'shoulder', null, 'chest', 'waist', 'legs', 'feet', 'wrist', 'hands', 'finger1', 'finger2', 'trinket1', 'trinket2', 'back', 'mainhand', 'offhand', null];
const QUALITY = { poor: 0, common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, artifact: 6, heirloom: 7 };
const NODE_TYPES = ['single', 'tiered', 'choice', 'subtree'];
const DIFFICULTIES = { 3: 'Normal', 4: 'Heroic', 5: 'Mythic' };

function entryLookup(tree) {
  const byEntry = new Map();
  for (const key of ['classNodes', 'specNodes', 'heroNodes']) for (const n of tree[key] || []) n.entries.forEach((e, i) => byEntry.set(e.id, { node: n, index: i }));
  return byEntry;
}

/**
 * Warcraft Logs talents ([{ id: talent entry id, points }]) -> the app's loadout shape
 * { heroSubTreeId, nodes: [{ nodeId, type, entryIndex, entryId, rank, granted }] }.
 * Apex talents list every tier with its points, so ranks add up per node.
 */
function mapTalents(talents, tree, byEntry = entryLookup(tree)) {
  const byNode = new Map();
  for (const t of talents || []) {
    const hit = byEntry.get(t.id);
    if (!hit) continue;
    const cur = byNode.get(hit.node.id) || { node: hit.node, rank: 0, index: hit.index };
    cur.rank += t.points || 1;
    if (hit.node.type !== 'tiered') cur.index = hit.index;
    byNode.set(hit.node.id, cur);
  }
  const heroCounts = new Map();
  for (const { node } of byNode.values()) if (node.subTreeId) heroCounts.set(node.subTreeId, (heroCounts.get(node.subTreeId) || 0) + 1);
  const heroSubTreeId = [...heroCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const nodes = [];
  for (const { node, rank, index } of byNode.values()) {
    if (node.subTreeId && node.subTreeId !== heroSubTreeId) continue;
    let entryIndex = index;
    if (node.type === 'tiered') {
      let reached = 0;
      entryIndex = node.entries.findIndex((e) => (reached += e.maxRanks || 1) >= rank);
      if (entryIndex < 0) entryIndex = node.entries.length - 1;
    }
    nodes.push({ nodeId: node.id, type: NODE_TYPES.indexOf(node.type), entryIndex, entryId: node.entries[entryIndex]?.id ?? null, rank, granted: false });
  }
  return { heroSubTreeId, nodes };
}

/** Warcraft Logs gear -> the app's item shape per slot (names of enchants and gems filled in later). */
function mapGear(gear) {
  const items = {};
  (gear || []).forEach((g, i) => {
    const slot = WCL_SLOTS[i];
    if (!slot || !g?.id || !g.itemLevel) return;
    items[slot] = {
      id: g.id,
      ilvl: g.itemLevel,
      name: g.name || `Item ${g.id}`,
      icon: String(g.icon || 'inv_misc_questionmark').replace(/\.(jpg|png)$/i, '').toLowerCase(),
      quality: QUALITY[String(g.quality || '').toLowerCase()] ?? 4,
      bonuses: g.bonusIDs || [],
      tier: null,
      enchants: g.enchant ? [{ id: g.enchant, name: null, icon: null }] : [],
      gems: (g.gems || []).map((id) => ({ id, name: null, icon: null })),
    };
  });
  return items;
}

/** "Ula'tek" kill entry of one ranking, in the shape views expect for a key. */
function killEntry(r, boss, rank, tree, byEntry) {
  return {
    run: {
      id: `${r.report}-${r.fight}`,
      url: r.report ? `https://www.warcraftlogs.com/reports/${r.report}#fight=${r.fight ?? 'last'}` : null,
      dungeon: boss.name,
      shortName: boss.name,
      zoneId: boss.id,
      level: null,
      score: r.amount,
      completedAt: r.startTime ? new Date(r.startTime).toISOString() : null,
      version: null,
      duration: r.duration,
      rank,
    },
    fallback: false,
    talents: { specId: tree.specId, ...mapTalents(r.talents, tree, byEntry), loadoutText: null, version: null },
    items: mapGear(r.gear),
    itemLevel: averageItemLevel(r.gear),
  };
}

/**
 * A session for the views from the rankings of every boss: bosses = [{ id, name, rankings }].
 * `links(player)` gives the profile links (collector.linksFor).
 */
function buildRaidSession({ meta, tree, trimmedTree, bosses, links = () => ({}) }) {
  const byEntry = entryLookup(tree);
  const players = new Map();
  for (const boss of bosses) {
    boss.rankings.forEach((r, i) => {
      const region = String(r.region || '').toLowerCase();
      const realmSlug = String(r.server || '')
        .toLowerCase()
        .replace(/'/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '');
      const key = `${region}|${realmSlug}|${String(r.name).toLowerCase()}`;
      if (!players.has(key)) {
        players.set(key, {
          rank: Infinity,
          name: r.name,
          realm: r.server,
          realmSlug,
          region,
          characterId: null,
          score: null,
          scoreColor: null,
          links: links({ name: r.name, region, realmSlug }),
          candidates: [],
          main: null,
          dungeons: {},
        });
      }
      const p = players.get(key);
      const entry = killEntry(r, boss, i + 1, tree, byEntry);
      if (p.dungeons[boss.id]) return; // the same player twice on one boss: keep the better rank
      p.dungeons[boss.id] = entry;
      if (i + 1 < p.rank) {
        p.rank = i + 1;
        p.main = entry;
      }
    });
  }
  const list = [...players.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return {
    version: 1,
    key: null,
    meta: {
      ...meta,
      mode: 'raid',
      dungeons: bosses.map((b) => ({ id: b.id, name: b.name, shortName: b.name })),
      requested: Math.max(0, ...bosses.map((b) => b.rankings.length)),
      sampleSize: list.length,
      skipped: [],
      patch: null,
      since: null,
      generatedAt: new Date().toISOString(),
    },
    tree: trimmedTree,
    players: list,
    dungeonsLoaded: bosses.map((b) => b.id),
    itemInfo: {},
    itemSources: {},
  };
}

/** "+16 Mastery" lines of a gem's tooltip -> "16 Mast & 7 Crit" (the gem label format the stat profile reads). */
function gemLabel(stats) {
  const short = { 'Critical Strike': 'Crit', Haste: 'Haste', Mastery: 'Mast', Versatility: 'Vers' };
  const parts = (stats || []).map((s) => `${s.value} ${short[s.stat] || (/Primary/i.test(s.stat) ? 'Primary' : s.stat)}`);
  return parts.length ? parts.join(' & ') : null;
}

/**
 * Talents picked noticeably differently on one boss than on the other loaded bosses:
 * [{ nodeId, entryId, name, boss, others }] (pick shares, largest difference first).
 */
function bossDifferences(session, tree, bossId, { minDiff = 0.15, max = 6, minPlayers = 10 } = {}) {
  const on = [];
  const off = [];
  for (const p of session.players) {
    for (const [id, d] of Object.entries(p.dungeons || {})) {
      if (!d) continue;
      (Number(id) === Number(bossId) ? on : off).push({ name: p.name, talents: d.talents });
    }
  }
  if (!on.length || !off.length) return [];
  const a = aggregateTalents(tree, on).nodes;
  const b = aggregateTalents(tree, off).nodes;
  const out = [];
  for (const node of [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]) {
    if (node.freeNode) continue;
    const x = a[node.id];
    const y = b[node.id];
    // Hero talents are measured against the players on that hero tree: skip tiny samples.
    if (!x?.total || !y?.total || x.total < minPlayers || y.total < minPlayers) continue;
    if (node.type === 'choice') {
      for (const e of node.entries) {
        const px = (x.entries?.[e.id] || 0) / x.total;
        const py = (y.entries?.[e.id] || 0) / y.total;
        if (Math.abs(px - py) >= minDiff) out.push({ nodeId: node.id, entryId: e.id, name: e.name, icon: e.icon, boss: px, others: py });
      }
    } else if (Math.abs(x.pct - y.pct) >= minDiff) {
      out.push({ nodeId: node.id, entryId: node.entries[0]?.id ?? null, name: node.entries[0]?.name || node.name, icon: node.entries[0]?.icon, boss: x.pct, others: y.pct });
    }
  }
  // A choice node shows up twice (one option gains what the other loses): keep the option that gains.
  const seen = new Set();
  return out
    .sort((p, q) => Math.abs(q.boss - q.others) - Math.abs(p.boss - p.others) || (q.boss > q.others) - (p.boss > p.others))
    .filter((d) => !seen.has(d.nodeId) && seen.add(d.nodeId))
    .slice(0, max);
}

module.exports = { mapTalents, mapGear, buildRaidSession, bossDifferences, gemLabel, entryLookup, WCL_SLOTS, DIFFICULTIES };

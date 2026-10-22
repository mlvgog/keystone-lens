'use strict';

const SLOT_GROUPS = [
  { key: 'head', label: 'Head', slots: ['head'] },
  { key: 'neck', label: 'Neck', slots: ['neck'] },
  { key: 'shoulder', label: 'Shoulder', slots: ['shoulder'] },
  { key: 'back', label: 'Back', slots: ['back'] },
  { key: 'chest', label: 'Chest', slots: ['chest'] },
  { key: 'wrist', label: 'Wrist', slots: ['wrist'] },
  { key: 'hands', label: 'Hands', slots: ['hands'] },
  { key: 'waist', label: 'Waist', slots: ['waist'] },
  { key: 'legs', label: 'Legs', slots: ['legs'] },
  { key: 'feet', label: 'Feet', slots: ['feet'] },
  { key: 'rings', label: 'Rings', slots: ['finger1', 'finger2'] },
  { key: 'trinkets', label: 'Trinkets', slots: ['trinket1', 'trinket2'] },
  { key: 'mainhand', label: 'Main Hand', slots: ['mainhand'] },
  { key: 'offhand', label: 'Off Hand', slots: ['offhand'] },
];

const GEAR_SLOTS = SLOT_GROUPS.flatMap((g) => g.slots);

/** A player's equipped gear items (shirts and tabards excluded). */
function gearItems(player) {
  return GEAR_SLOTS.map((slot) => player.items?.[slot]).filter(Boolean);
}

function inc(obj, key, by = 1) {
  obj[key] = (obj[key] || 0) + by;
}

function allTreeNodes(tree) {
  return [...(tree.classNodes || []), ...(tree.specNodes || []), ...(tree.heroNodes || [])];
}

/** Hero sub-trees of a full talent tree, or the already-derived list of a trimmed tree. */
function heroSubTrees(tree) {
  if (Array.isArray(tree.subTrees)) return tree.subTrees;
  const selector = (tree.subTreeNodes || [])[0];
  return (selector?.entries || [])
    .filter((e) => e.traitSubTreeId != null)
    .map((e) => {
      const entryNode = (tree.heroNodes || []).find((n) => n.subTreeId === e.traitSubTreeId && n.entryNode);
      return {
        id: e.traitSubTreeId,
        name: e.name,
        icon: entryNode?.entries?.[0]?.icon || 'inv_misc_questionmark',
      };
    });
}

/**
 * Per-node pick statistics.
 * players: [{ name, talents: { heroSubTreeId, nodes: [{ nodeId, entryId, rank, granted }] } }]
 * Hero-tree nodes are measured against the players who chose that hero tree.
 */
function aggregateTalents(tree, players) {
  const N = players.length;
  const counts = {};
  const heroCounts = {};

  for (const p of players) {
    const t = p.talents;
    if (t.heroSubTreeId != null) inc(heroCounts, t.heroSubTreeId);
    const seen = new Set();
    for (const n of t.nodes) {
      if (!n.rank || seen.has(n.nodeId)) continue;
      seen.add(n.nodeId);
      const s = (counts[n.nodeId] ||= { picked: 0, granted: 0, ranks: {}, entries: {} });
      s.picked++;
      if (n.granted) s.granted++;
      inc(s.ranks, n.rank);
      if (n.entryId != null) inc(s.entries, n.entryId);
    }
  }

  const heroNodeIds = new Set((tree.heroNodes || []).map((n) => n.id));
  const nodes = {};
  for (const node of allTreeNodes(tree)) {
    const s = counts[node.id] || { picked: 0, granted: 0, ranks: {}, entries: {} };
    const total = heroNodeIds.has(node.id) ? heroCounts[node.subTreeId] || 0 : N;
    let rankSum = 0;
    for (const [r, c] of Object.entries(s.ranks)) rankSum += Number(r) * c;
    nodes[node.id] = {
      picked: s.picked,
      total,
      pct: total ? s.picked / total : 0,
      granted: s.granted,
      ranks: s.ranks,
      avgRank: s.picked ? rankSum / s.picked : 0,
      entries: s.entries,
    };
  }

  const hero = heroSubTrees(tree).map((h) => ({
    ...h,
    count: heroCounts[h.id] || 0,
    pct: N ? (heroCounts[h.id] || 0) / N : 0,
  }));
  hero.sort((a, b) => b.count - a.count);

  return { sampleSize: N, nodes, hero, representative: representativeBuild(tree, players, nodes) };
}

/** The player whose build agrees most with everyone else's (per-node majority agreement). */
function representativeBuild(tree, players, nodeStats) {
  const nodesBySubTree = {};
  for (const n of tree.heroNodes || []) (nodesBySubTree[n.subTreeId] ||= []).push(n);
  const core = [...(tree.classNodes || []), ...(tree.specNodes || [])];

  let best = null;
  players.forEach((p, index) => {
    if (!p.talents?.loadoutText) return;
    const picks = new Map(p.talents.nodes.filter((n) => n.rank > 0).map((n) => [n.nodeId, n]));
    const relevant = [...core, ...(nodesBySubTree[p.talents.heroSubTreeId] || [])];
    let score = 0;
    for (const node of relevant) {
      const s = nodeStats[node.id];
      if (!s || !s.total) continue;
      const pick = picks.get(node.id);
      if (!pick) score += 1 - s.pct;
      else if (node.type === 'choice' && pick.entryId != null) score += (s.entries[pick.entryId] || 0) / s.total;
      else score += s.pct;
    }
    const agreement = relevant.length ? score / relevant.length : 0;
    if (!best || agreement > best.agreement) best = { index, name: p.name, agreement, loadoutText: p.talents.loadoutText };
  });
  return best;
}

/** Strip WoW UI escape sequences: |cffRRGGBB / |cnIQ4: colours, |r, |T..|t textures, |A..|a atlases. */
function stripEscapes(text) {
  return String(text || '')
    .replace(/\|T[^|]*\|t/g, '')
    .replace(/\|A[^|]*\|a/g, '')
    .replace(/\|c(?:n[^:|]*:|[0-9a-fA-F]{8})/g, '')
    .replace(/\|r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Identifies one exact item variant (same item, bonus IDs and item level). */
function variantKeyOf(item) {
  return `${item.id}|${(item.bonuses || []).join(':')}|${item.ilvl}`;
}

function cleanEnchantName(name) {
  return stripEscapes(name).replace(/^Enchant [^-]+ - /, '');
}

/** Key with the highest count; ties go to the key that `preferred(a, b)` ranks higher. */
function mostCommon(obj, preferred = () => false) {
  let bestKey = null;
  let bestCount = -1;
  for (const [k, c] of Object.entries(obj)) {
    if (c > bestCount || (c === bestCount && preferred(k, bestKey))) {
      bestKey = k;
      bestCount = c;
    }
  }
  return bestKey;
}

const higherNumber = (a, b) => Number(a) > Number(b);
const higherIlvlVariant = (a, b) => Number(a.split('|')[1]) > Number(b.split('|')[1]);

/**
 * Per slot group: which items are used and by how many players.
 * Rings and trinkets combine both slots; an item is counted once per player.
 */
function aggregateGear(players) {
  const N = players.length;
  return SLOT_GROUPS.map((group) => {
    const items = new Map();
    let emptySlots = 0;

    for (const p of players) {
      const distinct = new Map();
      for (const slot of group.slots) {
        const it = p.items?.[slot];
        if (!it) {
          emptySlots++;
          continue;
        }
        if (!distinct.has(it.id)) distinct.set(it.id, it);
      }
      for (const it of distinct.values()) {
        let agg = items.get(it.id);
        if (!agg) {
          agg = {
            id: it.id,
            name: it.name,
            icon: it.icon,
            quality: it.quality,
            tier: !!it.tier,
            count: 0,
            ilvls: {},
            variants: {},
            enchants: {},
            gems: {},
            players: [],
          };
          items.set(it.id, agg);
        }
        agg.count++;
        agg.players.push(p.name);
        if (agg.icon === 'inv_misc_questionmark' && it.icon && it.icon !== 'inv_misc_questionmark') agg.icon = it.icon;
        inc(agg.ilvls, it.ilvl);
        const variantKey = `${(it.bonuses || []).join(':')}|${it.ilvl}`;
        inc(agg.variants, variantKey);
        for (const e of it.enchants || []) inc(agg.enchants, cleanEnchantName(e.name));
        for (const gemName of new Set((it.gems || []).map((g) => stripEscapes(g.name)))) inc(agg.gems, gemName);
      }
    }

    const list = [...items.values()]
      .map((agg) => {
        const ilvlKeys = Object.keys(agg.ilvls).map(Number);
        const [bonusStr, ilvlStr] = mostCommon(agg.variants, higherIlvlVariant).split('|');
        return {
          id: agg.id,
          name: agg.name,
          icon: agg.icon,
          quality: agg.quality,
          tier: agg.tier,
          count: agg.count,
          pct: N ? agg.count / N : 0,
          ilvl: { min: Math.min(...ilvlKeys), max: Math.max(...ilvlKeys), common: Number(mostCommon(agg.ilvls, higherNumber)) },
          variant: { bonuses: bonusStr ? bonusStr.split(':').map(Number) : [], ilvl: Number(ilvlStr) },
          enchants: Object.entries(agg.enchants).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
          gems: Object.entries(agg.gems).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
          players: agg.players,
        };
      })
      .sort((a, b) => b.count - a.count || b.ilvl.common - a.ilvl.common);

    return { key: group.key, label: group.label, slots: group.slots.length, items: list, empty: emptySlots };
  });
}

/** How many players wear 4+ / 2-3 / 0-1 tier pieces. */
function tierSetSummary(players) {
  const out = { four: 0, two: 0, none: 0 };
  for (const p of players) {
    const n = gearItems(p).filter((it) => it.tier).length;
    if (n >= 4) out.four++;
    else if (n >= 2) out.two++;
    else out.none++;
  }
  return out;
}

module.exports = {
  SLOT_GROUPS,
  gearItems,
  aggregateTalents,
  aggregateGear,
  tierSetSummary,
  heroSubTrees,
  cleanEnchantName,
  stripEscapes,
  variantKeyOf,
};

'use strict';

/**
 * A small synthetic Mythic+ analysis (the shape collector.analyze returns): 6 players of one
 * spec with a choice node, a multi-rank node and two hero trees, gear with enchants and gems,
 * races (one unknown), consumables at boss pulls (four logged runs), and one of two dungeons loaded.
 */

const tree = {
  classNodes: [
    { id: 1, type: 'single', maxRanks: 1, entries: [{ id: 10, name: 'One' }] },
    { id: 2, type: 'choice', maxRanks: 1, entries: [{ id: 21, name: 'Left' }, { id: 22, name: 'Right' }] },
  ],
  specNodes: [
    { id: 3, type: 'single', maxRanks: 2, entries: [{ id: 30, name: 'Three' }] },
    { id: 6, type: 'single', maxRanks: 1, entries: [{ id: 60, name: 'Rare' }] },
  ],
  heroNodes: [
    { id: 4, type: 'single', subTreeId: 40, entryNode: true, maxRanks: 1, entries: [{ id: 40, icon: 'a' }] },
    { id: 5, type: 'single', subTreeId: 41, entryNode: true, maxRanks: 1, entries: [{ id: 50, icon: 'b' }] },
  ],
  // The node that picks the hero tree; decodeLoadout lists it among every player's talents.
  subTreeNodes: [
    {
      id: 9,
      type: 'subtree',
      maxRanks: 1,
      entries: [
        { id: 90, type: 'subtree', name: 'Alpha', traitSubTreeId: 40 },
        { id: 91, type: 'subtree', name: 'Beta', traitSubTreeId: 41 },
      ],
    },
  ],
  subTrees: [
    { id: 40, name: 'Alpha', icon: 'a' },
    { id: 41, name: 'Beta', icon: 'b' },
  ],
};

const item = (id, ilvl, extra = {}) => ({ id, ilvl, name: `Item ${id}`, icon: 'x', quality: 4, bonuses: [], enchants: [], gems: [], tier: null, ...extra });
const ench = (id, name) => ({ id, name: `Enchant Ring - ${name}`, icon: null });
const gem = (id, name) => ({ id, name, icon: null });

/** Buffs at boss pulls (raiderio.pullBuffs): [[spellId, pulls]] out of `pulls`. */
const buffs = (pulls, auras) => ({ pulls, auras: auras.map(([id, n]) => ({ id, name: `Aura ${id}`, icon: 'x', pulls: n })) });

// What the auras are (consumables.classifyAuras).
const auraInfo = {
  465: null, // Devotion Aura: not a consumable
  1001: { kind: 'flask', name: 'Flask of A', icon: 'inv_flask_a', items: [5001, 5002] },
  1002: { kind: 'flask', name: 'Flask of B', icon: 'inv_flask_b', items: [5003] },
  2001: { kind: 'food', name: 'Haste food', icon: 'spell_misc_food', items: [], stat: 'Haste' },
  2002: { kind: 'food', name: 'Haste food', icon: 'spell_misc_food', items: [], stat: 'Haste' },
  2003: { kind: 'food', name: 'Primary stat food', icon: 'spell_misc_food', items: [], stat: 'Primary stat' },
  3001: { kind: 'rune', name: 'Void-Touched Augment Rune', icon: 'inv_rune', items: [6001] },
};

/** picks: [nodeId, entryId, rank] */
function entry(picks, hero, items, loadoutText, pullBuffs = null) {
  return {
    run: { id: 1, dungeon: 'Somewhere', level: 20, score: 400, completedAt: '2026-10-10T00:00:00Z', version: '12.1.0' },
    fallback: false,
    talents: {
      heroSubTreeId: hero,
      loadoutText,
      nodes: [...picks, [hero === 40 ? 4 : 5, hero === 40 ? 40 : 50, 1], [9, hero === 40 ? 90 : 91, 1]].map(([nodeId, entryId, rank]) => ({ nodeId, entryId, rank, granted: false })),
    },
    items,
    itemLevel: 330,
    buffs: pullBuffs,
  };
}

const buildA = [[1, 10, 1], [2, 21, 1], [3, 30, 2]];
const buildB = [[1, 10, 1], [2, 22, 1], [3, 30, 1], [6, 60, 1]];

function gearA() {
  return {
    head: item(100, 334, { tier: 'set' }),
    finger1: item(400, 330, { enchants: [ench(7001, 'Radiant Crit')], gems: [gem(9001, 'Masterful Ruby'), gem(9002, 'Quick Onyx')] }),
    finger2: item(401, 330, { enchants: [ench(7001, 'Radiant Crit')], gems: [gem(9001, 'Masterful Ruby')] }),
    mainhand: item(200, 334),
  };
}
function gearB() {
  return {
    head: item(101, 330),
    finger1: item(400, 330, { enchants: [ench(7002, 'Radiant Haste')] }),
    finger2: item(402, 326),
    mainhand: item(200, 334),
  };
}

function session() {
  const players = [
    {
      name: 'P1',
      race: 'nightelf',
      main: entry(buildA, 40, gearA(), 'STRA', buffs(4, [[465, 4], [1001, 4], [2001, 4], [3001, 4]])),
      dungeons: { 9: entry(buildB, 41, gearB(), 'STRB', buffs(3, [[1002, 3], [2003, 3]])) },
    },
    {
      name: 'P2',
      race: 'nightelf',
      // Switched flasks after the first boss: counts with Flask of B.
      main: entry(buildA, 40, gearA(), 'STRA', buffs(3, [[1001, 1], [1002, 2], [2002, 3], [3001, 3]])),
      dungeons: { 9: entry(buildB, 41, gearB(), 'STRB') },
    },
    {
      name: 'P3',
      race: 'dwarf',
      main: entry(buildA, 40, gearA(), 'STRA', buffs(2, [[1001, 2], [2003, 2]])),
      dungeons: { 9: entry(buildA, 40, gearA(), 'STRA') },
    },
    { name: 'P4', race: null, main: entry(buildB, 41, gearB(), 'STRB', buffs(4, [[1002, 4], [2001, 4], [3001, 4]])), dungeons: { 9: null } },
    { name: 'P5', race: 'pandaren', main: entry(buildB, 41, gearB(), 'STRB'), dungeons: {} },
    { name: 'P6', race: 'nightelf', main: entry(buildA, 40, gearA(), 'STRA'), dungeons: {} },
  ].map((p, i) => ({ rank: i + 1, realm: 'R', realmSlug: 'r', region: 'eu', score: 3000 - i, links: {}, candidates: [], ...p }));
  return {
    meta: {
      className: 'Mage',
      specName: 'Frost',
      classSlug: 'mage',
      specSlug: 'frost',
      specId: 64,
      classId: 8,
      region: 'world',
      requested: 6,
      since: null,
      patch: '12.1.0',
      season: { slug: 'season-mn-1', name: 'MN Season 1' },
      generatedAt: '2026-10-20T00:00:00.000Z',
      dungeons: [
        { id: 9, name: 'Somewhere', shortName: 'SW', challengeModeId: 501 },
        { id: 10, name: 'Elsewhere', shortName: 'EW', challengeModeId: null },
      ],
    },
    tree,
    players,
    dungeonsLoaded: [9],
    // Secondary stats per item variant ("id|bonuses|ilvl"), for the stat profile.
    itemInfo: {
      '100||334': { stats: { crit: 400, haste: 200, mastery: 0, vers: 0 } },
      '101||330': { stats: { crit: 300, haste: 0, mastery: 300, vers: 0 } },
      '400||330': { stats: { crit: 0, haste: 500, mastery: 0, vers: 0 } },
      '401||330': { stats: { crit: 0, haste: 0, mastery: 500, vers: 0 } },
      '402||326': { stats: { crit: 0, haste: 0, mastery: 0, vers: 400 } },
      '200||334': { stats: { crit: 600, haste: 600, mastery: 0, vers: 0 } },
    },
    itemSources: {},
    auraInfo: { ...auraInfo },
  };
}

module.exports = { session, tree, auraInfo };

'use strict';

/**
 * A small synthetic Mythic+ analysis (the shape collector.analyze returns): 6 players of one
 * spec with a choice node, a multi-rank node and two hero trees, gear with enchants and gems,
 * and one of two dungeons loaded.
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
  subTrees: [
    { id: 40, name: 'Alpha', icon: 'a' },
    { id: 41, name: 'Beta', icon: 'b' },
  ],
};

const item = (id, ilvl, extra = {}) => ({ id, ilvl, name: `Item ${id}`, icon: 'x', quality: 4, bonuses: [], enchants: [], gems: [], tier: null, ...extra });
const ench = (id, name) => ({ id, name: `Enchant Ring - ${name}`, icon: null });
const gem = (id, name) => ({ id, name, icon: null });

/** picks: [nodeId, entryId, rank] */
function entry(picks, hero, items, loadoutText) {
  return {
    run: { id: 1, dungeon: 'Somewhere', level: 20, score: 400, completedAt: '2026-10-10T00:00:00Z', version: '12.1.0' },
    fallback: false,
    talents: {
      heroSubTreeId: hero,
      loadoutText,
      nodes: [...picks, [hero === 40 ? 4 : 5, hero === 40 ? 40 : 50, 1]].map(([nodeId, entryId, rank]) => ({ nodeId, entryId, rank, granted: false })),
    },
    items,
    itemLevel: 330,
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
    { name: 'P1', main: entry(buildA, 40, gearA(), 'STRA'), dungeons: { 9: entry(buildB, 41, gearB(), 'STRB') } },
    { name: 'P2', main: entry(buildA, 40, gearA(), 'STRA'), dungeons: { 9: entry(buildB, 41, gearB(), 'STRB') } },
    { name: 'P3', main: entry(buildA, 40, gearA(), 'STRA'), dungeons: { 9: entry(buildA, 40, gearA(), 'STRA') } },
    { name: 'P4', main: entry(buildB, 41, gearB(), 'STRB'), dungeons: { 9: null } },
    { name: 'P5', main: entry(buildB, 41, gearB(), 'STRB'), dungeons: {} },
    { name: 'P6', main: entry(buildA, 40, gearA(), 'STRA'), dungeons: {} },
  ].map((p, i) => ({ rank: i + 1, realm: 'R', realmSlug: 'r', region: 'eu', score: 3000 - i, links: {}, candidates: [], ...p }));
  return {
    meta: {
      className: 'Mage',
      specName: 'Frost',
      classSlug: 'mage',
      specSlug: 'frost',
      specId: 64,
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
    itemInfo: {},
    itemSources: {},
  };
}

module.exports = { session, tree };

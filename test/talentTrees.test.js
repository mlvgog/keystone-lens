'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, parseSimcTraits, parseSimcSubTrees, buildTrees, iconName } = require('../src/main/sources/talentTrees');

test('CSV with quoted commas, quotes and newlines', () => {
  const csv = 'ID,Name_lang,Description_lang\r\n1,Arcane,"Manipulates raw ""Arcane"" magic,\nwith power."\n2,Fire,Plain\n';
  assert.deepEqual(parseCsv(csv), [
    { ID: '1', Name_lang: 'Arcane', Description_lang: 'Manipulates raw "Arcane" magic,\nwith power.' },
    { ID: '2', Name_lang: 'Fire', Description_lang: 'Plain' },
  ]);
});

test('SimulationCraft trait rows and hero tree names', () => {
  const inc =
    '// Player trait definitions, wow build 12.1.5.70448\n' +
    'static constexpr std::array<trait_data_t, 2> __trait_data_data { {\n' +
    '  { 1,  4, 112521,  90636, 1,  0, 117526,  378436,      0,      0,  3,  2, 100,                        "Master Poisoner", {    0,    0,    0,    0 }, {    0,    0,    0,    0 },   0, 0 },\n' +
    '  { 3,  4, 117703,  95106, 1,  1, 122715,  457022,      0,  12345,  4,  1, 100, "Ethereal \\"Cloak\\"", {  259,  261,    0,    0 }, {  261,    0,    0,    0 },  53, 2 },\n' +
    '} };\n' +
    'static constexpr std::array<std::tuple<unsigned, const char*, unsigned>, 1> __trait_sub_tree_data { {\n' +
    '  { 53, "Deathstalker", 4 },\n' +
    '} };\n';
  const rows = parseSimcTraits(inc);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], {
    tree: 3,
    classId: 4,
    entryId: 117703,
    nodeId: 95106,
    maxRanks: 1,
    reqPoints: 1,
    definitionId: 122715,
    spellId: 457022,
    visibleSpellId: 12345,
    row: 4,
    col: 1,
    index: 100,
    name: 'Ethereal "Cloak"',
    specs: [259, 261],
    starterSpecs: [261],
    subTreeId: 53,
    nodeType: 2,
  });
  assert.deepEqual([...parseSimcSubTrees(inc)], [[53, 'Deathstalker']]);
});

test('icon names as the icon servers spell them', () => {
  assert.equal(iconName('Ability_Rogue_ShadowDance.blp'), 'ability_rogue_shadowdance');
  assert.equal(iconName('Interface\\ICONS\\Spell_Priest_Void Flay.blp'), 'spell_priest_void-flay');
  assert.equal(iconName('INV12_ApexTalent_DemonHunter_ UntetheredRage.blp'), 'inv12_apextalent_demonhunter_untetheredrage');
});

function trait(over) {
  return {
    tree: 1, classId: 4, entryId: 0, nodeId: 0, maxRanks: 1, reqPoints: 0, definitionId: 0, spellId: 1, visibleSpellId: 0,
    row: 1, col: 1, index: 100, name: 'X', specs: [], starterSpecs: [], subTreeId: 0, nodeType: 0, ...over,
  };
}

test('trees per spec: alternatives at one position, hero variants, free nodes, choice and apex nodes', () => {
  const traits = [
    // Class tree: node 2 and its later alternative 5 share a position; the older one is shown.
    trait({ nodeId: 1, entryId: 101, name: 'Root', spellId: 11 }),
    trait({ nodeId: 2, entryId: 102, name: 'Old', spellId: 12 }),
    trait({ nodeId: 5, entryId: 105, name: 'New', spellId: 15, specs: [259] }),
    trait({ nodeId: 6, entryId: 106, name: 'Placeholder', spellId: 0 }),
    // Spec trees.
    trait({ tree: 2, nodeId: 20, entryId: 120, name: 'Starter', spellId: 20, specs: [259], starterSpecs: [259], reqPoints: 0 }),
    trait({ tree: 2, nodeId: 21, entryId: 121, name: 'Apex', spellId: 21, specs: [259], nodeType: 1, maxRanks: 1, reqPoints: 20 }),
    trait({ tree: 2, nodeId: 21, entryId: 122, name: 'Apex', spellId: 22, specs: [259], nodeType: 1, maxRanks: 3, index: 200, reqPoints: 20 }),
    trait({ tree: 2, nodeId: 22, entryId: 124, name: 'Right', spellId: 24, specs: [259], nodeType: 2, index: 200 }),
    trait({ tree: 2, nodeId: 22, entryId: 123, name: 'Left', spellId: 23, specs: [259], nodeType: 2, index: 100 }),
    trait({ tree: 2, nodeId: 30, entryId: 130, name: 'Other spec', spellId: 30, specs: [261] }),
    // Hero tree 53: node 40 for 259 and node 41 (newer id) for 261 at one position; 42 lists only 259.
    trait({ tree: 3, nodeId: 40, entryId: 140, name: 'Mass Disintegrate', spellId: 40, specs: [259], subTreeId: 53 }),
    trait({ tree: 3, nodeId: 41, entryId: 141, name: 'Mass Eruption', spellId: 41, specs: [261], subTreeId: 53 }),
    trait({ tree: 3, nodeId: 42, entryId: 142, name: 'Shared', spellId: 42, specs: [259], subTreeId: 53 }),
    trait({ tree: 4, nodeId: 50, entryId: 150, name: '0', spellId: 0, specs: [259, 261], subTreeId: 53, nodeType: 3 }),
  ];
  const nodes = new Map([
    [1, { posX: 600, posY: 600, treeId: 852 }],
    [2, { posX: 1197, posY: 1203, treeId: 852 }],
    [5, { posX: 1200, posY: 1200, treeId: 852 }],
    [6, { posX: 3000, posY: 3000, treeId: 852 }],
    [20, { posX: 9000, posY: 600, treeId: 852 }],
    [21, { posX: 9000, posY: 1200, treeId: 852 }],
    [22, { posX: 9600, posY: 1200, treeId: 852 }],
    [30, { posX: 9000, posY: 600, treeId: 852 }],
    [40, { posX: 7200, posY: 600, treeId: 852 }],
    [41, { posX: 7200, posY: 600, treeId: 852 }],
    [42, { posX: 7200, posY: 1200, treeId: 852 }],
    [50, { posX: 7200, posY: 0, treeId: 852 }],
    [3, { posX: 0, posY: 0, treeId: 852 }], // in the class's game tree, not used by these specs
    [900, { posX: 0, posY: 0, treeId: 999 }], // another class
  ]);
  const edges = [
    { from: 1, to: 2 },
    { from: 1, to: 5 },
    { from: 20, to: 21 },
    { from: 20, to: 22 },
    { from: 40, to: 42 },
    { from: 41, to: 42 },
  ];
  const trees = buildTrees({
    traits,
    nodes,
    edges,
    entryTypes: new Map([[101, 1], [123, 1]]),
    definitions: new Map(),
    spells: new Map([[11, { iconFileId: 900 }]]),
    icons: new Map([[900, 'ability_root']]),
    specs: [
      { id: 259, name: 'Assassination', classId: 4 },
      { id: 261, name: 'Subtlety', classId: 4 },
      { id: 999, name: 'No spec tree', classId: 4 },
    ],
    classes: new Map([[4, 'Rogue']]),
    subTreeNames: new Map([[53, 'Deathstalker']]),
    grantedNodes: new Set([1]),
  });
  assert.deepEqual(trees.map((t) => t.specName), ['Assassination', 'Subtlety']);
  const [assa, sub] = trees;
  assert.equal(assa.className, 'Rogue');
  // The game tree and all its nodes in id order (what talent export strings follow).
  assert.equal(assa.traitTreeId, 852);
  assert.deepEqual(assa.fullNodeOrder, [1, 2, 3, 5, 6, 20, 21, 22, 30, 40, 41, 42, 50]);

  // Class tree: oldest alternative, placeholder dropped, positions rounded to 10, edges, free node.
  assert.deepEqual(assa.classNodes.map((n) => n.id), [1, 2]);
  const root = assa.classNodes[0];
  assert.deepEqual([root.entryNode, root.freeNode, root.next, root.entries[0].icon, root.entries[0].type], [true, true, [2], 'ability_root', 'active']);
  assert.deepEqual([assa.classNodes[1].posX, assa.classNodes[1].posY, assa.classNodes[1].entries[0].icon], [1200, 1200, 'inv_misc_questionmark']);

  // Spec tree: starter node free, apex node ranks add up, choice entries in order.
  const spec = Object.fromEntries(assa.specNodes.map((n) => [n.id, n]));
  assert.equal(spec[20].freeNode, true);
  assert.deepEqual([spec[21].type, spec[21].maxRanks, spec[21].reqPoints, spec[21].entries.map((e) => e.type)], ['tiered', 4, 20, ['tierrank', 'tierrank']]);
  assert.deepEqual([spec[22].type, spec[22].name, spec[22].entries.map((e) => e.type)], ['choice', 'Left / Right', ['active', 'passive']]);
  assert.equal(spec[30], undefined);

  // Hero tree: each spec gets its own variant; nodes listing only another spec still belong to the tree.
  assert.deepEqual(assa.heroNodes.map((n) => n.id).sort(), [40, 42]);
  assert.deepEqual(sub.heroNodes.map((n) => n.id).sort(), [41, 42]);
  const subRoot = sub.heroNodes.find((n) => n.id === 41);
  assert.deepEqual([subRoot.entryNode, subRoot.freeNode, subRoot.subTreeId, subRoot.reqPoints], [true, true, 53, undefined]);
  assert.equal(sub.heroNodes.find((n) => n.id === 42).freeNode, undefined);
  assert.deepEqual(sub.subTreeNodes[0].entries, [{ id: 150, type: 'subtree', name: 'Deathstalker', traitSubTreeId: 53, index: 100 }]);
});

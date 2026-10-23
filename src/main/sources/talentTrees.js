'use strict';

const { fetchText } = require('../http');
const cache = require('../cache');

/**
 * Talent tree layouts for every spec, built from open community data:
 * - SimulationCraft's generated trait data (GPL-3.0, read at runtime, not bundled): which nodes
 *   each spec has, choice/apex nodes, gates, free nodes, hero trees and talent names;
 * - wago.tools game-table exports: node positions, the lines between nodes, and icons.
 * The result has the shape the app used before (classNodes / specNodes / heroNodes per spec).
 */

const SIMC_TRAITS_URL = 'https://raw.githubusercontent.com/simulationcraft/simc/HEAD/engine/dbc/generated/trait_data.inc';
const WAGO = 'https://wago.tools';
const BATCH = 300; // ids per filtered wago.tools request (keeps URLs short)

const TREE = { class: 1, spec: 2, hero: 3, heroChoice: 4 };
const NODE_TYPES = ['single', 'tiered', 'choice', 'subtree'];
const COND_GRANTED = 2; // TraitCond.CondType

/** RFC 4180 CSV (quoted fields may contain commas, quotes and newlines) -> array of row objects. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return (data || []).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** SimulationCraft's `__trait_data_data` table: one row per node entry. */
function parseSimcTraits(text) {
  const start = text.indexOf('__trait_data_data');
  if (start < 0) throw new Error('Unexpected SimulationCraft trait data format');
  const body = text.slice(start, text.indexOf('} };', start));
  const row =
    /\{\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(-?\d+),\s*(-?\d+),\s*(\d+),\s*"((?:[^"\\]|\\.)*)",\s*\{([^}]*)\},\s*\{([^}]*)\},\s*(\d+),\s*(\d+)\s*\}/g;
  const ids = (list) => list.split(',').map(Number).filter(Boolean);
  const out = [];
  for (const m of body.matchAll(row)) {
    out.push({
      tree: +m[1],
      classId: +m[2],
      entryId: +m[3],
      nodeId: +m[4],
      maxRanks: +m[5],
      reqPoints: +m[6],
      definitionId: +m[7],
      spellId: +m[8],
      visibleSpellId: +m[10],
      row: +m[11],
      col: +m[12],
      index: +m[13],
      name: m[14].replace(/\\(.)/g, '$1'),
      specs: ids(m[15]),
      starterSpecs: ids(m[16]),
      subTreeId: +m[17],
      nodeType: +m[18],
    });
  }
  if (!out.length) throw new Error('No talents found in SimulationCraft trait data');
  return out;
}

/** Hero tree names from SimulationCraft's `__trait_sub_tree_data`: Map id -> name. */
function parseSimcSubTrees(text) {
  const start = text.indexOf('__trait_sub_tree_data');
  const names = new Map();
  if (start < 0) return names;
  for (const m of text.slice(start, text.indexOf('} };', start)).matchAll(/\{\s*(\d+),\s*"((?:[^"\\]|\\.)*)",\s*(\d+)\s*\}/g)) {
    names.set(+m[1], m[2].replace(/\\(.)/g, '$1'));
  }
  return names;
}

/** "Interface\ICONS\" + "Spell_Priest_Void Flay.blp" -> "spell_priest_void-flay" (icon names as the icon CDNs use them). */
function iconName(fileName) {
  return String(fileName || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.blp$/i, '')
    .trim()
    .replace(/\s*_\s*/g, '_')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

/**
 * The traits of one spec. Hero trees come from the spec's hero choice node (the per-node spec
 * lists can be incomplete). Some positions hold alternative versions of a node, of which the
 * game shows one per spec: in hero trees the version made for the spec, otherwise the oldest
 * (lowest id), as players' saved builds confirm.
 */
function traitsOfSpec(traits, spec, nodes) {
  const ofClass = traits.filter((t) => t.classId === spec.classId && (t.spellId || t.tree === TREE.heroChoice));
  const heroChoice = ofClass.filter((t) => t.tree === TREE.heroChoice && t.specs.includes(spec.id));
  const heroTrees = new Set(heroChoice.map((t) => t.subTreeId));
  const mine = ofClass.filter((t) => {
    if (t.tree === TREE.class) return !t.specs.length || t.specs.includes(spec.id);
    if (t.tree === TREE.spec) return t.specs.includes(spec.id);
    if (t.tree === TREE.hero) return heroTrees.has(t.subTreeId);
    return t.tree === TREE.heroChoice && t.specs.includes(spec.id);
  });
  const rank = (t) => [t.tree === TREE.hero && !t.specs.includes(spec.id) ? 1 : 0, t.nodeId];
  const better = (a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1];
  };
  const atPosition = new Map();
  for (const t of mine) {
    const p = nodes.get(t.nodeId);
    if (!p) continue;
    const key = `${t.tree === TREE.hero ? t.subTreeId : 0}|${snap(p.posX)}|${snap(p.posY)}`;
    if (!atPosition.has(key) || better(t, atPosition.get(key)) < 0) atPosition.set(key, t);
  }
  const shown = new Set([...atPosition.values()].map((t) => t.nodeId));
  return mine.filter((t) => !nodes.get(t.nodeId) || shown.has(t.nodeId));
}

/** Node positions rounded to 10 units (the editor leaves them a few units off the grid). */
function snap(v) {
  return Math.round(v / 10) * 10;
}

/**
 * Every node of each game talent tree in ascending id order: the order in which an in-game talent
 * export string lists the nodes (see loadout.js).
 */
function nodeOrderByTree(nodes) {
  const byTree = new Map();
  for (const [id, n] of nodes) {
    if (!n.treeId) continue;
    if (!byTree.has(n.treeId)) byTree.set(n.treeId, []);
    byTree.get(n.treeId).push(id);
  }
  for (const list of byTree.values()) list.sort((a, b) => a - b);
  return byTree;
}

/**
 * Per-spec trees in the app's format.
 * `nodes`: Map nodeId -> { posX, posY, treeId }; `edges`: [{ from, to }];
 * `entryTypes`: Map entryId -> NodeEntryType (1 = square/active, 2 = circle/passive);
 * `definitions`: Map definitionId -> { overrideIcon, overrideName };
 * `spells`: Map spellId -> { iconFileId }; `icons`: Map fileId -> icon name;
 * `specs`: [{ id, name, classId }]; `classes`: Map classId -> name; `subTreeNames`: Map id -> name;
 * `grantedNodes`: Set of class/spec node ids that every spec gets for free (e.g. at level 10).
 */
function buildTrees({ traits, nodes, edges, entryTypes, definitions, spells, icons, specs, classes, subTreeNames, grantedNodes = new Set() }) {
  const iconOf = (t) => {
    const def = definitions.get(t.definitionId);
    const file = def?.overrideIcon || spells.get(t.visibleSpellId)?.iconFileId || spells.get(t.spellId)?.iconFileId;
    return icons.get(file) || 'inv_misc_questionmark';
  };
  const entryOf = (t, nodeType) => ({
    id: t.entryId,
    definitionId: t.definitionId,
    maxRanks: t.maxRanks,
    type: nodeType === 'tiered' ? 'tierrank' : entryTypes.get(t.entryId) === 1 ? 'active' : 'passive',
    name: definitions.get(t.definitionId)?.overrideName || t.name,
    spellId: t.spellId,
    visibleSpellId: t.visibleSpellId || undefined,
    icon: iconOf(t),
    index: t.index,
  });

  const order = nodeOrderByTree(nodes);
  const out = [];
  for (const spec of specs) {
    const mine = traitsOfSpec(traits, spec, nodes);
    if (!mine.some((t) => t.tree === TREE.spec)) continue;
    // The class's game tree: the one its class and spec nodes belong to.
    const treeCounts = new Map();
    for (const t of mine) {
      const treeId = t.tree <= TREE.spec ? nodes.get(t.nodeId)?.treeId : null;
      if (treeId) treeCounts.set(treeId, (treeCounts.get(treeId) || 0) + 1);
    }
    const traitTreeId = [...treeCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const byNode = new Map();
    for (const t of mine) {
      if (!byNode.has(t.nodeId)) byNode.set(t.nodeId, []);
      byNode.get(t.nodeId).push(t);
    }
    const ids = new Set(byNode.keys());
    const next = new Map([...ids].map((id) => [id, []]));
    const prev = new Map([...ids].map((id) => [id, []]));
    for (const e of edges) {
      if (!ids.has(e.from) || !ids.has(e.to) || next.get(e.from).includes(e.to)) continue;
      next.get(e.from).push(e.to);
      prev.get(e.to).push(e.from);
    }

    const groups = { classNodes: [], specNodes: [], heroNodes: [], subTreeNodes: [] };
    for (const [id, list] of byNode) {
      list.sort((a, b) => a.index - b.index);
      const first = list[0];
      const pos = nodes.get(id) || { posX: first.col * 600, posY: first.row * 600 };
      const type = NODE_TYPES[first.nodeType] || 'single';
      const node = {
        id,
        name: '',
        type,
        posX: snap(pos.posX),
        posY: snap(pos.posY),
        // Apex (tiered) nodes are bought rank by rank across their entries.
        maxRanks: type === 'tiered' ? list.reduce((s, t) => s + t.maxRanks, 0) : Math.max(...list.map((t) => t.maxRanks)),
        entryNode: !prev.get(id).length,
        next: next.get(id),
        prev: prev.get(id),
        entries: [],
      };
      if (first.tree === TREE.heroChoice) {
        node.entries = list.map((t) => ({ id: t.entryId, type: 'subtree', name: subTreeNames.get(t.subTreeId) || '', traitSubTreeId: t.subTreeId, index: t.index }));
        node.name = node.entries.map((e) => e.name).join(' / ');
        groups.subTreeNodes.push(node);
        continue;
      }
      node.entries = list.map((t) => entryOf(t, type));
      node.name = [...new Set(node.entries.map((e) => e.name))].join(' / ');
      if (first.reqPoints && first.tree !== TREE.hero) node.reqPoints = first.reqPoints;
      // The first node of each hero tree comes with choosing the hero tree.
      const free = first.tree === TREE.hero ? node.entryNode : grantedNodes.has(id) || list.some((t) => t.starterSpecs.includes(spec.id));
      if (free) node.freeNode = true;
      if (first.tree === TREE.hero) {
        node.subTreeId = first.subTreeId;
        groups.heroNodes.push(node);
      } else (first.tree === TREE.class ? groups.classNodes : groups.specNodes).push(node);
    }
    out.push({
      className: classes.get(spec.classId) || '',
      classId: spec.classId,
      specName: spec.name,
      specId: spec.id,
      traitTreeId,
      fullNodeOrder: order.get(traitTreeId) || [],
      ...groups,
    });
  }
  return out;
}

async function getCsv(path, { signal } = {}) {
  return parseCsv(await fetchText(`${WAGO}/db2/${path}`, { signal }));
}

/** Rows of a wago.tools table whose `column` is one of `ids`, in batches. */
async function getRowsById(table, column, ids, { signal } = {}) {
  const list = [...new Set(ids)].filter(Boolean);
  const batches = [];
  for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
  const pages = await Promise.all(
    batches.map((b) => getCsv(`${table}/csv?filter%5B${column}%5D=${encodeURIComponent(b.join('|'))}`, { signal }))
  );
  return pages.flat();
}

/** Current retail game build according to wago.tools, e.g. "12.1.5.70448". */
async function currentBuild({ signal } = {}) {
  const d = JSON.parse(await fetchText(`${WAGO}/api/builds/wow/latest`, { signal }));
  return d?.version || null;
}

/** Icon names of interface files; a few new icons are only known to the file index. */
async function iconNames(fileIds, { signal } = {}) {
  const icons = new Map((await getRowsById('ManifestInterfaceData', 'ID', fileIds, { signal })).map((r) => [+r.ID, iconName(r.FileName)]));
  const missing = [...new Set(fileIds)].filter((id) => id && !icons.has(id));
  await Promise.all(
    missing.map(async (id) => {
      try {
        const info = JSON.parse(await fetchText(`${WAGO}/api/info/${id}`, { signal }));
        if (info?.filename) icons.set(id, iconName(info.filename));
      } catch (err) {
        if (err.name === 'AbortError') throw err; // otherwise the node shows a question mark
      }
    })
  );
  return icons;
}

async function download({ signal } = {}) {
  const simc = await fetchText(SIMC_TRAITS_URL, { signal });
  const traits = parseSimcTraits(simc);
  const [nodeRows, edgeRows, entryRows, specRows, classRows] = await Promise.all(
    ['TraitNode/csv', 'TraitEdge/csv', 'TraitNodeEntry/csv', 'ChrSpecialization/csv', 'ChrClasses/csv'].map((p) => getCsv(p, { signal }))
  );
  const [defRows, miscRows] = await Promise.all([
    getRowsById('TraitDefinition', 'ID', traits.map((t) => t.definitionId), { signal }),
    getRowsById('SpellMisc', 'SpellID', traits.flatMap((t) => [t.spellId, t.visibleSpellId]), { signal }),
  ]);
  const definitions = new Map(defRows.map((r) => [+r.ID, { overrideIcon: +r.OverrideIcon || 0, overrideName: r.OverrideName_lang || '' }]));
  const spells = new Map(miscRows.map((r) => [+r.SpellID, { iconFileId: +r.SpellIconFileDataID || 0 }]));
  const icons = await iconNames(
    [...definitions.values()].map((d) => d.overrideIcon).concat([...spells.values()].map((s) => s.iconFileId)),
    { signal }
  );
  // Class/spec nodes granted to every spec (SimulationCraft only lists per-spec starter nodes).
  const nodeConds = await getRowsById('TraitNodeXTraitCond', 'TraitNodeID', traits.filter((t) => t.tree <= TREE.spec).map((t) => t.nodeId), { signal });
  const condRows = await getRowsById('TraitCond', 'ID', nodeConds.map((r) => +r.TraitCondID), { signal });
  const grantedToAll = new Set(condRows.filter((c) => +c.CondType === COND_GRANTED && !+c.SpecSetID).map((c) => +c.ID));
  const grantedNodes = new Set(nodeConds.filter((r) => grantedToAll.has(+r.TraitCondID)).map((r) => +r.TraitNodeID));

  const classIds = new Set(traits.map((t) => t.classId));
  return buildTrees({
    traits,
    nodes: new Map(nodeRows.map((r) => [+r.ID, { posX: +r.PosX, posY: +r.PosY, treeId: +r.TraitTreeID }])),
    edges: edgeRows.map((r) => ({ from: +r.LeftTraitNodeID, to: +r.RightTraitNodeID })),
    entryTypes: new Map(entryRows.map((r) => [+r.ID, +r.NodeEntryType])),
    definitions,
    spells,
    icons,
    specs: specRows
      .filter((r) => classIds.has(+r.ClassID))
      .map((r) => ({ id: +r.ID, name: r.Name_lang, classId: +r.ClassID }))
      .sort((a, b) => a.classId - b.classId || a.id - b.id),
    classes: new Map(classRows.map((r) => [+r.ID, r.Name_lang])),
    subTreeNames: parseSimcSubTrees(simc),
    grantedNodes,
  });
}

const CACHE_KEY = 'trees-v3'; // v2: traitTreeId + fullNodeOrder; v3: apex node names once
let inMemory = null;

/**
 * Talent tree layout of every spec (positions, connections, icons). Rebuilt when the game build
 * changes (checked daily); otherwise the saved trees are reused.
 */
async function getTalentData({ signal, force } = {}) {
  if (inMemory && !force) return inMemory;
  const saved = await cache.read('talents', CACHE_KEY, { ignoreTtl: true, withTime: true });
  const fresh = saved && Date.now() - saved.at < cache.TTL.talents;
  if (saved?.value?.trees && fresh && !force) return (inMemory = saved.value.trees);

  let build = null;
  try {
    build = await currentBuild({ signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    if (saved?.value?.trees && !force) return (inMemory = saved.value.trees); // offline: keep the old trees
  }
  if (saved?.value?.trees && build && saved.value.build === build && !force) {
    await cache.write('talents', CACHE_KEY, saved.value); // same game build: still current
    return (inMemory = saved.value.trees);
  }
  const trees = await download({ signal });
  await cache.write('talents', CACHE_KEY, { build, trees });
  return (inMemory = trees);
}

module.exports = { getTalentData, parseCsv, parseSimcTraits, parseSimcSubTrees, buildTrees, iconName };

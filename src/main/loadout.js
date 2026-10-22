'use strict';

/**
 * In-game talent export strings (Import/Export loadout, SimulationCraft's `talents=`).
 *
 * Blizzard's format (Blizzard_ClassTalentImportExport): base64 digits, read lowest bit first.
 * Header: version (8 bits), spec id (16), tree hash (128). Then, for every node of the class's
 * talent tree in ascending id order: selected (1); if selected, purchased (1) (selected but not
 * purchased = granted for free); if purchased, partially ranked (1) [+ ranks (6)] and choice
 * node (1) [+ entry index (2)].
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VERSION = 2;
const NODE_TYPES = ['single', 'tiered', 'choice', 'subtree'];

function loadoutError(message) {
  const err = new Error(message);
  err.code = 'BAD_LOADOUT';
  return err;
}

function bitReader(text) {
  const digits = [...String(text || '').trim()].map((c) => {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw loadoutError('This is not a talent string.');
    return v;
  });
  let pos = 0;
  return (bits) => {
    let value = 0;
    for (let i = 0; i < bits; i++, pos++) {
      const digit = digits[Math.floor(pos / 6)];
      if (digit === undefined) throw loadoutError('The talent string is cut off.');
      value |= ((digit >> pos % 6) & 1) << i;
    }
    return value;
  };
}

function readHeader(text) {
  const take = bitReader(text);
  const version = take(8);
  const specId = take(16);
  for (let i = 0; i < 16; i++) take(8); // tree hash
  return { take, version, specId };
}

/** The spec a talent string is for. */
function loadoutSpecId(text) {
  return readHeader(text).specId;
}

/**
 * Talent picks of a string for one spec's tree (talentTrees format, with `fullNodeOrder`):
 * { specId, heroSubTreeId, nodes: [{ nodeId, type, entryIndex, entryId, rank, granted }] },
 * the shape raider.io's loadouts have in this app. Only nodes of the spec's own tree and the
 * chosen hero tree are kept: strings also mark other specs' versions of hero talents and the
 * other hero tree's first node.
 */
function decodeLoadout(text, tree) {
  const { take, version, specId } = readHeader(text);
  if (version !== VERSION) throw loadoutError(`Talent strings of version ${version} are not supported.`);
  if (specId !== tree.specId) throw loadoutError(`The talent string is for another spec (${specId}).`);
  if (!tree.fullNodeOrder?.length) throw loadoutError('Talent tree data is missing.');

  const picks = new Map();
  for (const nodeId of tree.fullNodeOrder) {
    if (!take(1)) continue;
    const pick = { granted: true, rank: null, choice: 0 };
    if (take(1)) {
      pick.granted = false;
      if (take(1)) pick.rank = take(6);
      if (take(1)) pick.choice = take(2);
    }
    picks.set(nodeId, pick);
  }

  const byId = new Map();
  for (const key of ['classNodes', 'specNodes', 'heroNodes', 'subTreeNodes']) for (const n of tree[key] || []) byId.set(n.id, n);
  const selector = tree.subTreeNodes?.[0];
  const chosen = selector && picks.get(selector.id);
  const heroSubTreeId = chosen ? selector.entries[chosen.choice]?.traitSubTreeId ?? null : null;

  const nodes = [];
  for (const [nodeId, pick] of picks) {
    const node = byId.get(nodeId);
    if (!node) continue;
    if (node.subTreeId != null && node.subTreeId !== heroSubTreeId) continue;
    let entryIndex = pick.choice;
    let rank = pick.rank ?? (node.type === 'choice' ? node.entries[pick.choice]?.maxRanks : node.maxRanks) ?? 1;
    if (node.type === 'tiered') {
      // Apex talents: the entry is the tier the rank has reached (tiers of e.g. 1 + 2 + 1 ranks).
      let reached = 0;
      entryIndex = node.entries.findIndex((e) => (reached += e.maxRanks || 1) >= rank);
      if (entryIndex < 0) entryIndex = node.entries.length - 1;
    }
    const entry = node.entries[entryIndex] || node.entries[0];
    nodes.push({
      nodeId,
      type: NODE_TYPES.indexOf(node.type),
      entryIndex,
      entryId: entry?.id ?? null,
      rank,
      granted: pick.granted,
    });
  }
  return { specId, heroSubTreeId, nodes };
}

module.exports = { decodeLoadout, loadoutSpecId, ALPHABET };

'use strict';

const { fetchJson } = require('../http');
const cache = require('../cache');

const TALENTS_URL = 'https://www.raidbots.com/static/data/live/talents.json';

let inMemory = null;

/** Full talent tree layout for every spec (positions, connections, icons). */
async function getTalentData({ signal, force } = {}) {
  if (inMemory && !force) return inMemory;
  inMemory = await cache.cached('talents', TALENTS_URL, () => fetchJson(TALENTS_URL, { signal }), { force });
  return inMemory;
}

async function getSpecTree(specId, opts) {
  const all = await getTalentData(opts);
  const tree = all.find((t) => t.specId === specId);
  if (!tree) throw new Error(`No talent tree found for spec ${specId}`);
  return tree;
}

module.exports = { getTalentData, getSpecTree };

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Compact snapshots of past analyses (pick rates only), used to show how talent and
 * item popularity changes over time.
 */

const MAX_SNAPSHOTS = 40;
let dir = null;

function init(baseDir) {
  dir = path.join(baseDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
}

/** One history per spec + region + sample size + "since" setting. */
function keyFor(meta) {
  return JSON.stringify({ c: meta.classSlug, s: meta.specSlug, r: meta.region, n: meta.requested, since: meta.since || null });
}

function fileFor(key) {
  return path.join(dir, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);
}

const round = (x) => Math.round(x * 1000) / 1000;

/** Pick rates of an unfiltered view. */
function snapshotOf(view, meta) {
  const nodes = {};
  const entries = {};
  for (const [id, s] of Object.entries(view.talents.nodes)) {
    nodes[id] = round(s.pct);
    for (const [entryId, count] of Object.entries(s.entries || {})) entries[entryId] = round(s.total ? count / s.total : 0);
  }
  const items = {};
  for (const g of view.gear) items[g.key] = Object.fromEntries(g.items.map((it) => [it.id, round(it.pct)]));
  return {
    id: meta.generatedAt,
    generatedAt: meta.generatedAt,
    patch: meta.patch,
    sampleSize: view.sampleSize,
    nodes,
    entries,
    hero: Object.fromEntries(view.hero.map((h) => [h.id, round(h.pct)])),
    items,
  };
}

async function readAll(key) {
  if (!dir) return [];
  try {
    return JSON.parse(await fs.promises.readFile(fileFor(key), 'utf8'));
  } catch {
    return [];
  }
}

async function save(key, snapshot) {
  if (!dir) return;
  const all = (await readAll(key)).filter((s) => s.id !== snapshot.id);
  all.push(snapshot);
  all.sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  const kept = all.slice(-MAX_SNAPSHOTS);
  const file = fileFor(key);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(kept));
  await fs.promises.rename(tmp, file);
}

/** Snapshot metadata, newest first. */
async function list(key) {
  return (await readAll(key))
    .map(({ id, generatedAt, patch, sampleSize }) => ({ id, generatedAt, patch, sampleSize }))
    .reverse();
}

async function get(key, id) {
  return (await readAll(key)).find((s) => s.id === id) || null;
}

function diffMap(now = {}, before = {}, min) {
  const out = {};
  for (const id of new Set([...Object.keys(now), ...Object.keys(before)])) {
    const d = round((now[id] || 0) - (before[id] || 0));
    if (Math.abs(d) >= min) out[id] = d;
  }
  return out;
}

/**
 * Pick-rate changes between two snapshots (fractions, e.g. 0.12 = +12 points).
 * Only changes of at least `min` are kept. `biggest` lists the largest changes.
 */
function deltas(current, previous, { min = 0.05, top = 12 } = {}) {
  const nodes = diffMap(current.nodes, previous.nodes, min);
  const entries = diffMap(current.entries, previous.entries, min);
  const hero = diffMap(current.hero, previous.hero, min);
  const items = {};
  for (const g of new Set([...Object.keys(current.items || {}), ...Object.keys(previous.items || {})])) {
    const d = diffMap(current.items?.[g], previous.items?.[g], min);
    if (Object.keys(d).length) items[g] = d;
  }
  const biggest = [
    ...Object.entries(nodes).map(([id, delta]) => ({ type: 'talent', id: Number(id), delta })),
    ...Object.entries(items).flatMap(([group, m]) => Object.entries(m).map(([id, delta]) => ({ type: 'item', group, id: Number(id), delta }))),
  ]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, top);
  return { since: previous.generatedAt, sincePatch: previous.patch, nodes, entries, hero, items, biggest };
}

module.exports = { init, keyFor, snapshotOf, save, list, get, deltas };

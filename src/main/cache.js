'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const stats = require('./stats');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Time-to-live per cache kind. Run snapshots never change, so they never expire. */
const TTL = {
  talents: DAY,
  season: 12 * HOUR,
  rankings: HOUR,
  profile: HOUR,
  character: HOUR,
  realms: 7 * DAY,
  wclZone: 12 * HOUR,
  wclRankings: DAY,
  wclCharacter: HOUR,
  run: Infinity,
  itemTooltip: 7 * DAY,
  itemSource: 7 * DAY,
  spellTooltip: 7 * DAY,
  analysis: HOUR,
};

let cacheDir = null;
const memory = new Map();

// Not "cache": on Windows that is the same folder as Chromium's own "Cache" in userData.
const DIR_NAME = 'data-cache';
const LEGACY_DIR_NAME = 'cache';

function init(baseDir) {
  cacheDir = path.join(baseDir, DIR_NAME);
  fs.mkdirSync(cacheDir, { recursive: true });
  migrateLegacy(path.join(baseDir, LEGACY_DIR_NAME));
}

/** Move our data out of the folder shared with Chromium's cache (older versions used it). */
function migrateLegacy(legacyDir) {
  for (const kind of Object.keys(TTL)) {
    const from = path.join(legacyDir, kind);
    const to = path.join(cacheDir, kind);
    try {
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
    } catch {
      // keep going; the data is only a cache
    }
  }
}

function fileFor(kind, key) {
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex');
  return path.join(cacheDir, kind, `${hash}.json`);
}

/**
 * Cached value for (kind, key), or undefined. `ignoreTtl` also returns expired entries
 * (used to reopen the last results instantly). Returns `{ value, at }` when `withTime` is set.
 */
async function read(kind, key, opts = {}) {
  const found = await lookup(kind, key, opts);
  stats.recordCache(kind, found !== undefined);
  return found;
}

async function lookup(kind, key, { ignoreTtl = false, withTime = false }) {
  const ttl = ignoreTtl ? Infinity : TTL[kind] ?? HOUR;
  const memKey = `${kind}:${key}`;
  const hit = memory.get(memKey);
  if (hit && (ttl === Infinity || Date.now() - hit.at < ttl)) return withTime ? hit : hit.value;
  if (!cacheDir) return undefined;
  const file = fileFor(kind, key);
  try {
    const stat = await fs.promises.stat(file);
    if (ttl !== Infinity && Date.now() - stat.mtimeMs > ttl) return undefined;
    const value = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    const entry = { at: stat.mtimeMs, value };
    memory.set(memKey, entry);
    return withTime ? entry : value;
  } catch {
    return undefined;
  }
}

async function write(kind, key, value) {
  memory.set(`${kind}:${key}`, { at: Date.now(), value });
  if (!cacheDir) return;
  const file = fileFor(kind, key);
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(value));
    await fs.promises.rename(tmp, file);
  } catch {
    // A failed cache write only costs a refetch later.
  }
}

/**
 * Return the cached value for (kind, key), or produce, store and return it.
 * `force` skips the read (but still stores the fresh value).
 */
async function cached(kind, key, producer, { force = false } = {}) {
  if (!force) {
    const hit = await read(kind, key);
    if (hit !== undefined) return hit;
  }
  const value = await producer();
  if (value !== undefined && value !== null) await write(kind, key, value);
  return value;
}

async function dirSize(dir) {
  let total = 0;
  let files = 0;
  let entries = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await dirSize(p);
      total += sub.bytes;
      files += sub.files;
    } else {
      try {
        total += (await fs.promises.stat(p)).size;
        files++;
      } catch {
        // file vanished
      }
    }
  }
  return { bytes: total, files };
}

/** Disk usage of the cache. */
function info() {
  return cacheDir ? dirSize(cacheDir) : Promise.resolve({ bytes: 0, files: 0 });
}

/** Disk usage per cache kind: { kind: { bytes, files } }. */
async function infoByKind() {
  if (!cacheDir) return {};
  let kinds = [];
  try {
    kinds = (await fs.promises.readdir(cacheDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return {};
  }
  const out = {};
  for (const kind of kinds) out[kind] = await dirSize(path.join(cacheDir, kind));
  return out;
}

/** Delete everything in the cache (memory and disk). */
async function clear() {
  memory.clear();
  if (!cacheDir) return;
  await fs.promises.rm(cacheDir, { recursive: true, force: true });
  await fs.promises.mkdir(cacheDir, { recursive: true });
}

module.exports = { init, read, write, cached, info, infoByKind, dirSize, clear, TTL };

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Network and cache statistics for the developer menu: how much data was received from
 * each source (this session and all time), request counts, timings, errors, cache hits,
 * and a log of the most recent requests. Lifetime totals persist in stats.json.
 */

const RECENT_MAX = 100;
const SAVE_DELAY_MS = 5000;

const HOST_SOURCES = {
  'raider.io': 'raider.io',
  'www.raider.io': 'raider.io',
  'www.wowhead.com': 'Wowhead',
  'wowhead.com': 'Wowhead',
  // Wowhead's tooltips script and its data, loaded by the page.
  'nether.wowhead.com': 'Wowhead',
  'wow.zamimg.com': 'Wowhead',
  'wago.tools': 'wago.tools',
  'raw.githubusercontent.com': 'SimulationCraft',
  'www.warcraftlogs.com': 'Warcraft Logs',
  // Update checks of the portable exe (the installed app's updater has its own downloader).
  'api.github.com': 'GitHub',
  // Icons are loaded by the page itself from these CDNs.
  'cdn.raiderio.net': 'Icons (CDN)',
  'render.worldofwarcraft.com': 'Icons (CDN)',
};

let file = null;
let saveTimer = null;
let session = {};
let lifetime = {};
let lifetimeSince = new Date().toISOString();
let cacheStats = {};
let recent = [];

function emptyTotals() {
  return { requests: 0, bytes: 0, errors: 0, retries: 0, ms: 0 };
}

function sourceOf(url) {
  try {
    const host = new URL(url).host;
    return HOST_SOURCES[host] || host;
  } catch {
    return 'unknown';
  }
}

function init(baseDir) {
  file = path.join(baseDir, 'stats.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    lifetime = saved.lifetime || {};
    lifetimeSince = saved.since || lifetimeSince;
  } catch {
    lifetime = {};
  }
}

function save() {
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify({ since: lifetimeSince, lifetime }, null, 2));
  } catch {
    // statistics are best effort
  }
}

function scheduleSave() {
  if (!file || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, SAVE_DELAY_MS);
  saveTimer.unref?.();
}

/** Write pending lifetime totals now (call on quit). */
function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  save();
}

function add(totals, source, delta) {
  const t = (totals[source] ||= emptyTotals());
  for (const [k, v] of Object.entries(delta)) t[k] += v;
}

/**
 * One HTTP attempt. `bytes` = size of the received body (0 for failures),
 * `retry` = this attempt is a retry, `error` = failed attempt (HTTP error or network error),
 * `log` = false keeps it out of the recent-request list (used for icon downloads).
 */
function recordRequest({ url, status = null, bytes = 0, ms = 0, retry = false, error = null, log = true }) {
  const source = sourceOf(url);
  const delta = { requests: 1, bytes, errors: error ? 1 : 0, retries: retry ? 1 : 0, ms };
  add(session, source, delta);
  add(lifetime, source, delta);
  scheduleSave();
  if (!log) return;
  let shortPath = url;
  try {
    const u = new URL(url);
    shortPath = `${u.pathname}${u.search}`.slice(0, 140);
  } catch {
    // keep the raw url
  }
  recent.push({ at: new Date().toISOString(), source, path: shortPath, status, bytes, ms: Math.round(ms), retry, error: error || null });
  if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
}

/** Cache lookups per cache kind (this session). */
function recordCache(kind, hit) {
  const c = (cacheStats[kind] ||= { hits: 0, misses: 0 });
  if (hit) c.hits++;
  else c.misses++;
}

function withAverages(totals) {
  return Object.fromEntries(
    Object.entries(totals).map(([source, t]) => [source, { ...t, avgMs: t.requests ? Math.round(t.ms / t.requests) : 0 }])
  );
}

function snapshot() {
  return {
    session: withAverages(session),
    lifetime: withAverages(lifetime),
    lifetimeSince,
    cache: JSON.parse(JSON.stringify(cacheStats)),
    recent: [...recent].reverse(),
  };
}

/** Reset the all-time totals (session counters keep running). */
function resetLifetime() {
  lifetime = {};
  lifetimeSince = new Date().toISOString();
  flush();
}

/** For tests: forget everything held in memory. */
function _reset() {
  session = {};
  lifetime = {};
  cacheStats = {};
  recent = [];
  file = null;
}

module.exports = { init, sourceOf, recordRequest, recordCache, snapshot, resetLifetime, flush, RECENT_MAX, _reset };

'use strict';

const { request } = require('../http');
const cache = require('../cache');
const settings = require('../settings');

// Warcraft Logs API v2 (GraphQL). Uses the user's own API client (client credentials flow).
const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const API_URL = 'https://www.warcraftlogs.com/api/v2/client';

let token = null; // { value, expiresAt, clientId }

function credentials() {
  const { wclClientId, wclClientSecret } = settings.get();
  return wclClientId && wclClientSecret ? { clientId: wclClientId, clientSecret: wclClientSecret } : null;
}

function hasCredentials() {
  return !!credentials();
}

function missingCredentials() {
  const err = new Error('Add your Warcraft Logs API client in Settings to see damage numbers.');
  err.code = 'WCL_NO_CREDENTIALS';
  return err;
}

async function accessToken({ signal } = {}) {
  const creds = credentials();
  if (!creds) throw missingCredentials();
  if (token && token.clientId === creds.clientId && token.expiresAt > Date.now() + 60000) return token.value;
  let res;
  try {
    res = await request(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      retries: 2,
      signal,
    });
  } catch (err) {
    if (err.status === 400 || err.status === 401) {
      const e = new Error('Warcraft Logs rejected the client ID or secret. Check them in Settings.');
      e.code = 'WCL_BAD_CREDENTIALS';
      throw e;
    }
    throw err;
  }
  token = { value: res.access_token, expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000, clientId: creds.clientId };
  return token.value;
}

/** Run a GraphQL query; returns `data` or throws the first GraphQL error. */
async function query(gql, variables = {}, { signal } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const value = await accessToken({ signal });
    try {
      const res = await request(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: gql, variables }),
        signal,
      });
      if (res.errors?.length) {
        const message = res.errors[0].message || 'unknown error';
        const e = new Error(`Warcraft Logs: ${message}`);
        // Heavy queries (rankings) draw from a separate hourly "database points" budget.
        if (/points remaining|rate limit|too many/i.test(message)) e.code = 'WCL_LIMIT';
        throw e;
      }
      return res.data;
    } catch (err) {
      if (err.status === 429) err.code = 'WCL_LIMIT';
      if (err.status === 401 && attempt === 0) {
        token = null; // expired or revoked token: get a new one once
        continue;
      }
      throw err;
    }
  }
  throw new Error('Warcraft Logs: not authorized');
}

/** Checks the credentials; returns the API usage allowance. */
async function testConnection({ signal } = {}) {
  token = null;
  const data = await query('{ rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }', {}, { signal });
  return data.rateLimitData;
}

function forgetToken() {
  token = null;
}

// Logs shorter than this are partial (the log started or stopped mid-key) and are ignored.
const MIN_RUN_MS = 10 * 60 * 1000;
const METRICS = new Set(['dps', 'hps']);

/** "Death Knight" -> "DeathKnight", "Beast Mastery" -> "BeastMastery" (Warcraft Logs names). */
function wclName(name) {
  return String(name || '').replace(/[^A-Za-z]/g, '');
}

/** The current Mythic+ season zone: { id, name, encounters: [{ id, name }] }. */
async function getMplusZone({ signal } = {}) {
  return cache.cached('wclZone', 'mythic-plus', async () => {
    const d = await query('{ worldData { expansions { id zones { id name frozen encounters { id name } } } } }', {}, { signal });
    const expansions = [...d.worldData.expansions].sort((a, b) => b.id - a.id);
    for (const e of expansions) {
      const seasons = e.zones.filter((z) => /^Mythic\+ Season \d+$/i.test(z.name) && !z.frozen).sort((a, b) => b.id - a.id);
      if (seasons.length) return { id: seasons[0].id, name: seasons[0].name, encounters: seasons[0].encounters };
    }
    throw new Error('Warcraft Logs has no current Mythic+ season.');
  });
}

function compactRun(r, ilvl) {
  return {
    amount: r.amount,
    level: r.hardModeLevel ?? r.bracketData,
    duration: r.duration,
    ilvl,
    name: r.name,
    server: r.server?.name || null,
    region: r.server?.region || null,
    report: r.report?.code || null,
    fight: r.report?.fightID ?? null,
    start: r.startTime ?? null,
  };
}

/**
 * Logged runs of a spec in one dungeon, per key level: { [level]: [run] } (up to 100 per level,
 * the best-timed logged runs at that level). `withGear` adds each run's item level (much more data).
 * Each (dungeon, level) is cached on its own; missing levels are fetched in one query.
 */
async function getSpecRuns({ encounterId, className, specName, metric, levels, withGear = false, averageItemLevel }, { signal, force = false } = {}) {
  if (!METRICS.has(metric)) throw new Error(`Unknown metric ${metric}`);
  const c = wclName(className);
  const s = wclName(specName);
  const keyFor = (level, gear) => `${encounterId}|${c}|${s}|${metric}|${level}|${gear ? 'gear' : 'plain'}`;
  const out = {};
  const missing = [];
  for (const level of levels) {
    // Runs fetched with gear also answer plain requests.
    const hit = force ? undefined : (await cache.read('wclRankings', keyFor(level, true))) ?? (withGear ? undefined : await cache.read('wclRankings', keyFor(level, false)));
    if (hit) out[level] = hit;
    else missing.push(level);
  }
  if (!missing.length) return out;
  // Warcraft Logs keystone brackets are offset by one: bracket N holds +(N+1) keys.
  const aliases = missing
    .map((level) => `l${level}: characterRankings(className: $c, specName: $s, metric: ${metric}, bracket: ${level - 1}${withGear ? ', includeCombatantInfo: true' : ''})`)
    .join('\n');
  const d = await query(`query($id: Int!, $c: String!, $s: String!) { worldData { encounter(id: $id) { ${aliases} } } }`, { id: encounterId, c, s }, { signal });
  for (const level of missing) {
    const runs = (d.worldData.encounter?.[`l${level}`]?.rankings || [])
      .filter((r) => (r.hardModeLevel ?? r.bracketData) === level && r.duration >= MIN_RUN_MS && r.amount > 0)
      .map((r) => compactRun(r, withGear ? averageItemLevel(r.gear) : null));
    out[level] = runs;
    await cache.write('wclRankings', keyFor(level, withGear), runs);
  }
  return out;
}

/**
 * A character's logged runs per dungeon for one spec: { [encounterId]: [run] }, or null when
 * Warcraft Logs does not know the character.
 */
async function getCharacterRuns({ name, realmSlug, region, encounters, specName, metric }, { signal, force = false } = {}) {
  if (!METRICS.has(metric)) throw new Error(`Unknown metric ${metric}`);
  const s = wclName(specName);
  const key = JSON.stringify({ name: name.toLowerCase(), realmSlug, region, s, metric, ids: encounters.map((e) => e.id) });
  return cache.cached(
    'wclCharacter',
    key,
    async () => {
      const aliases = encounters.map((e) => `e${e.id}: encounterRankings(encounterID: ${e.id}, metric: ${metric}, specName: $s)`).join('\n');
      const d = await query(
        `query($n: String!, $r: String!, $g: String!, $s: String!) { characterData { character(name: $n, serverSlug: $r, serverRegion: $g) { id ${aliases} } } }`,
        { n: name, r: realmSlug, g: String(region).toUpperCase(), s },
        { signal }
      );
      const ch = d.characterData?.character;
      if (!ch) return { found: false, runs: {} };
      const runs = {};
      for (const e of encounters) {
        runs[e.id] = (ch[`e${e.id}`]?.ranks || [])
          .filter((r) => r.duration >= MIN_RUN_MS && r.amount > 0)
          .map((r) => compactRun({ ...r, hardModeLevel: r.bracketData }, null));
      }
      return { found: true, runs };
    },
    { force }
  );
}

/** API allowance: { limitPerHour, pointsSpentThisHour, pointsResetIn }. */
async function rateLimit({ signal } = {}) {
  return (await query('{ rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }', {}, { signal })).rateLimitData;
}

module.exports = { query, testConnection, hasCredentials, forgetToken, getMplusZone, getSpecRuns, getCharacterRuns, rateLimit, wclName, MIN_RUN_MS };

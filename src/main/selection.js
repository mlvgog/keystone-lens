'use strict';

/**
 * Choosing which key (run snapshot) represents a player:
 * the highest-scoring key played on the current patch (and after the optional
 * "since" date), falling back to their highest-scoring key on any patch.
 */

function parseVersion(v) {
  return String(v || '')
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function maxVersion(versions) {
  return versions.filter(Boolean).reduce((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null);
}

/** Ranked runs + recent runs, de-duplicated by run id, best score first. */
function buildCandidates(rankedRuns = [], recentRuns = []) {
  const byId = new Map();
  for (const r of [...rankedRuns, ...recentRuns]) {
    if (!r?.id) continue;
    const prev = byId.get(r.id);
    byId.set(r.id, { ...prev, ...r, completedAt: r.completedAt || prev?.completedAt || null });
  }
  return [...byId.values()].sort(
    (a, b) => (b.score || 0) - (a.score || 0) || (b.level || 0) - (a.level || 0) || (b.period || 0) - (a.period || 0)
  );
}

/** The candidate that was most likely played last (recent runs carry a date, ranked runs a week number). */
function mostRecentCandidate(candidates) {
  const dated = candidates.filter((c) => c.completedAt);
  if (dated.length) return dated.reduce((a, b) => (Date.parse(b.completedAt) > Date.parse(a.completedAt) ? b : a));
  const withPeriod = candidates.filter((c) => c.period);
  if (withPeriod.length) return withPeriod.reduce((a, b) => (b.period > a.period ? b : a));
  return candidates[0] || null;
}

/** The player's roster entry in a run snapshot, if they played the wanted spec and are not anonymised. */
function findMember(run, characterId, specId) {
  if (!run || run.missing || !characterId) return null;
  const m = (run.roster || []).find((r) => r.characterId === characterId);
  if (!m || m.specId !== specId || !m.talents || !m.talents.nodes?.length) return null;
  return m;
}

function matchesPatch(run, member, version, since) {
  if (version && compareVersions(member.talents.version, version) !== 0) return false;
  if (since && !(Date.parse(run.completedAt) >= Date.parse(since))) return false;
  return true;
}

/**
 * Walk the candidates (best score first) and return
 * `{ run, member, fallback }` or null when no usable snapshot exists.
 * `getRun(id)` resolves a run snapshot (cached by the caller).
 */
async function selectRun({ candidates, characterId, specId, version, since, getRun }) {
  let fallback = null;
  for (const c of candidates) {
    // Once we have a fallback, keys we know were played before `since` cannot match.
    if (fallback && since && c.completedAt && Date.parse(c.completedAt) < Date.parse(since)) continue;
    const run = await getRun(c.id);
    const member = findMember(run, characterId, specId);
    if (!member) continue;
    if (matchesPatch(run, member, version, since)) return { run, member, fallback: false };
    if (!fallback) fallback = { run, member, fallback: true };
  }
  return fallback;
}

module.exports = {
  compareVersions,
  maxVersion,
  buildCandidates,
  mostRecentCandidate,
  findMember,
  matchesPatch,
  selectRun,
};

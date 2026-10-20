'use strict';

/**
 * Groups players into "popular builds": players whose talent picks differ in at most
 * `threshold` nodes from the build's most central player (its medoid) share a build.
 */

/** A player's picks as Map nodeId -> "entryId:rank" (free/granted nodes are ignored). */
function signature(talents, allowed) {
  const sig = new Map();
  for (const n of talents.nodes) {
    if (!n.rank || n.granted || !allowed.has(n.nodeId)) continue;
    sig.set(n.nodeId, `${n.entryId ?? ''}:${n.rank}`);
  }
  return sig;
}

/** Number of nodes where two builds differ (missing, other choice or other rank). */
function distance(a, b) {
  let d = 0;
  for (const [k, v] of a) if (b.get(k) !== v) d++;
  for (const k of b.keys()) if (!a.has(k)) d++;
  return d;
}

function nearest(i, medoids, D) {
  let best = -1;
  let bestD = Infinity;
  for (const m of medoids) {
    if (D[i][m] < bestD || (D[i][m] === bestD && m < best)) {
      bestD = D[i][m];
      best = m;
    }
  }
  return { medoid: best, dist: bestD };
}

/**
 * How different two builds may be and still count as the same build: the 25th percentile
 * of distances between players on the same hero tree, kept within 4..10 nodes. Specs where
 * everyone plays nearly the same build get a tighter threshold than very varied specs.
 */
function adaptiveThreshold(players, D) {
  const ds = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      if (players[i].talents.heroSubTreeId === players[j].talents.heroSubTreeId) ds.push(D[i][j]);
    }
  }
  if (!ds.length) return 4;
  ds.sort((a, b) => a - b);
  return Math.max(4, Math.min(10, ds[Math.floor(0.25 * (ds.length - 1))]));
}

/**
 * players: [{ name, talents: { heroSubTreeId, loadoutText, nodes } }]
 * Returns { builds: [{ id, index, members, size, pct, heroSubTreeId, medoid, medoidName, loadoutText }],
 *           singles, assignment: [buildId | null per player], threshold }.
 */
function clusterBuilds(tree, players, { threshold = null, refinements = 2 } = {}) {
  const n = players.length;
  if (!n) return { builds: [], singles: 0, assignment: [] };
  const allowed = new Set([...tree.classNodes, ...tree.specNodes, ...tree.heroNodes].map((x) => x.id));
  const sigs = players.map((p) => signature(p.talents, allowed));
  const D = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) D[i][j] = D[j][i] = distance(sigs[i], sigs[j]);
  if (threshold == null) threshold = adaptiveThreshold(players, D);

  // Most central players seed the builds first.
  const centrality = D.map((row) => row.reduce((s, x) => s + x, 0));
  const order = [...Array(n).keys()].sort((a, b) => centrality[a] - centrality[b] || a - b);

  let medoids = [];
  const assign = new Array(n);
  for (const i of order) {
    const { medoid, dist } = nearest(i, medoids, D);
    if (medoid >= 0 && dist <= threshold) assign[i] = medoid;
    else {
      medoids.push(i);
      assign[i] = i;
    }
  }

  for (let r = 0; r < refinements; r++) {
    // Re-centre every build on the member closest to all other members...
    const groups = new Map();
    for (let i = 0; i < n; i++) (groups.get(assign[i]) || groups.set(assign[i], []).get(assign[i])).push(i);
    medoids = [...groups.values()].map((members) => {
      let best = members[0];
      let bestSum = Infinity;
      for (const c of members) {
        const sum = members.reduce((s, m) => s + D[c][m], 0);
        if (sum < bestSum || (sum === bestSum && c < best)) {
          bestSum = sum;
          best = c;
        }
      }
      return best;
    });
    // ...then move every player to its nearest build.
    for (const i of order) {
      const { medoid, dist } = nearest(i, medoids, D);
      if (medoid >= 0 && dist <= threshold) assign[i] = medoid;
      else {
        medoids.push(i);
        assign[i] = i;
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) (groups.get(assign[i]) || groups.set(assign[i], []).get(assign[i])).push(i);
  const sorted = [...groups.entries()]
    .map(([medoid, members]) => ({ medoid, members: members.sort((a, b) => a - b) }))
    .sort((a, b) => b.members.length - a.members.length || a.members[0] - b.members[0]);

  const builds = [];
  const assignment = new Array(n).fill(null);
  let singles = 0;
  for (const g of sorted) {
    if (g.members.length < 2) {
      singles += g.members.length;
      continue;
    }
    const id = `b${builds.length + 1}`;
    const heroCounts = {};
    for (const m of g.members) {
      const h = players[m].talents.heroSubTreeId;
      heroCounts[h] = (heroCounts[h] || 0) + 1;
    }
    const heroSubTreeId = Number(Object.entries(heroCounts).sort((a, b) => b[1] - a[1])[0][0]);
    for (const m of g.members) assignment[m] = id;
    builds.push({
      id,
      index: builds.length + 1,
      members: g.members,
      size: g.members.length,
      pct: g.members.length / n,
      heroSubTreeId: Number.isNaN(heroSubTreeId) ? null : heroSubTreeId,
      medoid: g.medoid,
      medoidName: players[g.medoid].name,
      loadoutText: players[g.medoid].talents.loadoutText || null,
    });
  }
  return { builds, singles, assignment, threshold };
}

/**
 * Class/spec nodes where a build's majority differs from everyone's majority:
 * [{ nodeId, kind: 'add'|'drop'|'swap', name, delta }] sorted by how different they are.
 */
function buildDiffs(tree, buildNodes, baseNodes) {
  const diffs = [];
  for (const node of [...tree.classNodes, ...tree.specNodes]) {
    const b = buildNodes[node.id];
    const a = baseNodes[node.id];
    if (!a || !b || !b.total || !a.total) continue;
    const inBuild = b.pct >= 0.5;
    const inBase = a.pct >= 0.5;
    const majorityEntry = (s) => Object.entries(s.entries).sort((x, y) => y[1] - x[1])[0]?.[0];
    const entryName = (id) => node.entries.find((e) => String(e.id) === String(id))?.name || node.entries[0]?.name || node.name;
    if (inBuild && !inBase) diffs.push({ nodeId: node.id, kind: 'add', name: entryName(majorityEntry(b)), delta: b.pct - a.pct });
    else if (!inBuild && inBase) diffs.push({ nodeId: node.id, kind: 'drop', name: entryName(majorityEntry(a)), delta: a.pct - b.pct });
    else if (inBuild && node.type === 'choice') {
      const eb = majorityEntry(b);
      const ea = majorityEntry(a);
      if (eb && ea && eb !== ea) {
        const share = (s, e) => (s.entries[e] || 0) / s.total;
        diffs.push({ nodeId: node.id, kind: 'swap', name: entryName(eb), from: entryName(ea), delta: share(b, eb) - share(a, eb) });
      }
    }
  }
  return diffs.sort((x, y) => y.delta - x.delta);
}

module.exports = { clusterBuilds, buildDiffs, distance, signature };

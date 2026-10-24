'use strict';

/**
 * Finding a spec's top players with raider.io's published API: the season's top-runs list of
 * every dungeon is read one page at a time, round-robin, and every roster member who played
 * the spec is collected. Reading all dungeons evenly finds players who are strong across the
 * whole season (high score) before one-dungeon specialists. The caller ranks them by score.
 */
function createDiscovery({ dungeons, specId, fetchPage }) {
  const lists = dungeons.map((slug) => ({ slug, page: 0, done: false }));
  const byId = new Map();
  const players = [];
  let pagesRead = 0;

  function add(run, m) {
    const key = { id: run.id, zoneId: run.zoneId, level: run.level, score: run.score, completedAt: run.completedAt };
    const known = byId.get(m.characterId);
    if (known) {
      if (!known.foundRuns.some((r) => r.id === run.id)) known.foundRuns.push(key);
      return;
    }
    const player = {
      characterId: m.characterId,
      name: m.name,
      classSlug: m.classSlug,
      realm: m.realm,
      realmSlug: m.realmSlug,
      region: m.region,
      race: m.race || null,
      foundRuns: [key],
    };
    byId.set(m.characterId, player);
    players.push(player);
  }

  async function round() {
    const open = lists.filter((l) => !l.done);
    const pages = await Promise.all(open.map((l) => fetchPage(l.slug, l.page++)));
    pagesRead += open.length;
    // Processed in dungeon order so the result does not depend on response timing.
    open.forEach((l, i) => {
      if (!pages[i].length) l.done = true;
      for (const run of pages[i]) {
        for (const m of run.roster || []) {
          if (m.specId === specId && m.characterId && m.name && m.realmSlug && m.region) add(run, m);
        }
      }
    });
  }

  return {
    players,
    get pagesRead() {
      return pagesRead;
    },
    get exhausted() {
      return lists.every((l) => l.done);
    },
    /** Read more pages until at least `n` players are known or every list is read; returns all players. */
    async until(n, onRound) {
      while (players.length < n && !this.exhausted) {
        await round();
        onRound?.();
      }
      return players;
    },
  };
}

/** How many players to look up so the top `sampleSize` by score are very likely among them. */
function poolTarget(sampleSize) {
  return sampleSize + Math.max(10, Math.ceil(sampleSize / 2));
}

/** Highest score first; players with equal scores keep the order they were found in. */
function rankByScore(states) {
  return states
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.player.score || 0) - (a.s.player.score || 0) || a.i - b.i)
    .map(({ s }) => s);
}

/** raider.io numbers a class's specs by ascending spec id (see raiderio.specScore). */
function specIndexOf(specIds, specId) {
  return [...specIds].sort((a, b) => a - b).indexOf(specId);
}

module.exports = { createDiscovery, poolTarget, rankByScore, specIndexOf };

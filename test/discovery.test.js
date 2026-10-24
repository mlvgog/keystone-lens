'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscovery, poolTarget, rankByScore, specIndexOf } = require('../src/main/discovery');
const { parseTopRuns, parseMythicPlusProfile, specScore } = require('../src/main/sources/raiderio');

const SUB = 261;
const ARMS = 71;

function member(id, specId, name = `P${id}`) {
  return { characterId: id, name, classSlug: 'rogue', specId, realm: 'Tarren Mill', realmSlug: 'tarren-mill', region: 'eu' };
}

function run(id, roster, level = 20) {
  return { id, zoneId: 1, level, score: 500, completedAt: '2026-10-01T00:00:00Z', roster };
}

test('discovery reads every dungeon round-robin and keeps players of the spec only', async () => {
  const pages = {
    a: [[run(1, [member(1, SUB), member(2, ARMS)])], [run(3, [member(4, SUB)])], []],
    b: [[run(2, [member(3, SUB), member(1, SUB)])], []],
  };
  const calls = [];
  const d = createDiscovery({
    dungeons: ['a', 'b'],
    specId: SUB,
    fetchPage: async (slug, page) => {
      calls.push(`${slug}${page}`);
      return pages[slug][page] || [];
    },
  });
  const players = await d.until(2);
  assert.deepEqual(calls, ['a0', 'b0']);
  assert.deepEqual(players.map((p) => p.characterId), [1, 3]);
  // A player found in two keys keeps both as candidates.
  assert.deepEqual(players[0].foundRuns.map((r) => r.id), [1, 2]);

  await d.until(10);
  assert.deepEqual(calls, ['a0', 'b0', 'a1', 'b1', 'a2']);
  assert.equal(d.exhausted, true);
  assert.equal(d.pagesRead, 5);
  assert.deepEqual(players.map((p) => p.characterId), [1, 3, 4]);
});

test('discovery skips anonymous roster entries', async () => {
  const d = createDiscovery({
    dungeons: ['a'],
    specId: SUB,
    fetchPage: async (_slug, page) => (page ? [] : [run(1, [{ ...member(1, SUB), realmSlug: null }, member(2, SUB)])]),
  });
  assert.deepEqual((await d.until(5)).map((p) => p.characterId), [2]);
});

test('players are ranked by score, ties keep the order they were found in', () => {
  const s = (id, score) => ({ player: { characterId: id, score } });
  assert.deepEqual(rankByScore([s(1, 3000), s(2, 3500), s(3, 3000), s(4, 0)]).map((x) => x.player.characterId), [2, 1, 3, 4]);
});

test('pool target leaves room for skipped players', () => {
  assert.equal(poolTarget(50), 75);
  assert.equal(poolTarget(10), 20);
});

test('spec index follows ascending spec ids, as raider.io numbers spec scores', () => {
  assert.equal(specIndexOf([70, 65, 66], 65), 0); // Holy
  assert.equal(specIndexOf([70, 65, 66], 70), 2); // Retribution
  assert.equal(specIndexOf([259, 260, 261], 999), -1);
});

test('top-runs page is reduced to run ids and rosters', () => {
  const json = {
    rankings: [
      {
        rank: 1,
        score: 547.2,
        run: {
          keystone_run_id: 21562735,
          mythic_level: 24,
          completed_at: '2026-10-19T09:59:03.000Z',
          dungeon: { id: 16368, slug: 'den-of-nalorakk' },
          roster: [
            {
              character: {
                id: 7,
                name: 'Kush',
                class: { slug: 'rogue' },
                spec: { id: SUB },
                race: { id: 4, name: 'Night Elf', slug: 'night-elf', faction: 'alliance' },
                realm: { name: 'Tarren Mill', slug: 'tarren-mill' },
                region: { slug: 'eu' },
              },
            },
            { character: null },
            { character: { id: 8, name: 'Vex', spec: { id: SUB }, realm: { name: 'Draenor', slug: 'draenor' }, region: { slug: 'eu' } } },
          ],
        },
      },
      { rank: 2, run: {} },
    ],
  };
  assert.deepEqual(parseTopRuns(json), [
    {
      id: 21562735,
      zoneId: 16368,
      level: 24,
      score: 547.2,
      completedAt: '2026-10-19T09:59:03.000Z',
      roster: [
        { characterId: 7, name: 'Kush', classSlug: 'rogue', specId: SUB, realm: 'Tarren Mill', realmSlug: 'tarren-mill', region: 'eu', race: { id: 4, name: 'Night Elf' } },
        { characterId: 8, name: 'Vex', classSlug: null, specId: SUB, realm: 'Draenor', realmSlug: 'draenor', region: 'eu', race: null },
      ],
    },
  ]);
});

test('profile gives spec scores, best and recent keys', () => {
  const key = (id) => ({ keystone_run_id: id, zone_id: 1, mythic_level: 20, score: 400, completed_at: '2026-10-01T00:00:00Z' });
  const p = parseMythicPlusProfile({
    mythic_plus_scores_by_season: [{ season: 'season-mn-2', segments: { spec_2: { score: 4296.6, color: '#ff8000' } } }],
    mythic_plus_best_runs: [key(1)],
    mythic_plus_recent_runs: [key(2), {}],
    race: 'Dark Iron Dwarf',
    faction: 'alliance',
  });
  assert.equal(p.race, 'Dark Iron Dwarf');
  assert.equal(p.faction, 'alliance');
  assert.equal(parseMythicPlusProfile({}).race, null);
  assert.deepEqual(p.bestRuns.map((r) => r.id), [1]);
  assert.deepEqual(p.recentRuns, [{ id: 2, zoneId: 1, level: 20, score: 400, completedAt: '2026-10-01T00:00:00Z' }]);
  assert.deepEqual(specScore(p.segments, 2), { score: 4296.6, color: '#ff8000' });
  assert.deepEqual(specScore(p.segments, 0), { score: 0, color: null });
  assert.deepEqual(specScore(p.segments, -1), { score: 0, color: null });
});

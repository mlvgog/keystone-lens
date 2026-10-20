'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareVersions,
  maxVersion,
  buildCandidates,
  mostRecentCandidate,
  findMember,
  selectRun,
} = require('../src/main/selection');

const SPEC = 64;
const ME = 1001;

function member({ id = ME, specId = SPEC, version = '12.1.0' } = {}) {
  return { characterId: id, specId, talents: { version, nodes: [{ nodeId: 1, rank: 1 }] }, items: {} };
}

function run(id, { completedAt = '2026-10-10T00:00:00Z', roster = [member()] } = {}) {
  return { id, completedAt, roster };
}

function getter(runs) {
  const calls = [];
  const byId = new Map(runs.map((r) => [r.id, r]));
  const get = async (id) => {
    calls.push(id);
    return byId.get(id) || { id, missing: true, roster: [] };
  };
  return { get, calls };
}

test('compareVersions / maxVersion', () => {
  assert.ok(compareVersions('12.1.0', '12.0.7') > 0);
  assert.ok(compareVersions('12.0.10', '12.0.7') > 0);
  assert.equal(compareVersions('12.1', '12.1.0'), 0);
  assert.equal(maxVersion(['12.0.7', null, '12.1.0', '12.0.10']), '12.1.0');
  assert.equal(maxVersion([]), null);
});

test('buildCandidates merges ranked + recent runs, best score first', () => {
  const c = buildCandidates(
    [{ id: 1, score: 400, period: 5 }, { id: 2, score: 450, period: 3 }],
    [{ id: 2, score: 450, completedAt: '2026-10-01T00:00:00Z' }, { id: 3, score: 300, completedAt: '2026-10-15T00:00:00Z' }]
  );
  assert.deepEqual(c.map((x) => x.id), [2, 1, 3]);
  assert.equal(c[0].completedAt, '2026-10-01T00:00:00Z', 'date from the recent-run entry is kept');
  assert.equal(c[0].period, 3, 'period from the ranked-run entry is kept');
  assert.equal(mostRecentCandidate(c).id, 3);
});

test('findMember rejects anonymised players, other specs and missing runs', () => {
  assert.ok(findMember(run(1), ME, SPEC));
  assert.equal(findMember(run(1, { roster: [member({ id: 0 })] }), ME, SPEC), null);
  assert.equal(findMember(run(1, { roster: [member({ specId: 63 })] }), ME, SPEC), null);
  assert.equal(findMember({ id: 1, missing: true, roster: [] }, ME, SPEC), null);
  assert.equal(findMember(run(1), 0, SPEC), null);
});

test('selectRun picks the best key on the current patch', async () => {
  const { get, calls } = getter([run(10), run(11)]);
  const res = await selectRun({ candidates: [{ id: 10 }, { id: 11 }], characterId: ME, specId: SPEC, version: '12.1.0', getRun: get });
  assert.equal(res.run.id, 10);
  assert.equal(res.fallback, false);
  assert.deepEqual(calls, [10], 'stops at the first match');
});

test('selectRun skips older-patch keys and wrong specs before falling back', async () => {
  const { get } = getter([
    run(10, { roster: [member({ version: '12.0.7' })] }),
    run(11, { roster: [member({ specId: 63 })] }),
    run(12),
  ]);
  const res = await selectRun({ candidates: [{ id: 10 }, { id: 11 }, { id: 12 }], characterId: ME, specId: SPEC, version: '12.1.0', getRun: get });
  assert.equal(res.run.id, 12);
  assert.equal(res.fallback, false);
});

test('selectRun falls back to the best key overall when none is on the current patch', async () => {
  const { get } = getter([run(10, { roster: [member({ version: '12.0.7' })] }), run(11, { roster: [member({ version: '12.0.5' })] })]);
  const res = await selectRun({ candidates: [{ id: 10 }, { id: 11 }], characterId: ME, specId: SPEC, version: '12.1.0', getRun: get });
  assert.equal(res.run.id, 10);
  assert.equal(res.fallback, true);
});

test('selectRun honours the "since" date and skips known-older keys once a fallback exists', async () => {
  const { get, calls } = getter([
    run(10, { completedAt: '2026-10-01T00:00:00Z' }),
    run(11, { completedAt: '2026-09-01T00:00:00Z' }),
    run(12, { completedAt: '2026-10-12T00:00:00Z' }),
  ]);
  const candidates = [{ id: 10 }, { id: 11, completedAt: '2026-09-01T00:00:00Z' }, { id: 12 }];
  const res = await selectRun({ candidates, characterId: ME, specId: SPEC, version: '12.1.0', since: '2026-10-08', getRun: get });
  assert.equal(res.run.id, 12);
  assert.equal(res.fallback, false);
  assert.deepEqual(calls, [10, 12], 'run 11 is known to be too old and is not fetched');
});

test('selectRun returns null when the player has no usable snapshot', async () => {
  const { get } = getter([run(10, { roster: [member({ id: 0 })] })]);
  const res = await selectRun({ candidates: [{ id: 10 }, { id: 99 }], characterId: ME, specId: SPEC, version: '12.1.0', getRun: get });
  assert.equal(res, null);
});

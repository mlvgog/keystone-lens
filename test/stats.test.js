'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stats = require('../src/main/stats');

test.beforeEach(() => stats._reset());

test('hosts map to data sources', () => {
  assert.equal(stats.sourceOf('https://raider.io/api/v1/mythic-plus/run-details?id=1'), 'raider.io');
  assert.equal(stats.sourceOf('https://nether.wowhead.com/tooltip/item/1'), 'Wowhead');
  assert.equal(stats.sourceOf('https://www.wowhead.com/item=1&xml'), 'Wowhead');
  assert.equal(stats.sourceOf('https://www.raidbots.com/static/data/live/talents.json'), 'raidbots');
  assert.equal(stats.sourceOf('https://example.org/x'), 'example.org');
  assert.equal(stats.sourceOf('not a url'), 'unknown');
});

test('requests are totalled per source for the session and all time', () => {
  stats.recordRequest({ url: 'https://raider.io/a', status: 200, bytes: 1000, ms: 100 });
  stats.recordRequest({ url: 'https://raider.io/b', status: 200, bytes: 3000, ms: 300, retry: true });
  stats.recordRequest({ url: 'https://raider.io/c', status: 503, ms: 50, error: 'HTTP 503' });
  stats.recordRequest({ url: 'https://nether.wowhead.com/tooltip/item/1', status: 200, bytes: 500, ms: 20 });
  const s = stats.snapshot();
  assert.deepEqual(s.session['raider.io'], { requests: 3, bytes: 4000, errors: 1, retries: 1, ms: 450, avgMs: 150 });
  assert.equal(s.session.Wowhead.bytes, 500);
  assert.deepEqual(s.lifetime['raider.io'], s.session['raider.io']);
  assert.equal(s.recent[0].source, 'Wowhead', 'newest first');
  assert.equal(s.recent[0].path, '/tooltip/item/1');
  assert.equal(s.recent.find((r) => r.status === 503).error, 'HTTP 503');
});

test('icon downloads count towards their own source but stay out of the request log', () => {
  assert.equal(stats.sourceOf('https://wow.zamimg.com/images/wow/icons/large/x.jpg'), 'Icons (CDN)');
  assert.equal(stats.sourceOf('https://cdn.raiderio.net/images/wow/icons/large/x.jpg'), 'Icons (CDN)');
  stats.recordRequest({ url: 'https://wow.zamimg.com/images/wow/icons/large/x.jpg', status: 200, bytes: 4000, ms: 30, log: false });
  const s = stats.snapshot();
  assert.equal(s.session['Icons (CDN)'].bytes, 4000);
  assert.equal(s.recent.length, 0);
});

test('the recent request log is capped', () => {
  for (let i = 0; i < stats.RECENT_MAX + 25; i++) stats.recordRequest({ url: `https://raider.io/r/${i}`, status: 200, bytes: 1, ms: 1 });
  const s = stats.snapshot();
  assert.equal(s.recent.length, stats.RECENT_MAX);
  assert.equal(s.recent[0].path, `/r/${stats.RECENT_MAX + 24}`);
});

test('cache hits and misses per kind', () => {
  stats.recordCache('run', true);
  stats.recordCache('run', true);
  stats.recordCache('run', false);
  assert.deepEqual(stats.snapshot().cache.run, { hits: 2, misses: 1 });
});

test('all-time totals survive a restart and can be reset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mplus-stats-'));
  stats.init(dir);
  stats.recordRequest({ url: 'https://www.raidbots.com/t.json', status: 200, bytes: 2048, ms: 10 });
  stats.flush();
  stats._reset();
  stats.init(dir);
  const s = stats.snapshot();
  assert.equal(s.lifetime.raidbots.bytes, 2048);
  assert.equal(s.session.raidbots, undefined, 'session totals start empty');
  stats.resetLifetime();
  stats._reset();
  stats.init(dir);
  assert.equal(stats.snapshot().lifetime.raidbots, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

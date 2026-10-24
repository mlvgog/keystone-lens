'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater, compareVersions, cleanVersion, FIRST_CHECK_MS, CHECK_EVERY_MS } = require('../src/main/updater');

/** Stand-in for electron-updater's autoUpdater: `next` decides what the next check finds. */
function fakeAutoUpdater() {
  const u = new EventEmitter();
  u.next = { version: null }; // null: no update
  u.checks = 0;
  u.downloads = 0;
  u.installed = null;
  u.checkForUpdates = async () => {
    u.checks++;
    if (u.next.error) {
      const err = new Error(u.next.error);
      u.emit('error', err);
      throw err;
    }
    if (!u.next.version) {
      u.emit('update-not-available', { version: '1.0.0' });
      return { isUpdateAvailable: false };
    }
    u.emit('update-available', { version: u.next.version });
    return { isUpdateAvailable: true, downloadPromise: u.autoDownload ? u.downloadUpdate() : null };
  };
  u.downloadUpdate = async () => {
    u.downloads++;
    u.emit('download-progress', { percent: 50.4 });
    u.emit('update-downloaded', { version: u.next.version });
    return ['setup.exe'];
  };
  u.quitAndInstall = (silent, run) => (u.installed = { silent, run });
  return u;
}

/** Timers that run only when the test says so. */
function manualTimers() {
  const pending = new Map();
  let id = 0;
  return {
    setTimeout: (fn, ms) => (pending.set(++id, { fn, ms }), id),
    clearTimeout: (t) => pending.delete(t),
    pending: () => [...pending.values()].map((t) => t.ms),
    async runNext() {
      const [key, t] = pending.entries().next().value;
      pending.delete(key);
      await t.fn();
    },
  };
}

test('versions compare numerically, a pre-release before its release', () => {
  assert.ok(compareVersions('1.10.0', '1.9.3') > 0);
  assert.ok(compareVersions('v1.2.0', '1.2.0') === 0);
  assert.ok(compareVersions('1.2.0', '1.2.1') < 0);
  assert.ok(compareVersions('1.2.0-beta.2', '1.2.0') < 0);
  assert.ok(compareVersions('1.2.0-beta.10', '1.2.0-beta.2') > 0);
  assert.equal(compareVersions('garbage', '1.0.0'), 0);
  assert.equal(cleanVersion('v1.2.3'), '1.2.3');
  assert.equal(cleanVersion('1.2'), null);
});

test('automatic mode checks after start-up, downloads in the background, then installs on restart', async () => {
  const u = fakeAutoUpdater();
  const timers = manualTimers();
  const seen = [];
  const updater = createUpdater({ currentVersion: '1.1.0', autoUpdater: u, onStatus: (s) => seen.push(s.state), ...timers });
  updater.start('auto');
  assert.deepEqual(timers.pending(), [FIRST_CHECK_MS]);
  assert.equal(u.checks, 0, 'no check before the first timer');

  u.next = { version: '1.2.0' };
  await timers.runNext();
  assert.equal(u.checks, 1);
  assert.equal(u.downloads, 1);
  assert.equal(u.autoInstallOnAppQuit, true);
  const s = updater.getStatus();
  assert.equal(s.state, 'ready');
  assert.equal(s.version, '1.2.0');
  assert.equal(s.releaseUrl, 'https://github.com/mlvgog/keystone-lens/releases/tag/v1.2.0');
  assert.deepEqual(seen, ['checking', 'downloading', 'downloading', 'ready']);
  assert.deepEqual(timers.pending(), [CHECK_EVERY_MS], 'checks again every 6 hours');

  // A downloaded update is not checked again; restarting installs it silently and relaunches.
  await updater.check();
  assert.equal(u.checks, 1);
  assert.equal(updater.install(), true);
  assert.deepEqual(u.installed, { silent: true, run: true });
});

test('notify mode only downloads when asked', async () => {
  const u = fakeAutoUpdater();
  const timers = manualTimers();
  const updater = createUpdater({ currentVersion: '1.1.0', autoUpdater: u, ...timers });
  updater.start('notify');
  u.next = { version: '1.2.0' };
  await timers.runNext();
  assert.equal(updater.getStatus().state, 'available');
  assert.equal(u.downloads, 0);
  assert.equal(updater.install(), false, 'nothing to install yet');

  await updater.download();
  assert.equal(u.downloads, 1);
  assert.equal(updater.getStatus().state, 'ready');
});

test('switching from notify to automatic downloads an update that was already found', async () => {
  const u = fakeAutoUpdater();
  const timers = manualTimers();
  const updater = createUpdater({ currentVersion: '1.1.0', autoUpdater: u, ...timers });
  updater.start('notify');
  u.next = { version: '1.2.0' };
  await timers.runNext();
  updater.setMode('auto');
  await new Promise((r) => setImmediate(r));
  assert.equal(u.downloads, 1);
  assert.equal(updater.getStatus().state, 'ready');
});

test('off never checks on its own, but "Check now" still works', async () => {
  const u = fakeAutoUpdater();
  const timers = manualTimers();
  const updater = createUpdater({ currentVersion: '1.1.0', autoUpdater: u, ...timers });
  updater.start('off');
  assert.deepEqual(timers.pending(), []);

  u.next = { version: '1.2.0' };
  await updater.check({ user: true });
  assert.equal(u.checks, 1);
  assert.equal(updater.getStatus().state, 'available', 'found, but not downloaded');
  assert.equal(u.downloads, 0);

  // Turning updates on again schedules a check; turning them off cancels it.
  updater.setMode('auto');
  assert.deepEqual(timers.pending(), [FIRST_CHECK_MS]);
  updater.setMode('off');
  assert.deepEqual(timers.pending(), []);
});

test('no update: the status says so', async () => {
  const u = fakeAutoUpdater();
  const updater = createUpdater({ currentVersion: '1.1.0', autoUpdater: u, ...manualTimers() });
  await updater.check();
  const s = updater.getStatus();
  assert.equal(s.state, 'latest');
  assert.ok(s.checkedAt > 0);
});

test('errors become a status, marked when the user asked', async () => {
  const u = fakeAutoUpdater();
  const updater = createUpdater({ currentVersion: '1.1.0', autoUpdater: u, ...manualTimers() });
  u.next = { error: 'net::ERR_INTERNET_DISCONNECTED' };
  await updater.check();
  assert.equal(updater.getStatus().state, 'error');
  assert.equal(updater.getStatus().userCheck, false);
  await updater.check({ user: true });
  assert.equal(updater.getStatus().userCheck, true);
  assert.match(updater.getStatus().error, /DISCONNECTED/);

  // The next successful check clears the error.
  u.next = { version: null };
  await updater.check();
  assert.equal(updater.getStatus().state, 'latest');
  assert.equal(updater.getStatus().error, null);
});

test('running from source never checks', async () => {
  const u = fakeAutoUpdater();
  const timers = manualTimers();
  const updater = createUpdater({ currentVersion: '1.1.0', packaged: false, autoUpdater: u, ...timers });
  updater.start('auto');
  await updater.check({ user: true });
  assert.equal(updater.getStatus().state, 'disabled');
  assert.deepEqual(timers.pending(), []);
  assert.equal(u.checks, 0);
});

test('the portable exe asks GitHub for the newest release and offers its page', async () => {
  let release = { tag_name: 'v1.2.0', draft: false, prerelease: false };
  const updater = createUpdater({ currentVersion: '1.1.0', portable: true, fetchLatest: async () => release, ...manualTimers() });
  await updater.check();
  let s = updater.getStatus();
  assert.equal(s.state, 'available');
  assert.equal(s.portable, true);
  assert.equal(s.version, '1.2.0');
  assert.equal(s.releaseUrl, 'https://github.com/mlvgog/keystone-lens/releases/tag/v1.2.0');
  assert.equal(await updater.download().then((x) => x.state), 'available', 'the portable exe cannot download itself');
  assert.equal(updater.install(), false);

  release = { tag_name: 'v1.1.0' };
  await updater.check();
  assert.equal(updater.getStatus().state, 'latest');

  release = { tag_name: 'v9.0.0-beta.1', prerelease: true };
  await updater.check();
  assert.equal(updater.getStatus().state, 'latest', 'pre-releases are ignored');
});

test('checks that overlap share one request', async () => {
  let calls = 0;
  let resolve;
  const updater = createUpdater({
    currentVersion: '1.1.0',
    portable: true,
    fetchLatest: () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
    ...manualTimers(),
  });
  const a = updater.check();
  const b = updater.check({ user: true });
  resolve({ tag_name: 'v1.0.0' });
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(updater.getStatus().state, 'latest');
});

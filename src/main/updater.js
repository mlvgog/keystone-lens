'use strict';

/**
 * Automatic updates from GitHub Releases.
 *
 * The installed app uses electron-updater (it reads `latest.yml` from the newest release,
 * downloads the installer, checks its SHA-512 and runs it silently on restart or quit).
 * The portable exe cannot replace itself, so it only asks GitHub's API for the newest
 * release and offers its download page.
 *
 * Modes (Settings → Updates):
 * - auto:   check on start and every 6 hours, download in the background, install on restart;
 * - notify: check the same way, but only download when asked;
 * - off:    never contact GitHub on its own ("Check now" still works).
 */

const REPO = 'mlvgog/keystone-lens';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const MODES = ['auto', 'notify', 'off'];
const FIRST_CHECK_MS = 10 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** >0 when `a` is newer than `b`, <0 when older, 0 when equal or unparseable. A pre-release is older than its release. */
function compareVersions(a, b) {
  const x = VERSION_RE.exec(String(a || '').trim());
  const y = VERSION_RE.exec(String(b || '').trim());
  if (!x || !y) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d;
  }
  if (x[4] && !y[4]) return -1;
  if (!x[4] && y[4]) return 1;
  return String(x[4] || '').localeCompare(String(y[4] || ''), 'en', { numeric: true });
}

const cleanVersion = (v) => {
  const m = VERSION_RE.exec(String(v || '').trim());
  return m ? `${m[1]}.${m[2]}.${m[3]}${m[4] ? `-${m[4]}` : ''}` : null;
};

const releaseUrl = (version) => (version ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL);

/**
 * deps:
 * - currentVersion: the running app's version
 * - packaged: false when running from source (no updates then)
 * - portable: true for the portable exe (notify only, download page)
 * - autoUpdater: electron-updater's autoUpdater (installed app only)
 * - fetchLatest(): the newest GitHub release ({ tag_name, draft, prerelease }) (portable only)
 * - onStatus(status): called on every status change
 * - setTimeout / clearTimeout: injectable for tests
 *
 * Status: { state, version, percent, error, releaseUrl, portable, userCheck, checkedAt }
 * states: disabled | idle | checking | latest | available | downloading | ready | error
 */
function createUpdater(deps) {
  const {
    currentVersion,
    packaged = true,
    portable = false,
    autoUpdater = null,
    fetchLatest = null,
    onStatus = () => {},
    setTimeout: setTimer = setTimeout,
    clearTimeout: clearTimer = clearTimeout,
  } = deps;
  const enabled = packaged && (portable ? !!fetchLatest : !!autoUpdater);

  let mode = 'auto';
  let timer = null;
  let checking = null; // promise of the running check
  let userCheck = false; // the running check was started from "Check now"
  let status = enabled ? { state: 'idle' } : { state: 'disabled' };

  function emit(patch) {
    status = { ...status, ...patch, portable };
    onStatus({ ...status });
  }

  function schedule(ms) {
    if (timer) clearTimer(timer);
    timer = null;
    if (!enabled || mode === 'off') return;
    timer = setTimer(async () => {
      timer = null;
      await check();
      schedule(CHECK_EVERY_MS);
    }, ms);
  }

  // electron-updater events (installed app).
  if (enabled && autoUpdater) {
    autoUpdater.logger = null;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    // An update the user (or auto mode) downloaded is installed when the app quits.
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoDownload = false;
    autoUpdater.on('update-available', (info) => {
      const version = cleanVersion(info?.version);
      emit({ state: autoUpdater.autoDownload ? 'downloading' : 'available', version, percent: 0, error: null, releaseUrl: releaseUrl(version) });
    });
    autoUpdater.on('update-not-available', () => emit({ state: 'latest', version: null, error: null, checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => {
      if (status.state === 'downloading' || status.state === 'available') emit({ state: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p?.percent || 0))) });
    });
    autoUpdater.on('update-downloaded', (info) => {
      const version = cleanVersion(info?.version) || status.version;
      emit({ state: 'ready', version, percent: 100, error: null, releaseUrl: releaseUrl(version) });
    });
    autoUpdater.on('error', (err) => {
      // Keep a finished download usable even if a later check fails.
      if (status.state === 'ready') return;
      emit({ state: 'error', error: err?.message || String(err), userCheck });
    });
  }

  async function checkPortable() {
    const release = await fetchLatest();
    const version = release && !release.draft && !release.prerelease ? cleanVersion(release.tag_name) : null;
    if (version && compareVersions(version, currentVersion) > 0) {
      emit({ state: 'available', version, error: null, releaseUrl: releaseUrl(version), checkedAt: Date.now() });
    } else {
      emit({ state: 'latest', version: null, error: null, checkedAt: Date.now() });
    }
  }

  /** Look for a new release. `user`: started from "Check now" (errors are then shown to the user). */
  function check({ user = false } = {}) {
    if (!enabled) return Promise.resolve({ ...status });
    if (status.state === 'ready' || status.state === 'downloading') return Promise.resolve({ ...status });
    if (checking) {
      userCheck ||= user;
      return checking;
    }
    userCheck = user;
    emit({ state: 'checking', error: null, userCheck });
    checking = (async () => {
      try {
        if (portable) await checkPortable();
        else {
          autoUpdater.autoDownload = mode === 'auto';
          const result = await autoUpdater.checkForUpdates();
          // Download failures arrive as 'error' events; the promise itself is only kept quiet.
          result?.downloadPromise?.catch(() => {});
        }
      } catch (err) {
        if (status.state !== 'ready') emit({ state: 'error', error: err?.message || String(err), userCheck });
      } finally {
        checking = null;
      }
      return { ...status };
    })();
    return checking;
  }

  /** Download an available update (notify / off mode). Portable builds open the download page instead. */
  async function download() {
    if (!enabled || portable || status.state !== 'available') return { ...status };
    emit({ state: 'downloading', percent: 0, error: null });
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      if (status.state !== 'ready') emit({ state: 'error', error: err?.message || String(err), userCheck: true });
    }
    return { ...status };
  }

  /** Restart now and install the downloaded update. */
  function install() {
    if (!enabled || portable || status.state !== 'ready') return false;
    autoUpdater.quitAndInstall(true, true);
    return true;
  }

  function setMode(next) {
    const before = mode;
    mode = MODES.includes(next) ? next : 'auto';
    if (!enabled) return;
    if (mode === 'off') return schedule(null);
    // Turned on (or auto again): check soon; an update found in notify mode downloads now.
    if (before === 'off') schedule(FIRST_CHECK_MS);
    if (mode === 'auto' && status.state === 'available' && !portable) download();
  }

  /** Start with the saved mode: first check shortly after start-up, then every 6 hours. */
  function start(initialMode) {
    mode = MODES.includes(initialMode) ? initialMode : 'auto';
    schedule(FIRST_CHECK_MS);
  }

  function stop() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  return {
    start,
    stop,
    setMode,
    check,
    download,
    install,
    getStatus: () => ({ ...status, portable }),
    getMode: () => mode,
  };
}

module.exports = { createUpdater, compareVersions, cleanVersion, releaseUrl, MODES, RELEASES_URL, LATEST_RELEASE_API, FIRST_CHECK_MS, CHECK_EVERY_MS };

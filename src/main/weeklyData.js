'use strict';

/**
 * The weekly addon data (`KeystoneLens_DB`) for players who use the addon through the app, so
 * they get the same data for every spec as players who install the addon from CurseForge.
 *
 * The Addon workflow publishes exactly what it uploads to CurseForge to this repository's
 * `addon-data` prerelease: KeystoneLens_DB.toc, Data.lua and manifest.json
 * ({ version: "YYYY.MM.DD", addon, files: { [name]: { sha256, bytes } } }). Prereleases are
 * ignored by the app's updater and the website's download button.
 *
 * The app installs it into AddOns/KeystoneLens_DB with a marker file and keeps that copy
 * current. A copy without the marker came from CurseForge (or by hand): the app never touches
 * it, CurseForge keeps it current. Per spec, the addon shows the newer of this data and the
 * data the app writes itself (KeystoneLens_Data).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BUNDLE_ADDON, readTocField } = require('./addonExport');

const BASE_URL = 'https://github.com/mlvgog/keystone-lens/releases/download/addon-data/';
const MARKER = '.installed-by-keystone-lens';
const FILES = [`${BUNDLE_ADDON}.toc`, 'Data.lua'];
const VERSION = /^\d{4}\.\d{2}\.\d{2}$/;

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

/** The weekly data in AddOns: { version, managed } (version null when it isn't installed). */
async function localWeekly(addonsDir) {
  const dir = path.join(addonsDir, BUNDLE_ADDON);
  let version = null;
  try {
    version = readTocField(await fs.promises.readFile(path.join(dir, `${BUNDLE_ADDON}.toc`), 'utf8'), 'Version');
  } catch {
    return { version: null, managed: false };
  }
  return { version, managed: exists(path.join(dir, MARKER)) };
}

/** The published manifest, checked. */
async function fetchManifest(fetchJson) {
  const m = await fetchJson(`${BASE_URL}manifest.json`, { retries: 2 });
  if (!m || !VERSION.test(String(m.version)) || !m.files || FILES.some((f) => !/^[0-9a-f]{64}$/.test(String(m.files[f]?.sha256)))) {
    throw new Error('The weekly data manifest is not valid');
  }
  return m;
}

/** "2026.11.18" style versions: is `a` newer than `b`? */
const isNewer = (a, b) => VERSION.test(String(a)) && (!VERSION.test(String(b)) || String(a) > String(b));

/**
 * Download the files of `manifest`, check their checksums, and swap them in as
 * AddOns/KeystoneLens_DB with the marker. The game never sees half a folder.
 */
async function installWeekly(addonsDir, manifest, fetchText) {
  const target = path.join(addonsDir, BUNDLE_ADDON);
  const stamp = `${process.pid}-${Date.now()}`;
  const tmp = `${target}.new-${stamp}`;
  const old = `${target}.old-${stamp}`;
  const contents = {};
  for (const name of FILES) {
    const text = await fetchText(`${BASE_URL}${encodeURIComponent(name)}`, { retries: 2 });
    const sha = crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    if (sha !== manifest.files[name].sha256) throw new Error(`${name} of the weekly data does not match its checksum`);
    contents[name] = text;
  }
  await fs.promises.mkdir(tmp, { recursive: true });
  try {
    for (const name of FILES) await fs.promises.writeFile(path.join(tmp, name), contents[name]);
    await fs.promises.writeFile(path.join(tmp, MARKER), `${JSON.stringify({ version: manifest.version, installedAt: new Date().toISOString() }, null, 2)}\n`);
    let moved = false;
    try {
      if (exists(target)) {
        await fs.promises.rename(target, old);
        moved = true;
      }
      await fs.promises.rename(tmp, target);
    } catch (err) {
      if (moved && !exists(target)) await fs.promises.rename(old, target).catch(() => {});
      throw err;
    }
    if (moved) await fs.promises.rm(old, { recursive: true, force: true }).catch(() => {});
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return manifest.version;
}

/**
 * What to do with the weekly data: 'install' (missing), 'update' (the app's copy is older than
 * the published one), or null (current, or not the app's copy).
 */
function weeklyAction(local, latest) {
  if (!latest) return null;
  if (!local.version) return 'install';
  if (local.managed && isNewer(latest, local.version)) return 'update';
  return null;
}

module.exports = { BASE_URL, MARKER, FILES, localWeekly, fetchManifest, installWeekly, weeklyAction, isNewer };

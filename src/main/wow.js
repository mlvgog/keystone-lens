'use strict';

/**
 * The World of Warcraft installation: finding the retail folder, installing the Keystone Lens
 * addon that ships with the app, and reading the characters the addon saved.
 *
 * Paths: <retail>/Interface/AddOns/<addon>, <retail>/WTF/Account/<ACCOUNT>/SavedVariables/<addon>.lua
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parseLua } = require('./lua');
const { readTocField, MAIN_ADDON } = require('./addonExport');
const { compareVersions } = require('./updater');

const REGISTRY_KEYS = ['HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft', 'HKLM\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft'];
const COMMON_ROOTS = [
  'C:\\Program Files (x86)\\World of Warcraft',
  'C:\\Program Files\\World of Warcraft',
  ...['C', 'D', 'E', 'F', 'G'].flatMap((d) => [`${d}:\\World of Warcraft`, `${d}:\\Games\\World of Warcraft`, `${d}:\\Battle.net\\World of Warcraft`]),
];
const SAVED_VARIABLES = `${MAIN_ADDON}.lua`;

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

/** A retail game folder has the game exe or the folders the game creates. */
function isRetailFolder(dir, { has = exists } = {}) {
  if (!dir) return false;
  return ['Wow.exe', 'WowT.exe', 'Interface', 'WTF'].some((f) => has(path.join(dir, f)));
}

/**
 * The retail folder for a folder the user picked: the game root, `_retail_` itself, or a folder
 * inside it (Interface, AddOns, WTF). Null when it isn't a WoW folder.
 */
function normalizeWowFolder(picked, { has = exists } = {}) {
  if (!picked) return null;
  let dir = path.resolve(String(picked));
  for (let up = 0; up < 4; up++) {
    if (path.basename(dir).toLowerCase() === '_retail_' && isRetailFolder(dir, { has })) return dir;
    const retail = path.join(dir, '_retail_');
    if (has(retail) && isRetailFolder(retail, { has })) return retail;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The game's install path from the Windows registry (`reg query`), or null. */
function registryInstallPath({ run = execFile } = {}) {
  if (process.platform !== 'win32' && run === execFile) return Promise.resolve(null);
  return REGISTRY_KEYS.reduce(
    (prev, key) =>
      prev.then(
        (found) =>
          found ||
          new Promise((resolve) => {
            run('reg', ['query', key, '/v', 'InstallPath'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
              if (err) return resolve(null);
              const m = /InstallPath\s+REG_\w+\s+(.+)/i.exec(String(stdout));
              resolve(m ? m[1].trim() : null);
            });
          })
      ),
    Promise.resolve(null)
  );
}

/** Find the retail folder: the registry first, then the usual install locations. */
async function findWowFolder({ has = exists, run } = {}) {
  const fromRegistry = await registryInstallPath(run ? { run } : {});
  for (const candidate of [fromRegistry, ...COMMON_ROOTS].filter(Boolean)) {
    const dir = normalizeWowFolder(candidate, { has });
    if (dir) return dir;
  }
  return null;
}

const addonsDir = (retail) => path.join(retail, 'Interface', 'AddOns');

/** Version of an addon folder from its .toc, or null when it isn't there. */
async function addonVersion(dir, name = MAIN_ADDON) {
  try {
    return readTocField(await fs.promises.readFile(path.join(dir, `${name}.toc`), 'utf8'), 'Version');
  } catch {
    return null;
  }
}

/**
 * Installed vs bundled addon: { installed, bundled, action: 'install'|'update'|null }.
 * A newer installed copy (for example from CurseForge) is never replaced.
 */
async function addonStatus(retail, bundledDir) {
  const [installed, bundled] = await Promise.all([retail ? addonVersion(path.join(addonsDir(retail), MAIN_ADDON)) : null, addonVersion(bundledDir)]);
  let action = null;
  if (retail && bundled) {
    if (!installed) action = 'install';
    else if (compareVersions(bundled, installed) > 0) action = 'update';
  }
  return { installed, bundled, action };
}

/**
 * Copy the bundled addon into AddOns: into a temporary folder first, then swapped in, so the
 * game never sees half an addon.
 */
async function installAddon(retail, bundledDir) {
  const target = path.join(addonsDir(retail), MAIN_ADDON);
  const stamp = `${process.pid}-${Date.now()}`;
  const tmp = `${target}.new-${stamp}`;
  const old = `${target}.old-${stamp}`;
  await fs.promises.mkdir(addonsDir(retail), { recursive: true });
  await fs.promises.cp(bundledDir, tmp, { recursive: true });
  let moved = false;
  try {
    if (exists(target)) {
      await fs.promises.rename(target, old);
      moved = true;
    }
    await fs.promises.rename(tmp, target);
  } catch (err) {
    if (moved && !exists(target)) await fs.promises.rename(old, target).catch(() => {});
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  if (moved) await fs.promises.rm(old, { recursive: true, force: true }).catch(() => {});
  return addonVersion(target);
}

/** SavedVariables files of the addon, one per WoW account folder. */
async function savedVariablesFiles(retail) {
  const root = path.join(retail, 'WTF', 'Account');
  let accounts = [];
  try {
    accounts = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const a of accounts) {
    if (!a.isDirectory()) continue;
    const file = path.join(root, a.name, 'SavedVariables', SAVED_VARIABLES);
    if (exists(file)) files.push(file);
  }
  return files;
}

const REGIONS = new Set(['us', 'eu', 'kr', 'tw', 'cn']);

/**
 * Characters the addon saved (on logout or /reload), newest first:
 * [{ key, name, realm, region, className, specId, specName, level, itemLevel, time, simc }].
 */
async function readAddonCharacters(retail) {
  const byKey = new Map();
  for (const file of await savedVariablesFiles(retail)) {
    let db;
    try {
      db = parseLua(await fs.promises.readFile(file)).KeystoneLensDB;
    } catch {
      continue; // unreadable or half written: the next save fixes it
    }
    for (const [key, c] of Object.entries(db?.characters || {})) {
      if (!c || typeof c !== 'object' || typeof c.simc !== 'string' || !c.name) continue;
      const entry = {
        key,
        name: String(c.name),
        realm: String(c.realm || ''),
        region: REGIONS.has(String(c.region)) ? String(c.region) : null,
        className: c.className ? String(c.className) : null,
        specId: Number(c.specId) || null,
        specName: c.specName ? String(c.specName) : null,
        level: Number(c.level) || null,
        itemLevel: Number(c.itemLevel) || null,
        time: Number(c.time) || 0,
        simc: c.simc.slice(0, 100000),
      };
      const prev = byKey.get(key);
      if (!prev || entry.time > prev.time) byKey.set(key, entry);
    }
  }
  return [...byKey.values()].sort((a, b) => b.time - a.time);
}

module.exports = {
  isRetailFolder,
  normalizeWowFolder,
  registryInstallPath,
  findWowFolder,
  addonsDir,
  addonVersion,
  addonStatus,
  installAddon,
  savedVariablesFiles,
  readAddonCharacters,
};

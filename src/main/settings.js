'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = { tooltipLocale: 0, defaultRegion: 'world', defaultSize: 50, wclClientId: '', wclClientSecret: '', updates: 'auto' };
const REGIONS = ['world', 'us', 'eu', 'kr', 'tw'];
const SIZES = [25, 50, 100];
// auto: download and install updates; notify: only say a new version is out; off: never check on its own.
const UPDATE_MODES = ['auto', 'notify', 'off'];

let file = null;
let data = { ...DEFAULTS };
let vault = null; // { encrypt(string) -> base64, decrypt(base64) -> string }, e.g. Electron safeStorage

/**
 * Load the settings. With a `vault`, the Warcraft Logs secret is stored encrypted
 * (`wclClientSecretEnc`); a plain-text secret from an older version is encrypted on load.
 */
function init(baseDir, validLocales = [0], { vault: v = null } = {}) {
  file = path.join(baseDir, 'settings.json');
  vault = v;
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // first start or unreadable file: defaults
  }
  let secret = raw.wclClientSecret || '';
  if (raw.wclClientSecretEnc && vault) {
    try {
      secret = vault.decrypt(raw.wclClientSecretEnc);
    } catch {
      secret = ''; // encrypted by another Windows user or machine: ask for it again
    }
  }
  data = sanitize({ ...DEFAULTS, ...raw, wclClientSecret: secret }, validLocales);
  if (vault && raw.wclClientSecret) save();
  return get();
}

/** API credentials: printable characters only, no whitespace. */
function credential(value) {
  const v = String(value ?? '').trim();
  return /^[\x21-\x7e]{1,200}$/.test(v) ? v : '';
}

function sanitize(s, validLocales) {
  return {
    tooltipLocale: validLocales.includes(Number(s.tooltipLocale)) ? Number(s.tooltipLocale) : DEFAULTS.tooltipLocale,
    defaultRegion: REGIONS.includes(s.defaultRegion) ? s.defaultRegion : DEFAULTS.defaultRegion,
    defaultSize: SIZES.includes(Number(s.defaultSize)) ? Number(s.defaultSize) : DEFAULTS.defaultSize,
    wclClientId: credential(s.wclClientId),
    wclClientSecret: credential(s.wclClientSecret),
    updates: UPDATE_MODES.includes(s.updates) ? s.updates : DEFAULTS.updates,
  };
}

/** What goes into settings.json: the secret only in encrypted form when a vault is available. */
function serialize() {
  const { wclClientSecret, ...rest } = data;
  if (!wclClientSecret) return rest;
  if (vault) {
    try {
      return { ...rest, wclClientSecretEnc: vault.encrypt(wclClientSecret) };
    } catch {
      // fall through: keep the secret usable rather than losing it
    }
  }
  return { ...rest, wclClientSecret };
}

function save() {
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify(serialize(), null, 2));
  } catch {
    // settings still apply for this session
  }
}

/** All settings, including secrets (main process only). */
function get() {
  return { ...data };
}

/** Settings safe to hand to the window: the secret is replaced by whether one is saved. */
function getPublic() {
  const { wclClientSecret, ...rest } = data;
  return { ...rest, wclHasSecret: !!wclClientSecret };
}

function set(patch, validLocales = [0]) {
  data = sanitize({ ...data, ...patch }, validLocales);
  save();
  return get();
}

module.exports = { init, get, getPublic, set, DEFAULTS };

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = { tooltipLocale: 0, defaultRegion: 'world', defaultSize: 50, wclClientId: '', wclClientSecret: '' };
const REGIONS = ['world', 'us', 'eu', 'kr', 'tw'];
const SIZES = [25, 50, 100];

let file = null;
let data = { ...DEFAULTS };

function init(baseDir, validLocales = [0]) {
  file = path.join(baseDir, 'settings.json');
  try {
    data = sanitize({ ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }, validLocales);
  } catch {
    data = { ...DEFAULTS };
  }
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
  };
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
  if (file) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch {
      // settings still apply for this session
    }
  }
  return get();
}

module.exports = { init, get, getPublic, set, DEFAULTS };

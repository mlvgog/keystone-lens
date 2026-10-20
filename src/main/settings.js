'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = { tooltipLocale: 0, defaultRegion: 'world', defaultSize: 50 };
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

function sanitize(s, validLocales) {
  return {
    tooltipLocale: validLocales.includes(Number(s.tooltipLocale)) ? Number(s.tooltipLocale) : DEFAULTS.tooltipLocale,
    defaultRegion: REGIONS.includes(s.defaultRegion) ? s.defaultRegion : DEFAULTS.defaultRegion,
    defaultSize: SIZES.includes(Number(s.defaultSize)) ? Number(s.defaultSize) : DEFAULTS.defaultSize,
  };
}

function get() {
  return { ...data };
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

module.exports = { init, get, set, DEFAULTS };

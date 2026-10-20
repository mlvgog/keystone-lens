'use strict';

const { fetchJson, fetchText } = require('../http');
const cache = require('../cache');
const { parseSourceXml } = require('../itemInfo');

const BASE = 'https://nether.wowhead.com/tooltip';

/** Wowhead tooltip languages (locale ids used by the tooltip API). */
const LOCALES = [
  { id: 0, name: 'English' },
  { id: 3, name: 'Deutsch' },
  { id: 2, name: 'Français' },
  { id: 6, name: 'Español' },
  { id: 9, name: 'Italiano' },
  { id: 8, name: 'Português' },
  { id: 7, name: 'Русский' },
  { id: 1, name: '한국어' },
  { id: 4, name: '简体中文' },
];

let displayLocale = 0;

/** Language used for tooltips shown to the user. Data parsing always uses English. */
function setLocale(locale) {
  displayLocale = LOCALES.some((l) => l.id === locale) ? locale : 0;
}

function getLocale() {
  return displayLocale;
}

/** Item tooltip (name, quality, icon, tooltip HTML) for an exact item variant. */
async function getItemTooltip({ id, bonuses = [], ilvl }, { signal, locale = displayLocale } = {}) {
  const params = new URLSearchParams({ dataEnv: '1', locale: String(locale) });
  if (bonuses.length) params.set('bonus', bonuses.join(':'));
  if (ilvl) params.set('ilvl', String(ilvl));
  const url = `${BASE}/item/${id}?${params}`;
  return cache.cached('itemTooltip', url, async () => {
    try {
      const d = await fetchJson(url, { signal });
      return { name: d.name, quality: d.quality, icon: d.icon, tooltip: d.tooltip || '' };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      return { name: null, quality: null, icon: null, tooltip: '', error: err.message };
    }
  });
}

/** Spell tooltip (used for talent descriptions). */
async function getSpellTooltip(spellId, { signal, locale = displayLocale } = {}) {
  const url = `${BASE}/spell/${spellId}?dataEnv=1&locale=${locale}`;
  return cache.cached('spellTooltip', url, async () => {
    const d = await fetchJson(url, { signal });
    return { name: d.name, icon: d.icon, tooltip: d.tooltip || '' };
  });
}

/** Where an item comes from: `{ source: [codes], more: [...] }` from wowhead's item XML. */
async function getItemSource(id, { signal } = {}) {
  const url = `https://www.wowhead.com/item=${id}&xml`;
  return cache.cached('itemSource', url, async () => {
    try {
      return parseSourceXml(await fetchText(url, { signal }));
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      return { source: [], more: [], error: err.message };
    }
  });
}

module.exports = { LOCALES, setLocale, getLocale, getItemTooltip, getSpellTooltip, getItemSource };

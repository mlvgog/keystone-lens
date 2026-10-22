'use strict';

const { fetchText } = require('../http');
const cache = require('../cache');
const { parseItemXml } = require('../itemInfo');

/**
 * Wowhead, used only the ways Wowhead offers it to other sites (www.wowhead.com/tooltips):
 * - the documented item XML (www.wowhead.com/item=ID&xml) for where an item drops and its type;
 * - the official tooltips script for hover tooltips, which runs in the window (wowhead-frame.html).
 */

/** Tooltip languages: the Wowhead domain each one uses with the tooltips script. */
const LOCALES = [
  { id: 0, name: 'English', domain: '' },
  { id: 3, name: 'Deutsch', domain: 'de' },
  { id: 2, name: 'Français', domain: 'fr' },
  { id: 6, name: 'Español', domain: 'es' },
  { id: 9, name: 'Italiano', domain: 'it' },
  { id: 8, name: 'Português', domain: 'pt' },
  { id: 7, name: 'Русский', domain: 'ru' },
  { id: 1, name: '한국어', domain: 'ko' },
  { id: 4, name: '简体中文', domain: 'cn' },
];

/** Item facts from the item XML (see itemInfo.parseItemXml); cached for a week. */
async function getItemXml(id, { signal } = {}) {
  const url = `https://www.wowhead.com/item=${id}&xml`;
  // v3: parsed with item type, boss, name, quality, icon and set (older entries had less).
  return cache.cached('itemSource', `${url}|v3`, async () => {
    try {
      return parseItemXml(await fetchText(url, { signal }));
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      return { ...parseItemXml(''), error: err.message };
    }
  });
}

module.exports = { LOCALES, getItemXml };

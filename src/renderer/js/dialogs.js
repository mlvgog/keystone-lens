import { el, toast } from './util.js';
import { hideTooltip } from './tooltip.js';
import { attachAutocomplete, matchItems, fold } from './autocomplete.js';

const REPO_URL = 'https://github.com/mlvgog/keystone-lens';

const REGIONS = [
  ['eu', 'Europe (EU)'],
  ['us', 'Americas (US)'],
  ['kr', 'Korea (KR)'],
  ['tw', 'Taiwan (TW)'],
  ['cn', 'China (CN)'],
];

/** A WoW-styled modal window. Returns { close }. Escape or the X closes it. */
export function modal(title, body, { width = 460, onClose } = {}) {
  hideTooltip();
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const overlay = el(
    'div.modal-overlay',
    { onmousedown: (e) => e.target === overlay && close() },
    el(
      'div.modal.wow-panel',
      { style: { width: `${width}px` } },
      el('div.modal-title', el('span.wow-header', title), el('button.win-btn.close', { onclick: close, title: 'Close' }, '✕')),
      el('div.modal-body', body)
    )
  );
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return { close };
}

// Realm lists per region, loaded once per session (the main process caches them for a week).
const realmLists = new Map();
function realmsFor(region) {
  if (!realmLists.has(region)) realmLists.set(region, window.api.realms(region).catch(() => []));
  return realmLists.get(region);
}

/** The realm's English name if `typed` matches a known realm (English or localized), else null. */
async function knownRealm(region, typed) {
  const list = await realmsFor(region);
  const f = fold(typed);
  return list.find((r) => fold(r.name) === f || (r.altName && fold(r.altName) === f))?.name || null;
}

/**
 * "Compare with my character".
 * getSaved() -> remembered characters [{ region, realm, name, className, specName, lastUsed }]
 * classColor(className) -> css colour; onLoaded(character, who, { apply }); onForget(who); onStop()
 */
export function compareDialog({ getSaved, meta, classColor, onLoaded, onForget, onStop, active }) {
  const last = getSaved()[0];
  const region = el('select.wow-select', {}, REGIONS.map(([v, l]) => el('option', { value: v }, l)));
  region.value = last?.region || (meta.region !== 'world' ? meta.region : 'eu');
  const realm = el('input.wow-input', { placeholder: 'Start typing, e.g. Tarren Mill', value: '' });
  const name = el('input.wow-input', { placeholder: 'Character name', value: '' });
  const simcText = el('textarea.wow-textarea', { placeholder: 'In game, type /simc, copy all of the text and paste it here.', spellcheck: 'false', rows: 7 });
  const status = el('div.dialog-status');
  const load = el('button.wow-btn', 'Load character');
  const stop = active ? el('button.wow-btn', { onclick: () => { onStop(); dlg.close(); } }, 'Stop comparing') : null;

  // Two ways in: look the character up on raider.io, or paste a SimulationCraft export.
  let mode = last?.source === 'simc' ? 'simc' : 'rio';
  const modeButtons = [
    ['rio', 'Look up on raider.io'],
    ['simc', 'Paste from SimulationCraft'],
  ].map(([value, label]) => el('button.seg', { dataset: { mode: value }, onclick: () => setMode(value) }, label));
  const rioFields = el('div.dialog-form', el('label', 'Region', region), el('label', 'Realm', realm), el('label', 'Character', name));
  const simcFields = el(
    'div.dialog-form',
    simcText,
    el('p.faint.small', 'Uses exactly what you have equipped and talented, including crafted stats and catalysed items. Saved loadouts in the export can be compared too.')
  );
  function setMode(value) {
    mode = value;
    modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    rioFields.hidden = mode !== 'rio';
    simcFields.hidden = mode !== 'simc';
    load.textContent = mode === 'simc' ? 'Import' : 'Load character';
    status.textContent = '';
    setTimeout(() => (mode === 'simc' ? simcText : realm).focus(), 0);
  }

  // Saved characters: this class first, most recently used first.
  const savedRow = el('div.saved-chars');
  function renderSaved() {
    const list = [...getSaved()].sort(
      (a, b) => (b.className === meta.className) - (a.className === meta.className) || (b.lastUsed || 0) - (a.lastUsed || 0)
    );
    savedRow.replaceChildren(
      ...(list.length
        ? list.map((c) => {
            const other = c.className && c.className !== meta.className;
            const simc = c.source === 'simc';
            const forget = el('button.chip-x', { title: 'Forget this character' }, '✕');
            forget.addEventListener('click', (e) => {
              e.stopPropagation();
              onForget(c);
              renderSaved();
            });
            const chip = el(
              'div.saved-char',
              {
                title: other ? `${c.className} — this analysis is for ${meta.className}` : `Load ${c.name}${simc ? ' from the saved SimulationCraft export' : ''}`,
                onclick: () => {
                  if (simc) return importSimc(c.simc, c.loadout || 0);
                  setMode('rio');
                  region.value = c.region;
                  realm.value = c.realm;
                  name.value = c.name;
                  submit();
                },
              },
              el('span', { style: { color: classColor(c.className) } }, c.name),
              el('span.faint', ` ${c.realm} (${String(c.region).toUpperCase()})`),
              simc ? el('span.tag.simc', 'SimC') : null,
              forget
            );
            if (other) chip.classList.add('other-class');
            return chip;
          })
        : [el('span.faint', 'Characters you load are remembered here.')])
    );
  }
  renderSaved();

  /** A loaded character: apply it, or keep it for later when it is another class. */
  function loaded(c, who) {
    if (c.className !== meta.className) {
      status.className = 'dialog-status bad';
      status.textContent = `${c.name} is a ${c.className}; this analysis is for ${meta.className}. (Saved for when you look at ${c.className}s.)`;
      onLoaded(c, who, { apply: false });
      renderSaved();
      return;
    }
    onLoaded(c, who, { apply: true });
    dlg.close();
  }

  async function importSimc(text, loadout = 0) {
    if (!String(text || '').trim()) {
      status.className = 'dialog-status bad';
      status.textContent = 'Paste the text from /simc first.';
      return;
    }
    load.disabled = true;
    status.className = 'dialog-status';
    status.textContent = 'Reading the SimulationCraft export…';
    const res = await window.api.importSimc(text, { loadout });
    load.disabled = false;
    if (!res.ok) {
      status.className = 'dialog-status bad';
      status.textContent = res.error || 'Could not read that export.';
      return;
    }
    const c = res.character;
    loaded(c, { source: 'simc', simc: text, loadout: c.loadout, region: c.region, realm: c.realm, name: c.name });
  }

  async function submit() {
    if (mode === 'simc') return importSimc(simcText.value);
    const typedRealm = realm.value.trim();
    const who = { region: region.value, realm: typedRealm, name: name.value.trim() };
    if (!who.realm || !who.name) {
      status.className = 'dialog-status bad';
      status.textContent = 'Enter a realm and a character name.';
      return;
    }
    const canonical = await knownRealm(who.region, typedRealm);
    const list = await realmsFor(who.region);
    if (canonical) who.realm = canonical;
    load.disabled = true;
    status.className = 'dialog-status';
    status.textContent = 'Looking up your character on raider.io…';
    const res = await window.api.loadCharacter(who);
    load.disabled = false;
    if (!res.ok) {
      status.className = 'dialog-status bad';
      status.textContent =
        !canonical && list.length
          ? `"${typedRealm}" is not a ${who.region.toUpperCase()} realm — pick one from the suggestions.`
          : res.error || 'Could not load that character.';
      return;
    }
    loaded(res.character, who);
  }

  // Realm suggestions for the selected region (English or localized names).
  attachAutocomplete(realm, {
    source: async (q) => matchItems(await realmsFor(region.value), q, (r) => [r.name, r.altName]),
    render: (r) => [el('span', r.name), r.altName ? el('span.faint', `  ${r.altName}`) : null],
    onPick: (r) => {
      realm.value = r.name;
      status.textContent = '';
      name.focus();
    },
  });
  // Name suggestions from remembered raider.io characters (fills in region and realm too).
  attachAutocomplete(name, {
    source: (q) => matchItems(getSaved().filter((c) => c.source !== 'simc'), q, (c) => [c.name]),
    render: (c) => [el('span', { style: { color: classColor(c.className) } }, c.name), el('span.faint', `  ${c.realm} (${String(c.region).toUpperCase()})`)],
    onPick: (c) => {
      region.value = c.region;
      realm.value = c.realm;
      name.value = c.name;
      load.focus();
    },
  });
  region.addEventListener('change', () => realmsFor(region.value));
  realmsFor(region.value); // warm up the list while the user types

  load.addEventListener('click', submit);
  for (const input of [realm, name]) input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

  const dlg = modal(
    'Compare with my character',
    el(
      'div.dialog-form',
      el('p.dim', 'Your talents and gear are shown on top of what the top players use: looked up on raider.io, or pasted from the SimulationCraft addon.'),
      el('div.saved-label.fb-label', 'Saved characters'),
      savedRow,
      el('div.dialog-sep'),
      el('div.segmented.compare-modes', modeButtons),
      rioFields,
      simcFields,
      status,
      el('div.dialog-buttons', stop, load)
    ),
    { width: 560 }
  );
  setMode(mode);
}

function formatBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Settings window. `onChanged(settings, { localeChanged })` runs after every change. */
export async function settingsDialog({ onChanged }) {
  const { settings, locales, version } = await window.api.getSettings();
  const lang = el('select.wow-select', {}, locales.map((l) => el('option', { value: String(l.id) }, l.name)));
  lang.value = String(settings.tooltipLocale);
  const region = el(
    'select.wow-select',
    {},
    [['world', 'World'], ['us', 'Americas (US)'], ['eu', 'Europe (EU)'], ['kr', 'Korea (KR)'], ['tw', 'Taiwan (TW)']].map(([v, l]) => el('option', { value: v }, l))
  );
  region.value = settings.defaultRegion;
  const size = el('select.wow-select', {}, [25, 50, 100].map((n) => el('option', { value: String(n) }, `Top ${n}`)));
  size.value = String(settings.defaultSize);

  const cacheLine = el('span.dim', 'Calculating…');
  const clearBtn = el('button.wow-btn.small', 'Clear cache');
  let armed = false;
  const refreshInfo = async () => {
    const info = await window.api.cacheInfo();
    cacheLine.textContent = `${formatBytes(info.bytes)} in ${info.files} files`;
  };
  clearBtn.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      clearBtn.textContent = 'Click again to confirm';
      return;
    }
    clearBtn.disabled = true;
    const info = await window.api.clearCache();
    cacheLine.textContent = `${formatBytes(info.bytes)} in ${info.files} files`;
    clearBtn.textContent = 'Cache cleared';
    toast('Cache cleared — the next search downloads fresh data');
  });
  refreshInfo();

  const save = async (patch) => {
    const before = settings.tooltipLocale;
    const next = await window.api.setSettings(patch);
    Object.assign(settings, next);
    onChanged(next, { localeChanged: next.tooltipLocale !== before });
  };
  lang.addEventListener('change', () => save({ tooltipLocale: Number(lang.value) }));
  region.addEventListener('change', () => save({ defaultRegion: region.value }));
  size.addEventListener('change', () => save({ defaultSize: Number(size.value) }));

  // Warcraft Logs API client (for damage / healing numbers). The secret is never sent back here.
  const wclId = el('input.wow-input', { placeholder: 'Client ID', value: settings.wclClientId || '' });
  const wclSecret = el('input.wow-input', { type: 'password', placeholder: settings.wclHasSecret ? '•••••••• (saved)' : 'Client secret' });
  const wclStatus = el('div.dialog-status');
  const setWclStatus = (text, cls = '') => {
    wclStatus.className = `dialog-status ${cls}`;
    wclStatus.textContent = text;
  };
  setWclStatus(
    settings.wclClientId && settings.wclHasSecret ? 'Saved. Use “Save & test” to check the connection.' : 'Needed for damage and healing numbers.'
  );
  const testWcl = async () => {
    setWclStatus('Connecting to Warcraft Logs…');
    const res = await window.api.wclTest();
    if (res.ok) {
      const l = res.limits || {};
      setWclStatus(`✔ Connected — ${Math.round(l.pointsSpentThisHour || 0)} of ${l.limitPerHour ?? '?'} API points used this hour.`, 'good');
    } else {
      setWclStatus(res.error || 'Could not connect.', 'bad');
    }
  };
  const wclSave = el('button.wow-btn.small', 'Save & test');
  wclSave.addEventListener('click', async () => {
    const patch = { wclClientId: wclId.value.trim() };
    if (wclSecret.value.trim()) patch.wclClientSecret = wclSecret.value.trim();
    await save(patch);
    wclSecret.value = '';
    wclSecret.placeholder = settings.wclHasSecret ? '•••••••• (saved)' : 'Client secret';
    if (!settings.wclClientId || !settings.wclHasSecret) return setWclStatus('Enter both the client ID and the client secret.', 'bad');
    testWcl();
  });
  const wclRemove = el('button.wow-btn.small', 'Remove');
  wclRemove.addEventListener('click', async () => {
    await save({ wclClientId: '', wclClientSecret: '' });
    wclId.value = '';
    wclSecret.placeholder = 'Client secret';
    setWclStatus('Removed.');
  });
  wclSecret.addEventListener('keydown', (e) => e.key === 'Enter' && wclSave.click());
  const wclLink = el(
    'button.link-btn',
    { onclick: () => window.api.openExternal('https://www.warcraftlogs.com/api/clients/') },
    'Get a free API client'
  );

  const dev = el(
    'button.wow-btn.small',
    {
      title: 'Data gathered per source, cache contents and recent requests (Ctrl+Shift+D)',
      onclick: () => {
        dlg.close();
        devDialog();
      },
    },
    'Developer…'
  );

  const dlg = modal(
    'Settings',
    el(
      'div.dialog-form',
      el('label', 'Tooltip language', lang),
      el('p.faint.small', 'Item and talent tooltips come from Wowhead in this language. Item names in lists stay in English.'),
      el('label', 'Default region', region),
      el('label', 'Default number of players', size),
      el('div.dialog-sep'),
      el('div.setting-row', el('span', 'Cache: ', cacheLine), clearBtn),
      el('p.faint.small', 'Key snapshots are kept forever because they never change; everything else refreshes automatically. Your trend history and settings are not affected.'),
      el('div.dialog-sep'),
      el('div.setting-row', el('div.wow-header', 'Warcraft Logs'), wclLink),
      el('label', 'Client ID', wclId),
      el('label', 'Client secret', wclSecret),
      wclStatus,
      el('div.dialog-buttons', wclRemove, wclSave),
      el('p.faint.small', 'Stored only on this PC (the secret encrypted for your Windows account) and only sent to warcraftlogs.com. Warcraft Logs data is never saved to disk.'),
      el('div.dialog-sep'),
      el(
        'div.about',
        el('div.setting-row', el('div.wow-header', `About · Keystone Lens ${version}`), dev),
        el(
          'p.dim.small',
          'Players, keys and talent/gear snapshots: raider.io · Tooltips and item sources: Wowhead · Talent trees and item stats: SimulationCraft and wago.tools game data · Damage and healing: Warcraft Logs.'
        ),
        el(
          'p.dim.small',
          el('button.link-btn', { onclick: () => window.api.openExternal(REPO_URL) }, 'Source code and releases on GitHub'),
          ' · free and open source (MIT)'
        ),
        el(
          'p.faint.small',
          'Not affiliated with or endorsed by Blizzard Entertainment, raider.io, Wowhead, Warcraft Logs, SimulationCraft or wago.tools. World of Warcraft and Warcraft are trademarks or registered trademarks of Blizzard Entertainment, Inc.'
        )
      )
    ),
    { width: 540 }
  );
}

const KIND_LABELS = {
  run: 'Key snapshots (talents + gear)',
  rankings: 'Top keys (players found)',
  profile: 'Player scores & keys',
  character: 'Compared characters',
  season: 'Season, dungeon & raid lists',
  realms: 'Realm lists',
  itemData: 'Item stat allocations',
  itemBonus: 'Item bonus IDs',
  gameTables: 'Item-level scaling tables',
  itemSource: 'Item sources',
  talents: 'Talent trees',
  analysis: 'Finished analyses',
  browserCache: 'Icons & images (browser cache)',
  wclZone: 'Warcraft Logs season data (memory only)',
  wclRankings: 'Warcraft Logs runs, spec (memory only)',
  wclCharacter: 'Warcraft Logs runs, you (memory only)',
  wclRaid: 'Warcraft Logs raid kills (memory only)',
  enchantName: 'Enchant names',
};

function sum(list, pick) {
  return list.reduce((s, x) => s + pick(x), 0);
}

/** Developer menu: data gathered per source, cache contents and the latest requests. Live. */
let devOpen = false;
export function devDialog() {
  if (devOpen) return;
  devOpen = true;
  const body = el('div.dev', el('div.faint', 'Loading…'));
  let timer = null;
  let armedReset = false;
  let armedClear = false;

  const resetBtn = el('button.wow-btn.small', 'Reset all-time counters');
  resetBtn.addEventListener('click', async () => {
    if (!armedReset) {
      armedReset = true;
      resetBtn.textContent = 'Click again to reset';
      return;
    }
    armedReset = false;
    resetBtn.textContent = 'Reset all-time counters';
    await window.api.devReset();
    refresh();
  });
  const clearBtn = el('button.wow-btn.small', 'Clear cache');
  clearBtn.addEventListener('click', async () => {
    if (!armedClear) {
      armedClear = true;
      clearBtn.textContent = 'Click again to clear';
      return;
    }
    armedClear = false;
    clearBtn.textContent = 'Clear cache';
    await window.api.clearCache();
    toast('Cache cleared');
    refresh();
  });
  const buttons = el(
    'div.dialog-buttons',
    resetBtn,
    clearBtn,
    el('button.wow-btn.small', { onclick: () => window.api.devOpenFolder() }, 'Open data folder'),
    el('button.wow-btn.small', { onclick: () => window.api.devOpenDevTools() }, 'Open DevTools')
  );

  function sourcesTable(s) {
    const rows = s.sources.filter((x) => x.session.requests || x.lifetime.requests || x.disk.files);
    const total = (pick) => sum(rows, pick);
    const row = (label, x, cls = '') =>
      el(
        `tr${cls}`,
        el('td.k', label),
        el('td.num', String(x.sessionReq)),
        el('td.num.faint', String(x.lifeReq)),
        el('td.num.big', formatBytes(x.sessionBytes)),
        el('td.num.faint', formatBytes(x.lifeBytes)),
        el('td.num', x.avgMs != null ? `${x.avgMs} ms` : ''),
        el('td.num', x.errors || x.retries ? `${x.errors} / ${x.retries}` : '–'),
        el('td.num', `${formatBytes(x.diskBytes)}`, el('span.faint', ` · ${x.diskFiles}`))
      );
    return el(
      'table.dev-table',
      el(
        'thead',
        el(
          'tr',
          el('th', 'Source'),
          el('th.num', 'Requests'),
          el('th.num', 'all time'),
          el('th.num', 'Received'),
          el('th.num', 'all time'),
          el('th.num', 'Avg time'),
          el('th.num', 'Errors / retries'),
          el('th.num', 'Cached on disk · files')
        )
      ),
      el(
        'tbody',
        rows.map((x) =>
          row(x.source, {
            sessionReq: x.session.requests,
            lifeReq: x.lifetime.requests,
            sessionBytes: x.session.bytes,
            lifeBytes: x.lifetime.bytes,
            avgMs: x.session.requests ? x.session.avgMs : x.lifetime.requests ? x.lifetime.avgMs : null,
            errors: x.session.errors,
            retries: x.session.retries,
            diskBytes: x.disk.bytes,
            diskFiles: x.disk.files,
          })
        ),
        row(
          'Total',
          {
            sessionReq: total((x) => x.session.requests),
            lifeReq: total((x) => x.lifetime.requests),
            sessionBytes: total((x) => x.session.bytes),
            lifeBytes: total((x) => x.lifetime.bytes),
            avgMs: null,
            errors: total((x) => x.session.errors),
            retries: total((x) => x.session.retries),
            diskBytes: total((x) => x.disk.bytes),
            diskFiles: total((x) => x.disk.files),
          },
          '.total'
        )
      )
    );
  }

  function kindsTable(s) {
    return el(
      'table.dev-table',
      el('thead', el('tr', el('th', 'Cached data'), el('th', 'Source'), el('th.num', 'Files'), el('th.num', 'Size'), el('th.num', 'Hits / misses (session)'))),
      el(
        'tbody',
        s.kinds.map((k) =>
          el(
            'tr',
            el('td', KIND_LABELS[k.kind] || k.kind),
            el('td.faint', k.source),
            el('td.num', String(k.files)),
            el('td.num', formatBytes(k.bytes)),
            el('td.num', k.hits || k.misses ? `${k.hits} / ${k.misses}` : '–')
          )
        )
      )
    );
  }

  function recentTable(s) {
    if (!s.recent.length) return el('div.faint', 'No requests yet this session (everything came from the cache).');
    return el(
      'div.dev-recent',
      el(
        'table.dev-table',
        el('thead', el('tr', el('th', 'Time'), el('th', 'Source'), el('th', 'Request'), el('th.num', 'Status'), el('th.num', 'Size'), el('th.num', 'Time'))),
        el(
          'tbody',
          s.recent.slice(0, 40).map((r) =>
            el(
              r.error ? 'tr.err' : 'tr',
              el('td.faint', new Date(r.at).toLocaleTimeString()),
              el('td', r.source),
              el('td.path', { title: r.path }, r.path),
              el('td.num', r.error && !r.status ? 'failed' : String(r.status ?? '')),
              el('td.num', r.bytes ? formatBytes(r.bytes) : '–'),
              el('td.num', `${r.ms} ms`)
            )
          )
        )
      )
    );
  }

  async function refresh() {
    let s;
    try {
      s = await window.api.devStats();
    } catch {
      return;
    }
    if (!devOpen) return;
    const since = new Date(s.lifetimeSince).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const scroll = body.querySelector('.dev-recent')?.scrollTop || 0;
    body.replaceChildren(
      el('div.ov-sub', `Data gathered from each source — this session and all time (since ${since})`),
      sourcesTable(s),
      el('div.faint.small', 'Received = size of the data downloaded (uncompressed). Cached data is reused instead of downloading it again.'),
      el('div.ov-sub', 'Cache contents'),
      kindsTable(s),
      el('div.ov-sub', 'Recent requests'),
      recentTable(s),
      el('div.faint.small.dev-foot', `App ${s.versions.app} · Electron ${s.versions.electron} · Chrome ${s.versions.chrome} · Node ${s.versions.node} · Data: ${s.userData}`),
      buttons
    );
    const recent = body.querySelector('.dev-recent');
    if (recent) recent.scrollTop = scroll;
  }

  modal('Developer', body, {
    width: 900,
    onClose: () => {
      devOpen = false;
      clearInterval(timer);
    },
  });
  refresh();
  timer = setInterval(refresh, 2000);
}

import { el, toast } from './util.js';
import { hideTooltip } from './tooltip.js';
import { attachAutocomplete, matchItems, fold } from './autocomplete.js';

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
  const status = el('div.dialog-status');
  const load = el('button.wow-btn', 'Load character');
  const stop = active ? el('button.wow-btn', { onclick: () => { onStop(); dlg.close(); } }, 'Stop comparing') : null;

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
            const forget = el('button.chip-x', { title: 'Forget this character' }, '✕');
            forget.addEventListener('click', (e) => {
              e.stopPropagation();
              onForget(c);
              renderSaved();
            });
            const chip = el(
              'div.saved-char',
              {
                title: other ? `${c.className} — this analysis is for ${meta.className}` : `Load ${c.name}`,
                onclick: () => {
                  region.value = c.region;
                  realm.value = c.realm;
                  name.value = c.name;
                  submit();
                },
              },
              el('span', { style: { color: classColor(c.className) } }, c.name),
              el('span.faint', ` ${c.realm} (${String(c.region).toUpperCase()})`),
              forget
            );
            if (other) chip.classList.add('other-class');
            return chip;
          })
        : [el('span.faint', 'Characters you load are remembered here.')])
    );
  }
  renderSaved();

  async function submit() {
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
    const c = res.character;
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
  // Name suggestions from remembered characters (fills in region and realm too).
  attachAutocomplete(name, {
    source: (q) => matchItems(getSaved(), q, (c) => [c.name]),
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
      el('p.dim', 'Your current talents and gear (from raider.io) are shown on top of what the top players use.'),
      el('div.saved-label.fb-label', 'Saved characters'),
      savedRow,
      el('div.dialog-sep'),
      el('label', 'Region', region),
      el('label', 'Realm', realm),
      el('label', 'Character', name),
      status,
      el('div.dialog-buttons', stop, load)
    ),
    { width: 520 }
  );
  setTimeout(() => realm.focus(), 0);
}

function formatBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Settings window. `onChanged(settings, { localeChanged })` runs after every change. */
export async function settingsDialog({ onChanged }) {
  const { settings, locales } = await window.api.getSettings();
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
      el(
        'div.about',
        el('div.setting-row', el('div.wow-header', 'About'), dev),
        el('p.dim.small', 'Rankings, keys and talent/gear snapshots: raider.io · Talent tree layout: raidbots · Item and spell tooltips, item sources: Wowhead.'),
        el('p.faint.small', 'Not affiliated with Blizzard Entertainment, raider.io, raidbots or Wowhead.')
      )
    ),
    { width: 500 }
  );
}

const KIND_LABELS = {
  run: 'Key snapshots (talents + gear)',
  rankings: 'Rankings',
  profile: 'Recent keys',
  character: 'Compared characters',
  season: 'Season, dungeon & raid lists',
  realms: 'Realm lists',
  itemTooltip: 'Item tooltips',
  spellTooltip: 'Talent descriptions',
  itemSource: 'Item sources',
  talents: 'Talent trees',
  analysis: 'Finished analyses',
  browserCache: 'Icons & images (browser cache)',
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

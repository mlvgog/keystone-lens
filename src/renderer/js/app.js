import { el, clear, iconUrl, toast, pct } from './util.js';
import { hideTooltip } from './tooltip.js';
import { renderSpecPicker } from './specPicker.js';
import { renderProgress, castbar } from './progress.js';
import { renderTalents, pickMap, clearSpellCache } from './talentTree.js';
import { renderGear } from './gearView.js';
import { renderPlayers } from './playersView.js';
import { renderFilterBar } from './filterBar.js';
import { compareDialog, settingsDialog, devDialog } from './dialogs.js';

const viewEl = document.getElementById('view');
const tabs = document.getElementById('tabs');
const portrait = document.getElementById('portrait');
const titleSub = document.getElementById('title-sub');

const NO_FILTERS = { dungeon: null, hero: null, build: null, trendsSince: null };

const state = {
  classes: null,
  settings: null,
  opts: null, // the search being shown
  meta: null,
  tree: null,
  dungeonsLoaded: [],
  fromCache: false,
  view: null,
  filters: { ...NO_FILTERS },
  history: [],
  tab: 'talents',
  inspect: null, // player detail while inspecting one player
  character: null, // your character while comparing
  busy: false, // a dungeon is loading
};

let teardown = null;
let dom = null; // { header, banner, body } of the results screen

// ---------------------------------------------------------------- preferences (per-viewer convenience only)
const PREFS_KEY = 'mplus-inspector-prefs';
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}
function savePrefs(patch) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    // ignore
  }
}
const searchKey = (o) => [o.classSlug, o.specSlug, o.region, o.sampleSize, o.since || ''].join('|');
function rememberSearch(opts) {
  const prefs = loadPrefs();
  const recents = [opts, ...(prefs.recents || []).filter((r) => searchKey(r) !== searchKey(opts))].slice(0, 8);
  const { classSlug, specId, region, sampleSize, since } = opts;
  savePrefs({ last: opts, recents, picker: { classSlug, specId, region, sampleSize, since } });
}

// ---------------------------------------------------------------- window chrome
document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => window.api.windowControl(b.dataset.win)));
document.querySelector('.titlebar').addEventListener('dblclick', (e) => {
  if (!e.target.closest('.win-buttons')) window.api.windowControl('maximize');
});
document.querySelector('[data-action=settings]').addEventListener('click', () =>
  settingsDialog({
    onChanged: (settings, { localeChanged }) => {
      state.settings = settings;
      if (localeChanged) {
        clearSpellCache();
        if (state.view) refreshView();
      }
    },
  })
);

// Developer menu: Ctrl+Shift+D (also reachable from Settings).
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    devDialog();
  }
});

function setHeader(opts) {
  if (!opts) {
    portrait.hidden = true;
    titleSub.textContent = '';
    return;
  }
  portrait.hidden = false;
  portrait.querySelector('img').src = iconUrl(opts.specIcon);
  titleSub.replaceChildren(el('span', { style: { color: opts.color } }, `${opts.specName} ${opts.className}`));
}

function resetView() {
  hideTooltip();
  teardown?.();
  teardown = null;
  dom = null;
  clear(viewEl);
}

// ---------------------------------------------------------------- picker + progress
async function showPicker() {
  resetView();
  tabs.hidden = true;
  setHeader(null);
  if (!state.classes) {
    viewEl.append(el('div.progress-view', el('div.wow-header', { style: { fontSize: '18px' } }, 'Loading class data…')));
    try {
      state.classes = await window.api.listSpecs();
    } catch (err) {
      resetView();
      viewEl.append(
        el(
          'div.progress-view',
          el('div.progress-panel.inset', el('div.error-box', `Could not load talent data: ${err.message || err}`), el('button.wow-btn', { onclick: showPicker }, 'Retry'))
        )
      );
      return;
    }
    resetView();
  }
  const prefs = loadPrefs();
  renderSpecPicker(viewEl, state.classes, prefs.picker || {}, (opts) => openSearch(opts), {
    recents: prefs.recents || [],
    defaults: { region: state.settings?.defaultRegion, sampleSize: state.settings?.defaultSize },
  });
}

/** Recent searches open instantly from the cache (even if older than an hour). */
async function openSearch(opts) {
  const cached = await window.api.analyzeCached(opts);
  if (cached.ok) {
    applyResult(opts, cached.result);
    rememberSearch(opts);
    showResults();
    return;
  }
  startAnalysis(opts);
}

async function startAnalysis(opts, { force = false } = {}) {
  resetView();
  tabs.hidden = true;
  setHeader(opts);
  let cancelled = false;
  const prog = renderProgress(viewEl, opts, async () => {
    cancelled = true;
    await window.api.cancel();
    showPicker();
  });
  const off = window.api.onProgress((p) => p.kind !== 'dungeon' && prog.update(p));
  let res;
  try {
    res = await window.api.analyze(opts, { force });
  } finally {
    off();
  }
  if (cancelled || res.cancelled) return;
  if (!res.ok) {
    prog.showError(res.error || 'Unknown error', showPicker);
    return;
  }
  applyResult(opts, res.result);
  rememberSearch(opts);
  showResults();
}

function applyResult(opts, result) {
  state.opts = opts;
  state.meta = result.meta;
  state.tree = result.tree;
  state.dungeonsLoaded = result.dungeonsLoaded || [];
  state.fromCache = !!result.fromCache;
  state.view = result.view;
  state.filters = { ...NO_FILTERS };
  state.inspect = null;
  state.history = [];
  window.api.historyList().then((list) => {
    state.history = list;
    if (dom) renderHeader();
  });
  restoreCharacter();
}

// ---------------------------------------------------------------- remembered characters (compare)
const MAX_CHARACTERS = 12;
const charKey = (c) => `${c.region}|${String(c.realm).toLowerCase()}|${String(c.name).toLowerCase()}`;

/** Remembered characters, most recently used first (migrates the old single entry). */
function savedCharacters() {
  const prefs = loadPrefs();
  const list = prefs.characters || (prefs.character ? [{ ...prefs.character, lastUsed: 0 }] : []);
  return [...list].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
}

function rememberCharacter(who, character) {
  const entry = {
    region: who.region,
    realm: character.realm || who.realm,
    name: character.name || who.name,
    className: character.className,
    specName: character.activeSpecName,
    lastUsed: Date.now(),
  };
  const rest = savedCharacters().filter((c) => charKey(c) !== charKey(entry));
  savePrefs({ characters: [entry, ...rest].slice(0, MAX_CHARACTERS), character: undefined });
}

function forgetCharacter(c) {
  savePrefs({ characters: savedCharacters().filter((x) => charKey(x) !== charKey(c)) });
}

function classColor(className) {
  return state.classes?.find((c) => c.className === className)?.color || (className === state.meta?.className ? state.meta.color : '#c9c2ad');
}

/** While comparing, load the most recently used remembered character of this class. */
async function restoreCharacter() {
  const prefs = loadPrefs();
  if (!prefs.compareActive) {
    state.character = null;
    return;
  }
  if (state.character && state.character.className === state.meta.className) return;
  state.character = null;
  const mine = savedCharacters().find((c) => c.className === state.meta.className);
  if (!mine) return;
  const res = await window.api.loadCharacter(mine);
  if (res.ok && res.character.className === state.meta.className) {
    state.character = res.character;
    rememberCharacter(mine, res.character);
    if (dom) renderAll();
  }
}

// ---------------------------------------------------------------- results
function showResults() {
  resetView();
  setHeader({ ...state.opts, specIcon: state.meta.specIcon || state.opts.specIcon });
  const header = el('div.results-header-wrap');
  const banner = el('div.banner-area');
  const body = el('div.tab-body');
  viewEl.append(el('div.results', header, banner, body));
  dom = { header, banner, body };
  tabs.hidden = false;
  renderAll();
}

function renderAll() {
  renderHeader();
  renderBanner();
  renderTab();
}

function renderHeader() {
  if (!dom) return;
  const { meta, view } = state;
  const regionName = meta.region === 'world' ? 'World' : meta.region.toUpperCase();
  const current = view.sampleSize - view.fallbackCount;
  const facts = el(
    'div.facts',
    el('span', 'Top ', el('b', String(meta.requested)), ` · ${regionName}`),
    el('span', el('b', meta.season.name)),
    el('span', 'Patch ', el('b', meta.patch || '?'), meta.since ? ` · keys since ${meta.since}` : ''),
    view.dungeon
      ? el('span', el('b', String(view.baseSize)), ` players with a ${view.dungeon.name} key`)
      : el('span', el('b', String(current)), ' on current patch', view.fallbackCount ? [', ', el('b', String(view.fallbackCount)), ' older'] : ''),
    view.sampleSize !== view.baseSize ? el('span', 'showing ', el('b', String(view.sampleSize))) : null,
    state.fromCache ? el('span.badge.cached', `cached · ${new Date(meta.generatedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`) : null
  );
  dom.header.replaceChildren(
    el(
      'div.results-header',
      el('div', el('div.spec-title', { style: { color: meta.color } }, `${meta.specName} ${meta.className}`), facts),
      el('div.spacer'),
      el(
        'div.actions',
        el('button.wow-btn.small', { onclick: () => startAnalysis(state.opts, { force: true }), title: 'Fetch fresh rankings and keys', disabled: state.busy }, 'Refresh'),
        el('button.wow-btn.small', { onclick: showPicker, disabled: state.busy }, 'New search')
      )
    ),
    renderFilterBar(
      { meta, view, filters: state.filters, dungeonsLoaded: state.dungeonsLoaded, history: state.history, character: state.character, busy: state.busy },
      { onFilter: setFilters, onDungeon: selectDungeon, onCompare: openCompare, onStopCompare: stopCompare }
    )
  );
}

function renderBanner() {
  if (!dom) return;
  const parts = [];
  if (state.inspect) parts.push(inspectBanner(state.inspect));
  if (state.character) parts.push(compareBanner());
  dom.banner.replaceChildren(...parts);
}

function inspectBanner(p) {
  const link = (label, url) => (url ? el('button.link-btn', { onclick: () => window.api.openExternal(url) }, label) : null);
  return el(
    'div.banner.inspect-banner',
    el('span.wow-header', 'Inspecting'),
    el('span', { style: { color: state.meta.color } }, `#${p.rank} ${p.name}`),
    el('span.dim', `${p.realm} (${String(p.region).toUpperCase()})`),
    el('span', `+${p.run.level} ${p.run.dungeon}`),
    el('span.dim', `patch ${p.run.version || '?'}${p.fallback ? ' (older patch)' : ''} · ilvl ${p.itemLevel ? p.itemLevel.toFixed(1) : '?'}`),
    el('div.spacer'),
    el(
      'button.link-btn',
      {
        onclick: async () => {
          await window.api.copy(p.talents.loadoutText || '');
          toast(`Copied ${p.name}'s talent import string`);
        },
      },
      'Copy build'
    ),
    link('raider.io', p.links?.raiderio),
    link('Warcraft Logs', p.links?.wcl),
    link('Armory', p.links?.armory),
    el('button.wow-btn.small', { onclick: exitInspect }, '✕ Back to all players')
  );
}

/** How closely your character follows the most common choices. */
function compareStats() {
  const { character: c, view, tree } = state;
  const yours = pickMap(c.talents);
  const nodes = [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes.filter((n) => n.subTreeId === c.talents.heroSubTreeId)];
  let agree = 0;
  let total = 0;
  for (const n of nodes) {
    const s = view.talents.nodes[n.id];
    if (!s || !s.total || n.freeNode) continue;
    total++;
    const mine = yours.get(n.id);
    const majority = s.pct >= 0.5;
    if (!!mine !== majority) continue;
    if (mine && n.type === 'choice') {
      const top = Object.entries(s.entries).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (top && String(mine.entryId) !== top) continue;
    }
    agree++;
  }
  let slots = 0;
  let popular = 0;
  const slotNames = { rings: ['finger1', 'finger2'], trinkets: ['trinket1', 'trinket2'] };
  for (const g of view.gear) {
    const mine = (slotNames[g.key] || [g.key]).map((s) => c.items?.[s]?.id).filter(Boolean);
    if (!mine.length) continue;
    slots++;
    const top = g.items.slice(0, g.slots).map((x) => x.id);
    if (mine.every((id) => top.includes(id))) popular++;
  }
  return { talent: total ? agree / total : 0, slots, popular };
}

function compareBanner() {
  const c = state.character;
  const s = compareStats();
  const wrongSpec = c.talents.specId && c.talents.specId !== state.meta.specId;
  return el(
    'div.banner.compare-banner',
    el('span.wow-header', 'Comparing'),
    el('span', { style: { color: state.meta.color } }, c.name),
    el('span.dim', `${c.realm} (${String(c.region).toUpperCase()}) · ${c.activeSpecName || ''} · ilvl ${c.itemLevel ? c.itemLevel.toFixed(1) : '?'}`),
    el('span', 'Talents match the majority: ', el('b', pct(s.talent))),
    el('span', 'Gear: ', el('b', `${s.popular}/${s.slots}`), ' slots use the most popular item'),
    wrongSpec ? el('span.warn', `⚠ Your active spec is ${c.activeSpecName}, so your talents won't match this tree`) : null,
    el('div.spacer'),
    el('span.faint', '✔ = your pick · red ring = popular talent you skip · orange = unusual pick')
  );
}

function renderTab() {
  if (!dom) return;
  hideTooltip();
  teardown?.();
  teardown = null;
  tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
  const trendSnap = state.history.find((h) => h.id === state.filters.trendsSince);
  const ctx = {
    meta: state.meta,
    tree: state.tree,
    view: state.view,
    filters: state.filters,
    inspect: state.inspect,
    character: state.character,
    trendSince: trendSnap ? new Date(trendSnap.generatedAt).toLocaleDateString() : '',
    onFilter: setFilters,
    onInspect: inspectPlayer,
  };
  if (state.tab === 'talents') teardown = renderTalents(dom.body, ctx);
  else if (state.tab === 'gear') renderGear(dom.body, ctx);
  else renderPlayers(dom.body, ctx);
}

tabs.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    renderTab();
  })
);

// ---------------------------------------------------------------- filters, dungeons, inspect, compare
async function refreshView() {
  const res = await window.api.view(state.filters);
  if (!res.ok) {
    toast(res.error || 'Could not update the view');
    return;
  }
  state.view = res.view;
  if (state.inspect) {
    const detail = await window.api.playerDetail(state.inspect.index, state.filters.dungeon);
    if (!detail) toast(`${state.inspect.name} has no key for this selection`);
    state.inspect = detail;
  }
  renderAll();
}

function setFilters(patch) {
  const next = { ...state.filters, ...patch };
  // A build belongs to one hero tree and one dungeon sample.
  if ('dungeon' in patch && patch.dungeon !== state.filters.dungeon) next.build = null;
  if ('hero' in patch && next.build) {
    const b = state.view.builds.list.find((x) => x.id === next.build);
    if (b && patch.hero != null && b.heroSubTreeId !== patch.hero) next.build = null;
  }
  if (next.dungeon || next.hero != null || next.build) next.trendsSince = null;
  state.filters = next;
  refreshView();
}

async function selectDungeon(zoneId) {
  if (zoneId == null || state.dungeonsLoaded.includes(zoneId)) {
    setFilters({ dungeon: zoneId });
    return;
  }
  const dungeon = state.meta.dungeons.find((d) => d.id === zoneId);
  const bar = castbar('.small');
  bar.set(0, `Loading ${dungeon?.name || 'dungeon'} keys…`);
  const cancel = el('button.wow-btn.small', { onclick: () => window.api.cancel() }, 'Cancel');
  state.busy = true;
  renderHeader();
  dom.banner.prepend(el('div.banner.loading-banner', el('span.wow-header', dungeon?.name || 'Dungeon'), el('div.inline-bar', bar.bar), cancel));
  const off = window.api.onProgress((p) => {
    if (p.kind === 'dungeon') bar.set(p.overall, `${p.phase} · ${p.done}/${p.total || '?'}${p.label ? ` · ${p.label}` : ''}`);
  });
  let res;
  try {
    res = await window.api.loadDungeon(zoneId, { ...state.filters, build: null, trendsSince: null });
  } finally {
    off();
    state.busy = false;
  }
  if (res.ok) {
    state.dungeonsLoaded = res.dungeonsLoaded;
    state.filters = { ...state.filters, dungeon: zoneId, build: null, trendsSince: null };
    state.view = res.view;
    if (state.inspect) {
      state.inspect = await window.api.playerDetail(state.inspect.index, zoneId);
      if (!state.inspect) toast('That player has no key in this dungeon');
    }
  } else if (!res.cancelled) {
    toast(res.error || 'Could not load the dungeon');
  }
  renderAll();
}

async function inspectPlayer(index) {
  const detail = await window.api.playerDetail(index, state.filters.dungeon);
  if (!detail) return toast('No data for that player');
  state.inspect = detail;
  if (state.tab === 'players') state.tab = 'talents';
  renderAll();
}

function exitInspect() {
  state.inspect = null;
  renderAll();
}

async function openCompare() {
  if (!state.classes) state.classes = await window.api.listSpecs().catch(() => null); // for class colours
  compareDialog({
    getSaved: savedCharacters,
    meta: state.meta,
    classColor,
    active: !!state.character,
    onLoaded: (character, who, { apply = true } = {}) => {
      rememberCharacter(who, character);
      if (!apply) return;
      state.character = character;
      savePrefs({ compareActive: true });
      renderAll();
    },
    onForget: forgetCharacter,
    onStop: stopCompare,
  });
}

function stopCompare() {
  state.character = null;
  savePrefs({ compareActive: false });
  renderAll();
}

// ---------------------------------------------------------------- start-up: reopen the last results
(async function boot() {
  try {
    state.settings = (await window.api.getSettings()).settings;
  } catch {
    state.settings = null;
  }
  const last = loadPrefs().last;
  if (last) {
    const res = await window.api.analyzeCached(last);
    if (res.ok) {
      applyResult(last, res.result);
      showResults();
      return;
    }
  }
  showPicker();
})();

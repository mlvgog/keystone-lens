import { el, clear, relDate, toast } from './util.js';
import { attachTooltip } from './tooltip.js';

// Table state survives tab switches and filter changes.
const state = { sort: 'rank', dir: 1, search: '', region: 'all', minKey: 0 };

const COLUMNS = [
  { key: 'rank', label: 'Rank', num: true, value: (p) => p.rank },
  { key: 'name', label: 'Player', value: (p) => p.name.toLowerCase() },
  { key: 'realm', label: 'Realm', value: (p) => `${p.realm} ${p.region}`.toLowerCase() },
  { key: 'score', label: 'M+ Score', num: true, value: (p) => p.score, desc: true },
  { key: 'key', label: 'Key used for talents & gear', value: (p) => p.run.level * 1000 + (p.run.score || 0), desc: true },
  { key: 'keyScore', label: 'Key score', num: true, value: (p) => p.run.score || 0, desc: true },
  { key: 'played', label: 'Played', value: (p) => Date.parse(p.run.completedAt) || 0, desc: true },
  { key: 'patch', label: 'Patch', value: (p) => p.run.version || '' },
  { key: 'hero', label: 'Hero tree', value: (p) => p.heroName || '' },
  { key: 'build', label: 'Build', value: (p) => (p.buildIndex ? p.buildIndex : 999) },
  { key: 'ilvl', label: 'iLvl', num: true, value: (p) => p.itemLevel || 0, desc: true },
  { key: 'actions', label: '' },
];

// Raid mode: a player's kill on the boss (or their best-ranked kill when all bosses are shown).
const RAID_COLUMNS = (unit) => [
  { key: 'rank', label: 'Rank', num: true, value: (p) => p.run.rank },
  { key: 'name', label: 'Player', value: (p) => p.name.toLowerCase() },
  { key: 'realm', label: 'Realm', value: (p) => `${p.realm} ${p.region}`.toLowerCase() },
  { key: 'amount', label: unit, num: true, value: (p) => p.run.score || 0, desc: true },
  { key: 'kill', label: 'Kill used for talents & gear', value: (p) => p.run.dungeon || '' },
  { key: 'time', label: 'Fight time', num: true, value: (p) => p.run.duration || 0 },
  { key: 'played', label: 'Date', value: (p) => Date.parse(p.run.completedAt) || 0, desc: true },
  { key: 'hero', label: 'Hero tree', value: (p) => p.heroName || '' },
  { key: 'build', label: 'Build', value: (p) => (p.buildIndex ? p.buildIndex : 999) },
  { key: 'ilvl', label: 'iLvl', num: true, value: (p) => p.itemLevel || 0, desc: true },
  { key: 'actions', label: '' },
];

function fightTime(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function linkButton(label, url, title) {
  if (!url) return null;
  return el(
    'button.link-btn',
    {
      title,
      onclick: (e) => {
        e.stopPropagation();
        window.api.openExternal(url);
      },
    },
    label
  );
}

/**
 * Players tab. ctx: { meta, view, inspect, onInspect(index) }
 */
export function renderPlayers(container, ctx) {
  clear(container);
  const { meta, view, inspect, onInspect } = ctx;
  const raid = meta.mode === 'raid';
  const columns = raid ? RAID_COLUMNS(meta.metric === 'hps' ? 'HPS' : 'DPS') : COLUMNS;
  if (raid && !columns.some((c) => c.key === state.sort)) state.sort = 'rank';
  const buildIndex = Object.fromEntries(view.builds.list.map((b) => [b.id, b.index]));
  const all = view.players.map((p) => ({ ...p, buildIndex: p.buildId ? buildIndex[p.buildId] : null }));
  const regions = [...new Set(all.map((p) => p.region))].sort();
  const levels = all.map((p) => p.run.level).filter((l) => l != null);
  const minLevel = Math.min(...levels);
  const maxLevel = Math.max(...levels);

  const search = el('input.wow-input', { type: 'search', placeholder: 'Search name or realm…', value: state.search });
  const regionChips = el('div.chips');
  const keySel = el(
    'select.wow-select',
    {},
    el('option', { value: '0' }, 'Any key level'),
    Array.from({ length: Math.max(0, maxLevel - minLevel) }, (_, i) => minLevel + 1 + i).map((lvl) => el('option', { value: String(lvl) }, `+${lvl} or higher`))
  );
  keySel.value = String(state.minKey);
  if (keySel.value !== String(state.minKey)) {
    state.minKey = 0;
    keySel.value = '0';
  }
  const tbody = el('tbody');
  const thead = el('thead');
  const footer = el('div.table-footer.faint');

  function renderChips() {
    clear(regionChips);
    for (const r of ['all', ...regions]) {
      const chip = el('button.chip', { onclick: () => { state.region = r; renderChips(); renderRows(); } }, r === 'all' ? 'All regions' : r.toUpperCase());
      if (state.region === r) chip.classList.add('active');
      regionChips.append(chip);
    }
  }

  function renderHead() {
    clear(thead);
    thead.append(
      el(
        'tr',
        columns.map((c) => {
          const th = el(c.num ? 'th.num' : 'th', c.label);
          if (c.value) {
            th.classList.add('sortable');
            if (state.sort === c.key) th.append(el('span.sort-arrow', state.dir > 0 ? ' ▲' : ' ▼'));
            th.addEventListener('click', () => {
              if (state.sort === c.key) state.dir = -state.dir;
              else {
                state.sort = c.key;
                state.dir = c.desc ? -1 : 1;
              }
              renderHead();
              renderRows();
            });
          }
          return th;
        })
      )
    );
  }

  function raidRow(p, copy) {
    return el(
      'tr',
      { onclick: () => onInspect(p.index), title: 'Inspect this player’s talents and gear at this kill' },
      el('td.num', String(p.run.rank ?? '')),
      el('td', { style: { color: meta.color } }, p.name),
      el('td.dim', `${p.realm} (${String(p.region).toUpperCase()})`),
      el('td.num', p.run.score ? Math.round(p.run.score).toLocaleString() : ''),
      el('td', p.run.dungeon || ''),
      el('td.num.dim', fightTime(p.run.duration)),
      el('td.dim', relDate(p.run.completedAt)),
      el('td', p.heroName || ''),
      el('td.dim', p.buildIndex ? `Build ${p.buildIndex}` : 'unique'),
      el('td.num', p.itemLevel ? p.itemLevel.toFixed(1) : ''),
      el('td.actions', copy, linkButton('Log', p.run.url, 'Open this kill on Warcraft Logs'), linkButton('raider.io', p.links?.raiderio, 'Open raider.io profile'), linkButton('Armory', p.links?.armory, 'Open the Blizzard armory'))
    );
  }

  function renderRows() {
    const q = state.search.trim().toLowerCase();
    const col = columns.find((c) => c.key === state.sort) || columns[0];
    const rows = all
      .filter((p) => state.region === 'all' || p.region === state.region)
      .filter((p) => raid || !state.minKey || p.run.level >= state.minKey)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.realm.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = col.value(a);
        const vb = col.value(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * state.dir || a.rank - b.rank;
      });
    tbody.replaceChildren(
      ...rows.map((p) => {
        const copy = el('button.link-btn', { title: 'Copy this player’s talent import string' }, 'Copy build');
        copy.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!p.loadoutText) return toast('No import string for this player');
          await window.api.copy(p.loadoutText);
          toast(`Copied ${p.name}'s talent import string`);
        });
        const tr = raid
          ? raidRow(p, copy)
          : el(
          'tr',
          { onclick: () => onInspect(p.index), title: 'Inspect this player’s talents and gear' },
          el('td.num', String(p.rank)),
          el('td', { style: { color: meta.color } }, p.name),
          el('td.dim', `${p.realm} (${String(p.region).toUpperCase()})`),
          el('td.num', { style: { color: p.scoreColor || '#fff' } }, p.score.toFixed(1)),
          el('td', `+${p.run.level} ${p.run.dungeon}`),
          el('td.num', p.run.score != null ? p.run.score.toFixed(1) : ''),
          el('td.dim', relDate(p.run.completedAt)),
          el('td.dim', p.run.version || '?', p.fallback ? [' ', el('span.badge.fallback', 'older patch')] : null),
          el('td', p.heroName || ''),
          el('td.dim', p.buildIndex ? `Build ${p.buildIndex}` : 'unique'),
          el('td.num', p.itemLevel ? p.itemLevel.toFixed(1) : ''),
          el(
            'td.actions',
            copy,
            linkButton('raider.io', p.links?.raiderio, 'Open raider.io profile'),
            linkButton('Logs', p.links?.wcl, 'Open Warcraft Logs'),
            linkButton('Armory', p.links?.armory, 'Open the Blizzard armory')
          )
        );
        if (inspect?.index === p.index) tr.classList.add('selected');
        if (p.fallback && !raid) {
          attachTooltip(tr.children[7], () => el('div', el('div.tt-gold', 'No key on the current patch'), el('div.tt-grey', 'Talents and gear come from this player’s best key on an older patch.')));
        }
        return tr;
      })
    );
    footer.textContent = `Showing ${rows.length} of ${all.length} players · click a row to inspect that player`;
  }

  search.addEventListener('input', () => {
    state.search = search.value;
    renderRows();
  });
  keySel.addEventListener('change', () => {
    state.minKey = Number(keySel.value);
    renderRows();
  });

  renderChips();
  renderHead();
  renderRows();

  const toolbar = el('div.players-toolbar', search, regionChips, raid ? null : keySel);
  const wrap = el('div.players-wrap', el('div.inset', el('table.wow-table', thead, tbody)), footer);
  if (meta.skipped?.length && !view.dungeon) {
    wrap.append(
      el(
        'div.skipped.inset',
        el('div.wow-header', { style: { marginBottom: '6px' } }, `Skipped players (${meta.skipped.length})`),
        meta.skipped.map((s) => el('div', `#${s.rank} ${s.name} — ${s.realm} (${String(s.region).toUpperCase()}): ${s.reason}`))
      )
    );
  }
  container.append(toolbar, wrap);
}

import { el, iconImg, pct, relDate } from './util.js';
import { attachTooltip } from './tooltip.js';

/**
 * Filter bar under the results header.
 * s: { meta, view, filters, dungeonsLoaded, history, character, busy }
 * h: { onFilter(patch), onDungeon(zoneId|null), onCompare(), onStopCompare() }
 */
export function renderFilterBar(s, h) {
  const { meta, view, filters } = s;
  const bar = el('div.filter-bar');

  // Dungeon
  const dungeon = el(
    'select.wow-select',
    { disabled: s.busy, title: 'Use each player’s best key in one dungeon instead of their best key overall' },
    el('option', { value: '' }, 'All dungeons (best key)'),
    meta.dungeons.map((d) =>
      el('option', { value: String(d.id) }, `${d.name}${s.dungeonsLoaded.includes(d.id) ? '' : '  — click to load'}`)
    )
  );
  dungeon.value = filters.dungeon ? String(filters.dungeon) : '';
  dungeon.addEventListener('change', () => h.onDungeon(dungeon.value ? Number(dungeon.value) : null));
  bar.append(el('label.fb-group', el('span.fb-label', 'Dungeon'), dungeon));

  // Hero tree
  const heroes = el('div.segmented');
  const allBtn = el('button.seg', { onclick: () => h.onFilter({ hero: null }) }, 'All');
  if (filters.hero == null) allBtn.classList.add('active');
  heroes.append(allBtn);
  for (const hero of view.hero) {
    const btn = el('button.seg', { onclick: () => h.onFilter({ hero: hero.id }) }, iconImg(hero.icon, { cls: 'seg-icon' }), `${hero.name} `, el('b', pct(hero.pct)));
    if (filters.hero === hero.id) btn.classList.add('active');
    attachTooltip(btn, () =>
      el('div', el('div.tt-title', hero.name), el('div.tt-gold', `${hero.count} of ${view.baseSize} players (${pct(hero.pct)})`), el('div.tt-grey', 'Show talents and gear of these players only'))
    );
    heroes.append(btn);
  }
  bar.append(el('div.fb-group', el('span.fb-label', 'Hero tree'), heroes));

  // Active build
  if (filters.build) {
    const b = view.builds.list.find((x) => x.id === filters.build);
    bar.append(
      el(
        'button.fb-chip',
        { onclick: () => h.onFilter({ build: null }), title: 'Show all builds again' },
        `Build ${b ? b.index : '?'} · ${b ? b.size : 0} players  ✕`
      )
    );
  }

  // Changes over time
  const unfiltered = !filters.dungeon && filters.hero == null && !filters.build;
  const changes = el(
    'select.wow-select',
    {
      disabled: !s.history.length || !unfiltered,
      title: !s.history.length
        ? 'Run this search again on a later day to see what changed'
        : !unfiltered
          ? 'Changes are shown for all players only (clear the dungeon, hero and build filters)'
          : 'Compare pick rates with an earlier run of this search',
    },
    el('option', { value: '' }, s.history.length ? 'Changes: off' : 'Changes: no earlier data'),
    s.history.map((snap) =>
      el('option', { value: snap.id }, `vs ${relDate(snap.generatedAt)} ${new Date(snap.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${snap.patch || '?'})`)
    )
  );
  changes.value = filters.trendsSince || '';
  changes.addEventListener('change', () => h.onFilter({ trendsSince: changes.value || null }));
  bar.append(el('label.fb-group', el('span.fb-label', 'Trends'), changes));

  bar.append(el('div.spacer'));

  // Compare with my character
  if (s.character) {
    const c = s.character;
    bar.append(
      el(
        'div.fb-chip.you-chip',
        el('span.you-name', { onclick: () => h.onCompare(), title: 'Change character' }, `You: ${c.name}`),
        el('button.chip-x', { onclick: () => h.onStopCompare(), title: 'Stop comparing' }, '✕')
      )
    );
  } else {
    bar.append(el('button.wow-btn.small', { onclick: () => h.onCompare() }, 'Compare with my character'));
  }
  return bar;
}

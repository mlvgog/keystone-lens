import { el, iconImg, pct, qualityColor, fmtDelta, relDate } from './util.js';
import { raceCard } from './races.js';
import { attachTooltip } from './tooltip.js';
import { itemRef, spellRef } from './wowheadTooltip.js';

let open = true; // the Overview stays expanded/collapsed across re-renders

function card(title, ...body) {
  return el('div.ov-card.inset', el('div.ov-title.wow-header', title), ...body);
}

const statOrder = (order) => order.map((s, i) => [i ? el('span.faint', ' > ') : null, el('b', s)]);

/** Top players' stat distribution, and yours under it when comparing (`mine`: your character's profile). */
function statCard(profile, mine) {
  if (!profile) return card('Secondary stats', el('div.faint', 'Not enough item data.'));
  const yours = Object.fromEntries((mine?.stats || []).map((s) => [s.key, s]));
  // Comparing: bars show ratings (yours against the top players' average); otherwise shares.
  const size = (s) => (mine ? s.avg : s.share);
  const max = Math.max(...profile.stats.map(size), ...(mine?.stats || []).map(size));
  const sorted = [...profile.stats].sort((a, b) => b.share - a.share);
  return card(
    'Secondary stats',
    el('div.stat-order', statOrder(profile.order)),
    mine ? el('div.stat-order.you', el('span.you-label', 'You: '), statOrder(mine.order)) : null,
    sorted.map((s) => {
      const y = yours[s.key];
      const top = el(
        'div.stat-row',
        { title: `Average ${Math.round(s.avg)} rating · ${pct(s.minShare)}–${pct(s.maxShare)} across players` },
        el('span.stat-label', s.label),
        el('div.stat-bar', el(`i.s-${s.key}`, { style: { width: `${(size(s) / max) * 100}%` } })),
        el('span.stat-val', pct(s.share, 1)),
        el('span.faint.stat-avg', `${Math.round(s.avg)}`)
      );
      if (!y) return top;
      const delta = Math.round(y.avg) - Math.round(s.avg);
      return [
        top,
        el(
          'div.stat-row.you',
          { title: `You: ${Math.round(y.avg)} ${s.label} (${pct(y.share, 1)} of your secondary stats) · top players: ${Math.round(s.avg)} on average` },
          el('span.stat-label.faint', 'you'),
          el('div.stat-bar.you', el('i', { style: { width: `${(size(y) / max) * 100}%` } })),
          el('span.stat-val.you-val', `${Math.round(y.avg)}`),
          el(`span.stat-avg.${delta === 0 ? 'faint' : delta > 0 ? 'up' : 'down'}`, `${delta > 0 ? '▲' : delta < 0 ? '▼' : ''}${Math.abs(delta)}`)
        ),
      ];
    }),
    el(
      'div.faint.ov-note',
      mine
        ? `Rating on gear + gems (enchants excluded): top ${profile.players} players' average, and yours in cyan with the difference (▲ more, ▼ less). Percentages: share of all secondary stats.`
        : `Share of secondary stats on gear + gems (enchants excluded) · ${profile.players} players`
    )
  );
}

function enchantCard(summary, N) {
  if (!summary.enchants.length) return card('Enchants', el('div.faint', 'No enchants found.'));
  return card(
    'Enchants',
    el(
      'table.ov-table',
      el(
        'tbody',
        summary.enchants.map((e) =>
          el(
            'tr',
            el('td.k', e.label),
            el('td', e.top[0] ? e.top[0].name : ''),
            el('td.num', e.top[0] ? pct(e.top[0].count / N) : ''),
            el('td.faint', e.top[1] ? `${e.top[1].name} ${pct(e.top[1].count / N)}` : '')
          )
        )
      )
    )
  );
}

function gemCard(summary, N) {
  const emb = summary.embellishments;
  return card(
    'Gems & embellishments',
    el('div.ov-sub', `Gems · ${summary.gems.avgSockets.toFixed(1)} sockets per player on average`),
    summary.gems.top.map((g) => el('div.ov-line', el('span', g.name), el('span.num', String(g.count)))),
    el('div.ov-sub', `Embellishments · ${emb.withTwo}/${N} players have two`),
    emb.items.length
      ? emb.items.slice(0, 6).map((it) =>
          el(
            'div.ov-line',
            el('span', iconImg(it.icon, { cls: 'mini-icon' }), el('span', { style: { color: qualityColor(it.quality) } }, ` ${it.name}`)),
            el('span.num', pct(it.count / N))
          )
        )
      : el('div.faint', 'None detected')
  );
}

function tierCard(summary, N) {
  const t = summary.tier;
  return card(
    'Tier set & weapons',
    el('div.ov-sub', `4-piece ${t.four} · 2-piece ${t.two} · none ${t.none}`),
    t.slots.map((s) =>
      el(
        'div.stat-row',
        el('span.stat-label', s.label),
        el('div.stat-bar', el('i.s-tier', { style: { width: `${(s.count / (N || 1)) * 100}%` } })),
        el('span.stat-val', pct(s.count / (N || 1)))
      )
    ),
    el('div.ov-sub', 'Weapon setup'),
    summary.weapons.map((w) => el('div.ov-line', el('span', w.label), el('span.num', `${w.count} (${pct(w.count / N)})`)))
  );
}

const CONSUMABLES_NOTE = 'From the buffs at the boss pulls of runs logged with the Raider.IO client. Potions and weapon oils are not recorded there.';

/** One flask / food / rune option: icon, name and share, with the game's tooltip on hover. */
function consumableLine(o, kind, players) {
  const line = el('div.ov-line', el('span', iconImg(o.icon, { cls: 'mini-icon' }), el('span', ` ${o.name}`)), el('span.num', pct(o.share)));
  attachTooltip(
    line,
    () =>
      el(
        'div',
        el('div.tt-title', o.name),
        el('div.tt-gold', `Used by ${o.count} / ${players} top players (${pct(o.share)})`),
        kind.key === 'food' ? el('div.tt-grey', `${o.stat === 'Primary stat' ? 'Feasts and other food that raise the primary stat' : `Food that raises ${o.stat}`}`) : null
      ),
    // The item's tooltip for flasks and runes, the buff's for food (many dishes give it).
    { wowhead: () => (o.items?.length ? itemRef({ id: o.items[o.items.length - 1] }) : spellRef(o.id)) }
  );
  return line;
}

/** Flasks, food and augment runes of the players whose runs were logged (null in raid mode). */
function consumablesCard(c, N) {
  if (!c) return null;
  if (!c.players) {
    return card(
      'Consumables',
      el('div.faint', `None of these ${N} players' runs were logged with the Raider.IO client, so their flasks and food are not known.`)
    );
  }
  return card(
    'Consumables',
    c.kinds.map((k) => [
      el('div.ov-sub', `${k.label} · ${k.used}/${c.players} use one`),
      k.options.length ? k.options.slice(0, 3).map((o) => consumableLine(o, k, c.players)) : el('div.faint', 'None seen'),
    ]),
    c.incomplete ? el('div.warn', 'Some buffs could not be identified (the game data did not load). Refresh to try again.') : null,
    el('div.faint.ov-note', { title: CONSUMABLES_NOTE }, `From the logged runs of ${c.players} of ${c.total} players`)
  );
}

function trendsCard(ctx) {
  const { view, tree } = ctx;
  const t = view.trends;
  const nodeName = new Map([...tree.classNodes, ...tree.specNodes, ...tree.heroNodes].map((n) => [n.id, n.entries[0]?.name || n.name]));
  const itemName = new Map(view.gear.flatMap((g) => g.items.map((it) => [`${g.key}:${it.id}`, it])));
  const rows = t.biggest.map((b) => {
    const label =
      b.type === 'talent'
        ? el('span', el('span.faint', 'Talent  '), nodeName.get(b.id) || `#${b.id}`)
        : (() => {
            const it = itemName.get(`${b.group}:${b.id}`);
            return el('span', el('span.faint', 'Item  '), it ? el('span', { style: { color: qualityColor(it.quality) } }, it.name) : `item #${b.id} (no longer used)`);
          })();
    return el('div.ov-line', label, el(`span.delta.${b.delta > 0 ? 'up' : 'down'}`, fmtDelta(b.delta)));
  });
  return card(
    `Biggest changes since ${relDate(t.since)}`,
    rows.length ? rows : el('div.faint', 'Nothing changed by 5 points or more.'),
    el('div.faint.ov-note', `Earlier snapshot: patch ${t.sincePatch || '?'} · points = percentage of players`)
  );
}

/** Collapsible "Overview" block at the top of the Gear tab. */
export function renderGearOverview(ctx) {
  const { view } = ctx;
  const N = view.sampleSize;
  const s = view.gearSummary;
  const body = el(
    'div.ov-grid',
    view.trends ? trendsCard(ctx) : null,
    statCard(view.statProfile, ctx.character?.statProfile),
    raceCard(view.races, ctx.meta, ctx.character),
    consumablesCard(view.consumables, N),
    enchantCard(s, N),
    gemCard(s, N),
    tierCard(s, N)
  );
  body.hidden = !open;
  const toggle = el('button.more-btn', open ? 'Hide overview' : 'Show overview');
  toggle.addEventListener('click', () => {
    open = !open;
    body.hidden = !open;
    toggle.textContent = open ? 'Hide overview' : 'Show overview';
  });
  return el(
    'div.gear-overview',
    el(
      'div.gear-summary.inset',
      el('span', 'Average equipped item level: ', el('b', view.avgItemLevel ? view.avgItemLevel.toFixed(1) : '?')),
      el('span', 'Players: ', el('b', String(N))),
      el('span.faint', 'Hover an item for its full tooltip, enchant / gem breakdown and who uses it.'),
      el('span.spacer'),
      toggle
    ),
    body
  );
}

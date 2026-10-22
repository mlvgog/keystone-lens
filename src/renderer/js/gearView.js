import { el, iconImg, clear, pct, qualityColor, fmtDelta, sourceText } from './util.js';
import { attachTooltip } from './tooltip.js';
import { itemRef } from './wowheadTooltip.js';
import { renderGearOverview } from './gearSummary.js';

const LEFT = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist'];
const RIGHT = ['hands', 'waist', 'legs', 'feet', 'rings', 'trinkets'];
const WEAPONS = ['mainhand', 'offhand'];
const VISIBLE_ROWS = 6;

function ilvlText(ilvl) {
  if (ilvl.min === ilvl.max) return `Item Level ${ilvl.common}`;
  return `Item Level ${ilvl.min}–${ilvl.max} (mostly ${ilvl.common})`;
}

function sourceTag(source) {
  if (!source || source.kind === 'tier' || (source.kind === 'other' && source.label === 'Other')) return null;
  return el(`span.tag.src.src-${source.kind}`, { title: sourceText(source, true) }, sourceText(source));
}

function modsLine(enchants, gems) {
  const parts = [];
  if (enchants.length) parts.push(el('span', el('span.k', 'Enchant: '), enchants.map((e, i) => [i ? ', ' : '', e])));
  if (gems.length) parts.push(el('span', el('span.k', 'Gems: '), gems.map((g, i) => [i ? ', ' : '', g])));
  if (!parts.length) return null;
  return el('div.item-mods', parts.map((p, i) => [i ? '  ·  ' : '', p]));
}

const STAT_LABELS = { crit: 'Crit', haste: 'Haste', mastery: 'Mastery', vers: 'Vers' };

/** "141 Agility/Intellect · 100 Crit · 51 Mastery" from the item's game-table stats. */
function statsLine(details) {
  if (!details) return null;
  const parts = [];
  if (details.primary?.value) parts.push(el('span.prim', `${details.primary.value.toLocaleString('en-US')} ${details.primary.name}`));
  const secondary = Object.entries(details.stats || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  for (const [k, v] of secondary) parts.push(el('span', `${v.toLocaleString('en-US')} ${STAT_LABELS[k]}`));
  if (details.randomStats) {
    parts.push(el('span', { title: 'Rolled when the item dropped; hover the item for the tooltip.' }, `${details.randomStats} random secondary stat${details.randomStats > 1 ? 's' : ''}`));
  }
  if (details.sockets) parts.push(el('span.prim', `${details.sockets} socket${details.sockets > 1 ? 's' : ''}`));
  return parts.length ? el('div.item-stats', parts.map((p, i) => [i ? '  ·  ' : '', p])) : null;
}

/** The embellishment note of an item row (effects show in the hover tooltip). */
function detailLines(details) {
  return details?.embellished ? [el('div.item-effect', { style: { color: '#e6cc80' } }, 'Unique-Equipped: Embellished (2)')] : [];
}

function usageBox(item, sampleSize) {
  const box = el('div');
  box.append(el('div.tt-title', { style: { color: qualityColor(item.quality) } }, item.name));
  box.append(el('div.tt-gold', `Used by ${item.count} / ${sampleSize} players (${pct(item.pct)})`));
  box.append(el('div.tt-grey', `${ilvlText(item.ilvl)}${item.variant.ilvl ? ` · tooltip shows ilvl ${item.variant.ilvl}` : ''}`));
  if (item.source && item.source.kind !== 'other') box.append(el('div.tt-cyan', sourceText(item.source, true)));
  if (item.enchants.length) {
    box.append(el('div.tt-sep'), el('div.tt-gold', 'Enchants'));
    for (const e of item.enchants) box.append(el('div.tt-row', el('span.tt-green', e.name), el('span', String(e.count))));
  }
  if (item.gems.length) {
    box.append(el('div.tt-sep'), el('div.tt-gold', 'Gems'));
    for (const g of item.gems) box.append(el('div.tt-row', el('span.tt-green', g.name), el('span', String(g.count))));
  }
  const names = item.players.slice(0, 14).join(', ') + (item.players.length > 14 ? `, +${item.players.length - 14} more` : '');
  box.append(el('div.tt-sep'), el('div.tt-grey', names));
  return box;
}

function itemRow(item, sampleSize, extras) {
  const details = item.details;
  const color = qualityColor(item.quality);
  const meta = [ilvlText(item.ilvl)];
  if (details?.slotType) meta.push(details.slotType);

  const countBox = el(
    'div.item-count',
    el('div.n', String(item.count), el('small', ` /${sampleSize}`)),
    el('div.dim', pct(item.pct), extras.trend ? el(`span.delta.${extras.trend > 0 ? 'up' : 'down'}`, ` ${fmtDelta(extras.trend)}`) : null),
    el('div.pbar', el('i', { style: { width: `${Math.min(100, item.pct * 100)}%` } }))
  );
  const row = el(
    'div.item-row',
    el('div.item-icon', { style: { background: color } }, iconImg(item.icon), el('span.ilvl', String(item.ilvl.common))),
    el(
      'div.item-main',
      el(
        'div.item-name',
        { style: { color } },
        item.name,
        item.tier ? el('span.tag.tier', 'Tier') : null,
        sourceTag(item.source),
        extras.yours ? el('span.tag.you', 'YOU') : null
      ),
      el('div.item-meta', meta.join('  ·  ')),
      statsLine(details),
      ...detailLines(details),
      modsLine(
        item.enchants.slice(0, 2).map((e) => `${e.name} (${e.count})`),
        item.gems.slice(0, 3).map((g) => `${g.name} (${g.count})`)
      )
    ),
    countBox
  );
  if (extras.yours) row.classList.add('yours');
  attachTooltip(row, () => usageBox(item, sampleSize), { wowhead: () => itemRef({ id: item.id, ...item.variant }) });
  return row;
}

/** "You: ..." line for a slot when comparing with your character. */
function yourSlotLine(group, character) {
  const mine = group.slotNames.map((s) => character.items?.[s]).filter(Boolean);
  if (!mine.length) return el('div.your-slot', el('span.k', 'You: '), el('span.faint', 'nothing equipped'));
  return el(
    'div.your-slot',
    el('span.k', 'You: '),
    mine.map((it, i) => {
      const rank = group.items.findIndex((x) => x.id === it.id);
      const status =
        rank === 0 || (group.slots > 1 && rank === 1)
          ? el('span.ok', 'most popular ✔')
          : rank > 0
            ? el('span.meh', `used by ${pct(group.items[rank].pct)}`)
            : el('span.bad', 'not used by top players');
      const item = el('span.your-item', iconImg(it.icon, { cls: 'mini-icon' }), el('span', { style: { color: qualityColor(it.quality) } }, ` ${it.name} `), el('span.faint', `${it.ilvl} `));
      // Your exact item (bonus IDs, item level, gems) in Wowhead's tooltip.
      attachTooltip(
        item,
        () =>
          el(
            'div',
            el('div.tt-title', { style: { color: qualityColor(it.quality) } }, it.name),
            el('div.tt-gold', `Your item · item level ${it.ilvl}`),
            statsLine(it.details),
            ...detailLines(it.details)
          ),
        { wowhead: () => itemRef({ id: it.id, bonuses: it.bonuses, ilvl: it.ilvl, gems: (it.gems || []).map((g) => g.id) }) }
      );
      return [i ? el('span.faint', '  |  ') : null, item, status];
    })
  );
}

function slotPanel(group, ctx) {
  const { view, character } = ctx;
  const N = view.sampleSize;
  const panel = el('div.slot-panel.inset');
  const subtitle =
    group.slots > 1
      ? `${group.items.length} different items · counted once per player (2 slots each)`
      : `${group.items.length} different item${group.items.length === 1 ? '' : 's'}`;
  panel.append(el('div.slot-head', el('span.wow-header', group.label), el('span.dim', subtitle)));
  if (character) panel.append(yourSlotLine(group, character));

  const mineIds = new Set(character ? group.slotNames.map((s) => character.items?.[s]?.id).filter(Boolean) : []);
  const trendMap = view.trends?.items?.[group.key] || {};
  const rows = group.items.map((item) => itemRow(item, N, { yours: mineIds.has(item.id), trend: trendMap[item.id] || 0 }));
  const list = el('div');
  rows.forEach((r, i) => {
    if (i >= VISIBLE_ROWS && !r.classList.contains('yours')) r.hidden = true;
    list.append(r);
  });
  panel.append(list);

  if (group.empty > 0) {
    const text = group.key === 'offhand' ? 'No off-hand — two-handed weapon' : group.slots > 1 ? 'Empty slots' : 'Empty slot';
    panel.append(el('div.empty-row', `${text} `, el('span.n', `(${group.empty})`)));
  }
  const hiddenRows = rows.filter((r) => r.hidden);
  if (hiddenRows.length) {
    const btn = el('button.more-btn', `Show ${hiddenRows.length} more`);
    btn.addEventListener('click', () => {
      const expand = hiddenRows[0].hidden;
      hiddenRows.forEach((r) => (r.hidden = !expand));
      btn.textContent = expand ? 'Show less' : `Show ${hiddenRows.length} more`;
    });
    panel.append(btn);
  }
  if (!rows.length && !group.empty) panel.append(el('div.empty-row', 'No data'));
  return panel;
}

const SLOT_NAMES = {
  rings: ['finger1', 'finger2'],
  trinkets: ['trinket1', 'trinket2'],
};

function withSlotNames(group) {
  return { ...group, slotNames: SLOT_NAMES[group.key] || [group.key] };
}

/** One inspected player's own items, with how popular each one is among the top players. */
function playerSlotPanel(group, ctx) {
  const { inspect, view } = ctx;
  const panel = el('div.slot-panel.inset');
  panel.append(el('div.slot-head', el('span.wow-header', group.label)));
  const items = group.slotNames.map((s) => inspect.items[s]).filter(Boolean);
  if (!items.length) {
    panel.append(el('div.empty-row', group.key === 'offhand' ? 'No off-hand — two-handed weapon' : 'Empty'));
    return panel;
  }
  for (const it of items) {
    const color = qualityColor(it.quality);
    const popular = group.items.find((x) => x.id === it.id);
    const details = it.details;
    const meta = [`Item Level ${it.ilvl}`];
    if (details?.slotType) meta.push(details.slotType);
    const row = el(
      'div.item-row',
      el('div.item-icon', { style: { background: color } }, iconImg(it.icon), el('span.ilvl', String(it.ilvl))),
      el(
        'div.item-main',
        el('div.item-name', { style: { color } }, it.name, it.tier ? el('span.tag.tier', 'Tier') : null, sourceTag(it.source)),
        el('div.item-meta', meta.join('  ·  ')),
        statsLine(details),
        ...detailLines(details),
        modsLine(
          (it.enchants || []).map((e) => e.name.replace(/^Enchant [^-]+ - /, '')),
          (it.gems || []).map((g) => g.name)
        )
      ),
      el(
        'div.item-count',
        el('div.n', popular ? pct(popular.pct) : '0%'),
        el('div.dim', 'of top players'),
        el('div.pbar', el('i', { style: { width: `${Math.min(100, (popular?.pct || 0) * 100)}%` } }))
      )
    );
    attachTooltip(
      row,
      () =>
        el(
          'div',
          el('div.tt-title', { style: { color } }, it.name),
          el('div.tt-gold', popular ? `Used by ${popular.count} / ${view.sampleSize} top players (${pct(popular.pct)})` : 'Not used by any other sampled player'),
          it.source && it.source.kind !== 'other' ? el('div.tt-cyan', sourceText(it.source, true)) : null
        ),
      { wowhead: () => itemRef({ id: it.id, bonuses: it.bonuses, ilvl: it.ilvl, gems: (it.gems || []).map((g) => g.id) }) }
    );
    panel.append(row);
  }
  return panel;
}

/**
 * Gear tab. ctx: { meta, view, filters, inspect (player detail | null), character (| null) }
 */
export function renderGear(container, ctx) {
  clear(container);
  const { view, inspect } = ctx;
  if (!inspect && !view.sampleSize) {
    container.append(el('div.empty-state', 'No players match these filters.'));
    return;
  }
  const groups = view.gear.map(withSlotNames);
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  const panel = (k) => byKey[k] && (inspect ? playerSlotPanel(byKey[k], ctx) : slotPanel(byKey[k], ctx));

  const wrap = el('div.gear-wrap');
  if (inspect) {
    wrap.append(
      el(
        'div.gear-summary.inset',
        el('span', `${inspect.name}'s gear · equipped item level `, el('b', inspect.itemLevel ? inspect.itemLevel.toFixed(1) : '?')),
        el('span.faint', 'The bar shows how many of the top players use the same item.')
      )
    );
  } else {
    wrap.append(renderGearOverview(ctx));
  }
  wrap.append(
    el(
      'div.paperdoll',
      el('div.col', LEFT.map(panel)),
      el('div.col', RIGHT.map(panel)),
      el('div.weapons', WEAPONS.map(panel))
    )
  );
  container.append(wrap);
}

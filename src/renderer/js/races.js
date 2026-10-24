// The races the top players pick (a card in the Gear overview) and a small menu with each race's
// racial abilities for the spec's class (src/main/races.js).
import { el, iconImg, pct } from './util.js';
import { attachTooltip, hideTooltip } from './tooltip.js';
import { spellRef } from './wowheadTooltip.js';

const FACTION = { alliance: 'Alliance', horde: 'Horde', both: 'Alliance or Horde' };
const norm = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, '');

// Racials per class, loaded once per class: classId -> Promise<{ [raceKey]: [{ id, name, icon }] }>.
const racialsByClass = new Map();

function loadRacials(classId) {
  const key = classId || 0;
  if (!racialsByClass.has(key)) {
    const p = window.api.racials(classId).then((res) => {
      if (!res?.ok) throw new Error(res?.error || 'Could not load the racial abilities.');
      return res.racials;
    });
    p.catch(() => racialsByClass.delete(key)); // try again next time
    racialsByClass.set(key, p);
  }
  return racialsByClass.get(key);
}

let menu = null; // { node, anchor, close }

export function closeRacialsMenu() {
  menu?.close();
}

function place(node, anchor) {
  const r = anchor.getBoundingClientRect();
  const m = node.getBoundingClientRect();
  const left = Math.min(Math.max(6, r.left), window.innerWidth - m.width - 6);
  const below = r.bottom + 4;
  const top = below + m.height > window.innerHeight - 6 ? Math.max(6, r.top - m.height - 4) : below;
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

function spellRow(spell, race) {
  const row = el('div.racial-row', iconImg(spell.icon, { size: 22, cls: 'racial-icon' }), el('span', spell.name));
  attachTooltip(row, () => el('div', el('div.tt-title', spell.name), el('div.tt-grey', `${race.name} racial`)), { wowhead: () => spellRef(spell.id) });
  return row;
}

/** Open the racials menu of `race` under `anchor` (a row of the Races card). */
function openRacialsMenu(anchor, race, { classId, className }) {
  const reopen = menu?.anchor === anchor;
  closeRacialsMenu();
  if (reopen) return; // a second click on the same race closes it

  const list = el('div.racial-list', el('div.faint', 'Loading racial abilities…'));
  const node = el(
    'div.racials-menu.wow-panel',
    { role: 'dialog', 'aria-label': `${race.name} racial abilities` },
    el('div.racials-head', el('span.wow-header', race.name), el(`span.faction.f-${race.faction}`, FACTION[race.faction] || '')),
    el('div.faint.small', className ? `Racial abilities for ${className}s` : 'Racial abilities'),
    list
  );

  const fill = () => {
    list.replaceChildren(el('div.faint', 'Loading racial abilities…'));
    loadRacials(classId).then(
      (racials) => {
        const spells = racials[race.key] || [];
        list.replaceChildren(...(spells.length ? spells.map((s) => spellRow(s, race)) : [el('div.faint', 'No racial abilities found.')]));
        if (menu?.node === node) place(node, anchor);
      },
      (err) => {
        list.replaceChildren(el('div.dialog-status.bad', err.message), el('button.wow-btn.small', { onclick: fill }, 'Retry'));
      }
    );
  };

  const onDown = (e) => {
    if (!node.contains(e.target) && !anchor.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    if (menu?.node !== node) return;
    menu = null;
    hideTooltip();
    node.remove();
    anchor.classList.remove('open');
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', close);
  };
  menu = { node, anchor, close };
  anchor.classList.add('open');
  document.body.append(node);
  place(node, anchor);
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', close);
  fill();
}

/**
 * "Races" card for the Gear overview, or null when no race is known (raid mode, old data).
 * races: view.races; meta: { classId, className }; character: your character (its race is marked).
 */
export function raceCard(races, meta, character) {
  closeRacialsMenu();
  if (!races?.list?.length) return null;
  const max = Math.max(...races.list.map((r) => r.share));
  const yours = norm(character?.race);
  const rows = races.list.map((r) => {
    const mine = yours && norm(r.name) === yours;
    const row = el(
      'div.stat-row.race-row',
      { tabindex: '0', role: 'button', title: `${r.count} players · ${FACTION[r.faction] || ''} · click for racial abilities` },
      el(`span.stat-label.f-${r.faction}`, r.name, mine ? el('span.you-tag', 'You') : null),
      el('div.stat-bar', el(`i.r-${r.faction}`, { style: { width: `${(r.share / (max || 1)) * 100}%` } })),
      el('span.stat-val', pct(r.share)),
      el('span.faint.stat-avg', String(r.count))
    );
    const open = () => openRacialsMenu(row, r, meta);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    return row;
  });
  const missing = yours && !races.list.some((r) => norm(r.name) === yours) ? el('div.stat-order.you', el('span.you-label', 'You: '), character.race, ' (none of these players)') : null;
  const total = races.list.reduce((s, r) => s + r.count, 0) + (races.unknown || 0);
  return el(
    'div.ov-card.inset',
    el('div.ov-title.wow-header', 'Races'),
    rows,
    missing,
    el(
      'div.faint.ov-note',
      `Click a race for its racial abilities · ${total} players`,
      races.unknown ? ` · race unknown for ${races.unknown}` : ''
    )
  );
}

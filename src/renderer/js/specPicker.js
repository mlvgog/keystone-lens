import { el, iconImg, clear } from './util.js';

const REGIONS = [
  ['world', 'World'],
  ['us', 'Americas (US)'],
  ['eu', 'Europe (EU)'],
  ['kr', 'Korea (KR)'],
  ['tw', 'Taiwan (TW)'],
];
const SIZES = [25, 50, 100];
export const DIFFICULTIES = [
  [5, 'Mythic'],
  [4, 'Heroic'],
  [3, 'Normal'],
];

/** "World · Top 50" or "Mythic raid" for a search. */
export function searchLabel(r) {
  if (r.mode === 'raid') return `${DIFFICULTIES.find(([v]) => v === r.difficulty)?.[1] || 'Mythic'} raid`;
  return `${r.region === 'world' ? 'World' : r.region.toUpperCase()} · Top ${r.sampleSize}${r.since ? ` · since ${r.since}` : ''}`;
}

/**
 * Class / spec / options screen. Calls onStart(opts) when "Inspect" is pressed or a
 * recent search is clicked.
 * `prefs` = last used choices ({ mode, classSlug, specId, region, sampleSize, since, difficulty }),
 * `recents` = recent searches (full opts), `defaults` = { region, sampleSize } from settings,
 * `hasWcl` = a Warcraft Logs client is set up (raid mode needs it), `onSettings` opens Settings.
 */
export function renderSpecPicker(container, classes, prefs, onStart, { recents = [], defaults = {}, hasWcl = false, onSettings } = {}) {
  clear(container);
  let selectedClass = classes.find((c) => c.classSlug === prefs.classSlug) || null;
  let selectedSpec = selectedClass?.specs.find((s) => s.specId === prefs.specId) || null;
  let mode = prefs.mode === 'raid' ? 'raid' : 'mplus';

  const classGrid = el('div.class-grid.inset');
  const specRow = el('div.spec-row');
  const inspectBtn = el('button.wow-btn.big', { disabled: true }, 'Inspect');

  const regionSel = el('select.wow-select', {}, REGIONS.map(([v, label]) => el('option', { value: v }, label)));
  regionSel.value = prefs.region || defaults.region || 'world';
  const sizeSel = el('select.wow-select', {}, SIZES.map((n) => el('option', { value: String(n) }, `Top ${n}`)));
  sizeSel.value = String(prefs.sampleSize || defaults.sampleSize || 50);
  const sinceMode = el(
    'select.wow-select',
    {},
    el('option', { value: 'auto' }, 'Current patch (auto)'),
    el('option', { value: 'date' }, 'Keys since date…')
  );
  const sinceDate = el('input.wow-input', { type: 'date' });
  sinceMode.value = prefs.since ? 'date' : 'auto';
  sinceDate.value = prefs.since || '';
  sinceDate.hidden = sinceMode.value !== 'date';
  sinceMode.addEventListener('change', () => {
    sinceDate.hidden = sinceMode.value !== 'date';
    if (!sinceDate.hidden && !sinceDate.value) sinceDate.value = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  });
  const difficultySel = el('select.wow-select', {}, DIFFICULTIES.map(([v, label]) => el('option', { value: String(v) }, label)));
  difficultySel.value = String(prefs.difficulty || 5);

  // Mythic+ or the current raid tier.
  const modeButtons = [
    ['mplus', 'Mythic+'],
    ['raid', 'Raid'],
  ].map(([value, label]) => el('button.seg', { dataset: { mode: value }, onclick: () => setMode(value) }, label));
  const mplusOptions = [el('label', 'Region', regionSel), el('label', 'Players', sizeSel), el('label', 'Keys from', el('div.since-wrap', sinceMode, sinceDate))];
  const raidOptions = [el('label', 'Difficulty', difficultySel)];
  const wclHint = el(
    'div.raid-hint',
    'Raid mode uses Warcraft Logs (who logged the best kills of each boss, with their talents and gear). Add your free Warcraft Logs client in Settings first. ',
    el('button.wow-btn.small', { onclick: () => onSettings?.() }, 'Open Settings')
  );
  const mplusNote = el(
    'div.footnote.faint',
    'Players of the spec are found in this season’s top keys on raider.io and ranked by their Mythic+ score. For each, the talents and gear saved with their ',
    el('span.dim', 'highest-scoring key on the current patch'),
    ' are used. If a player has no key on the current patch, their best key overall is used instead. ',
    'Use “Keys since date” to ignore keys played before a tuning hotfix. Rarely played specs may have fewer players.'
  );
  const raidNote = el(
    'div.footnote.faint',
    'For every boss of the current raid, the top 100 logged kills of the spec on Warcraft Logs (by damage, or healing for healers), with each player’s talents and gear at that kill. ',
    'Pick a boss in the results to see what changes on it. Uses about 20–60 of your hourly Warcraft Logs points; nothing is saved to disk.'
  );

  function setMode(value) {
    mode = value;
    modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    mplusOptions.forEach((n) => (n.hidden = mode !== 'mplus'));
    raidOptions.forEach((n) => (n.hidden = mode !== 'raid'));
    mplusNote.hidden = mode !== 'mplus';
    raidNote.hidden = mode !== 'raid';
    wclHint.hidden = mode !== 'raid' || hasWcl;
    updateButton();
  }

  function updateButton() {
    inspectBtn.disabled = !selectedSpec || (mode === 'raid' && !hasWcl);
  }

  function renderClasses() {
    clear(classGrid);
    for (const c of classes) {
      const btn = el(
        'button.class-btn',
        { style: { color: c.color }, onclick: () => selectClass(c) },
        el('div.ring', iconImg(c.icon)),
        c.className
      );
      if (selectedClass === c) btn.classList.add('active');
      classGrid.append(btn);
    }
  }

  function renderSpecs() {
    clear(specRow);
    if (!selectedClass) {
      specRow.append(el('div.dim', { style: { alignSelf: 'center', fontSize: '15px' } }, 'Choose a class to see its specializations.'));
      return;
    }
    for (const s of selectedClass.specs) {
      const card = el(
        'div.spec-card',
        { onclick: () => selectSpec(s), ondblclick: () => { selectSpec(s); start(); } },
        iconImg(s.icon),
        el('div', { style: { color: selectedClass.color } }, s.specName),
        el(`span.role.${s.role}`, s.role === 'dps' ? 'DAMAGE' : s.role.toUpperCase())
      );
      if (selectedSpec === s) card.classList.add('active');
      specRow.append(card);
    }
  }

  function selectClass(c) {
    if (selectedClass !== c) selectedSpec = null;
    selectedClass = c;
    if (!selectedSpec && c.specs.length === 1) selectedSpec = c.specs[0];
    renderClasses();
    renderSpecs();
    updateButton();
  }

  function selectSpec(s) {
    selectedSpec = s;
    renderSpecs();
    updateButton();
  }

  function start() {
    if (inspectBtn.disabled || !selectedClass || !selectedSpec) return;
    const spec = {
      classSlug: selectedClass.classSlug,
      className: selectedClass.className,
      color: selectedClass.color,
      specSlug: selectedSpec.specSlug,
      specName: selectedSpec.specName,
      specId: selectedSpec.specId,
      specIcon: selectedSpec.icon,
    };
    if (mode === 'raid') {
      onStart({ ...spec, mode: 'raid', difficulty: Number(difficultySel.value), metric: selectedSpec.role === 'healer' ? 'hps' : 'dps', region: 'world' });
      return;
    }
    onStart({
      ...spec,
      region: regionSel.value,
      sampleSize: Number(sizeSel.value),
      since: sinceMode.value === 'date' && sinceDate.value ? sinceDate.value : null,
    });
  }
  inspectBtn.addEventListener('click', start);

  const recentRow = recents.length
    ? el(
        'div.recents',
        el('span.recents-label.wow-header', 'Recent'),
        recents.map((r) =>
          el(
            'button.recent-chip',
            { onclick: () => onStart(r), title: 'Open this search again' },
            iconImg(r.specIcon),
            el('span', { style: { color: r.color } }, `${r.specName} ${r.className}`),
            el('span.faint', searchLabel(r))
          )
        )
      )
    : null;

  container.append(
    el(
      'div.picker',
      recentRow,
      el('div.segmented.mode-switch', modeButtons),
      el('h2.wow-header', 'Choose a Class'),
      classGrid,
      specRow,
      el('div.options.inset', ...mplusOptions, ...raidOptions, inspectBtn),
      wclHint,
      mplusNote,
      raidNote
    )
  );
  renderClasses();
  renderSpecs();
  setMode(mode);
}

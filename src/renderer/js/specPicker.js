import { el, iconImg, clear } from './util.js';

const REGIONS = [
  ['world', 'World'],
  ['us', 'Americas (US)'],
  ['eu', 'Europe (EU)'],
  ['kr', 'Korea (KR)'],
  ['tw', 'Taiwan (TW)'],
];
const SIZES = [25, 50, 100];

/**
 * Class / spec / options screen. Calls onStart(opts) when "Inspect" is pressed or a
 * recent search is clicked.
 * `prefs` = last used choices ({ classSlug, specId, region, sampleSize, since }),
 * `recents` = recent searches (full opts), `defaults` = { region, sampleSize } from settings.
 */
export function renderSpecPicker(container, classes, prefs, onStart, { recents = [], defaults = {} } = {}) {
  clear(container);
  let selectedClass = classes.find((c) => c.classSlug === prefs.classSlug) || null;
  let selectedSpec = selectedClass?.specs.find((s) => s.specId === prefs.specId) || null;

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
    inspectBtn.disabled = !selectedSpec;
  }

  function selectSpec(s) {
    selectedSpec = s;
    renderSpecs();
    inspectBtn.disabled = false;
  }

  function start() {
    if (!selectedClass || !selectedSpec) return;
    onStart({
      classSlug: selectedClass.classSlug,
      className: selectedClass.className,
      color: selectedClass.color,
      specSlug: selectedSpec.specSlug,
      specName: selectedSpec.specName,
      specId: selectedSpec.specId,
      specIcon: selectedSpec.icon,
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
            el(
              'span.faint',
              `${r.region === 'world' ? 'World' : r.region.toUpperCase()} · Top ${r.sampleSize}${r.since ? ` · since ${r.since}` : ''}`
            )
          )
        )
      )
    : null;

  container.append(
    el(
      'div.picker',
      recentRow,
      el('h2.wow-header', 'Choose a Class'),
      classGrid,
      specRow,
      el(
        'div.options.inset',
        el('label', 'Region', regionSel),
        el('label', 'Players', sizeSel),
        el('label', 'Keys from', el('div.since-wrap', sinceMode, sinceDate)),
        inspectBtn
      ),
      el(
        'div.footnote.faint',
        'For each of the top-ranked Mythic+ players of the spec (raider.io), the talents and gear saved with their ',
        el('span.dim', 'highest-scoring key on the current patch'),
        ' are used. If a player has no key on the current patch, their best key overall is used instead. ',
        'Use “Keys since date” to ignore keys played before a tuning hotfix.'
      )
    )
  );
  renderClasses();
  renderSpecs();
  inspectBtn.disabled = !selectedSpec;
}

import { el, toast } from './util.js';
import { hideTooltip } from './tooltip.js';

const REGIONS = [
  ['eu', 'Europe (EU)'],
  ['us', 'Americas (US)'],
  ['kr', 'Korea (KR)'],
  ['tw', 'Taiwan (TW)'],
  ['cn', 'China (CN)'],
];

/** A WoW-styled modal window. Returns { close }. Escape or the X closes it. */
export function modal(title, body, { width = 460 } = {}) {
  hideTooltip();
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
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

/**
 * "Compare with my character". `saved` = last used { region, realm, name }.
 * `onLoaded(character, who)` is called after a successful lookup.
 */
export function compareDialog({ saved, meta, onLoaded, onStop, active }) {
  const region = el('select.wow-select', {}, REGIONS.map(([v, l]) => el('option', { value: v }, l)));
  region.value = saved?.region || (meta.region !== 'world' ? meta.region : 'eu');
  const realm = el('input.wow-input', { placeholder: 'Realm, e.g. Tarren Mill', value: saved?.realm || '' });
  const name = el('input.wow-input', { placeholder: 'Character name', value: saved?.name || '' });
  const status = el('div.dialog-status');
  const load = el('button.wow-btn', 'Load character');
  const stop = active ? el('button.wow-btn', { onclick: () => { onStop(); dlg.close(); } }, 'Stop comparing') : null;

  async function submit() {
    const who = { region: region.value, realm: realm.value.trim(), name: name.value.trim() };
    if (!who.realm || !who.name) {
      status.className = 'dialog-status bad';
      status.textContent = 'Enter a realm and a character name.';
      return;
    }
    load.disabled = true;
    status.className = 'dialog-status';
    status.textContent = 'Looking up your character on raider.io…';
    const res = await window.api.loadCharacter(who);
    load.disabled = false;
    if (!res.ok) {
      status.className = 'dialog-status bad';
      status.textContent = res.error || 'Could not load that character.';
      return;
    }
    const c = res.character;
    if (c.className !== meta.className) {
      status.className = 'dialog-status bad';
      status.textContent = `${c.name} is a ${c.className}; this analysis is for ${meta.className}.`;
      return;
    }
    onLoaded(c, who);
    dlg.close();
  }
  load.addEventListener('click', submit);
  for (const input of [realm, name]) input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

  const dlg = modal(
    'Compare with my character',
    el(
      'div.dialog-form',
      el('p.dim', 'Your current talents and gear (from raider.io) are shown on top of what the top players use.'),
      el('label', 'Region', region),
      el('label', 'Realm', realm),
      el('label', 'Character', name),
      status,
      el('div.dialog-buttons', stop, load)
    )
  );
  setTimeout(() => (saved?.name ? load.focus() : realm.focus()), 0);
}

function formatBytes(n) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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

  modal(
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
        el('div.wow-header', 'About'),
        el('p.dim.small', 'Rankings, keys and talent/gear snapshots: raider.io · Talent tree layout: raidbots · Item and spell tooltips, item sources: Wowhead.'),
        el('p.faint.small', 'Not affiliated with Blizzard Entertainment, raider.io, raidbots or Wowhead.')
      )
    ),
    { width: 500 }
  );
}

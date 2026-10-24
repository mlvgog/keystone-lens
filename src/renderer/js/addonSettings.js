// Settings → Game addon: the WoW folder, installing the addon, and the specs in its data
// (see src/main/addonSync.js).
import { el } from './util.js';

function ago(seconds) {
  if (!seconds) return 'never';
  const mins = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (mins < 2) return 'just now';
  if (mins < 90) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const regionLabel = (r) => (r === 'world' ? 'World' : String(r || '').toUpperCase());

/** The "Game addon" part of Settings. Returns { node, dispose }. */
export function addonSection({ autoRefresh, onAutoRefresh }) {
  const folder = el('div.addon-folder.dim', '…');
  const chooseBtn = el('button.wow-btn.small', 'Change…');
  const addonLine = el('div.dialog-status');
  const installBtn = el('button.wow-btn.small', { hidden: true }, 'Install addon');
  const auto = el('input', { type: 'checkbox' });
  auto.checked = autoRefresh;
  const specList = el('div.addon-specs');
  const syncLine = el('div.dialog-status');
  const writeBtn = el('button.wow-btn.small', { title: 'Write the data folder again, and read the characters the addon saved' }, 'Refresh');

  let status = null;
  const setLine = (node, text, cls = '') => {
    node.className = `dialog-status ${cls}`;
    node.textContent = text;
  };

  function render(s) {
    status = s;
    if (!s) return;
    folder.textContent = s.wowPath || 'World of Warcraft was not found. Choose its folder.';
    folder.title = s.wowPath || '';
    chooseBtn.textContent = s.wowPath ? 'Change…' : 'Choose…';

    const a = s.addon || {};
    installBtn.hidden = !a.action;
    installBtn.textContent = a.action === 'update' ? `Update to ${a.bundled}` : 'Install addon';
    if (!s.wowPath) setLine(addonLine, 'Choose the game folder to install the addon.');
    else if (!a.installed) setLine(addonLine, `Not installed. Install it here, or get "Keystone Lens" from CurseForge.`);
    else if (a.action === 'update') setLine(addonLine, `Version ${a.installed} installed; ${a.bundled} comes with this app.`);
    else setLine(addonLine, `✔ Version ${a.installed} installed.`, 'good');

    specList.replaceChildren(
      ...(s.specs.length
        ? s.specs.map((x) =>
            el(
              'div.addon-spec',
              el('span', `${x.specName} ${x.className}`),
              el(
                'span.faint',
                ` · ${regionLabel(x.region)} top ${x.sample} · ${x.dungeons}/${x.dungeonCount} dungeons · ${ago(x.time)}`
              ),
              el(
                'button.chip-x',
                {
                  title: 'Remove this spec from the addon',
                  onclick: async () => render((await window.api.addonRemoveSpec(x.specId)).status),
                },
                '✕'
              )
            )
          )
        : [el('span.faint', 'Specs you look at in the app appear here and in the addon.')])
    );

    const chars = s.characters || [];
    if (s.syncing) setLine(syncLine, `Updating ${s.syncing.label}…`);
    else if (s.lastError) setLine(syncLine, s.lastError, 'bad');
    else if (chars.length) setLine(syncLine, `Characters from the addon: ${chars.map((c) => c.name).join(', ')}.`);
    else setLine(syncLine, a.installed ? 'Log in with the addon enabled: your characters then show up here after you log out or /reload.' : '');
  }

  const act = async (button, call) => {
    button.disabled = true;
    try {
      const res = await call();
      if (res?.status) render(res.status);
      if (res && !res.ok && !res.cancelled) setLine(syncLine, res.error || 'Something went wrong.', 'bad');
    } finally {
      button.disabled = false;
    }
  };
  chooseBtn.addEventListener('click', () => act(chooseBtn, () => window.api.addonChooseFolder()));
  installBtn.addEventListener('click', () => act(installBtn, () => window.api.addonInstall()));
  writeBtn.addEventListener('click', () =>
    act(writeBtn, async () => {
      await window.api.addonRescan();
      return window.api.addonWrite();
    })
  );
  auto.addEventListener('change', () => onAutoRefresh(auto.checked));

  const stop = window.api.onAddonStatus(render);
  window.api.addonStatus().then((s) => status || render(s), () => {});

  const node = el(
    'div.dialog-form',
    el('div.setting-row', el('div.wow-header', 'Game addon'), writeBtn),
    el('div.setting-row', folder, chooseBtn),
    el('div.setting-row.update-row', addonLine, installBtn),
    el('label.check-row', auto, el('span', "Keep my characters' specs fresh (updates their data once a day in the background)")),
    el('div.fb-label', 'Specs in the addon'),
    specList,
    syncLine,
    el(
      'p.faint.small',
      'The app writes its data to the KeystoneLens_Data addon folder. In game, type /kl, or open the talent window. New data loads when you log in or /reload. Warcraft Logs data is never sent to the addon.'
    )
  );
  return { node, dispose: stop };
}

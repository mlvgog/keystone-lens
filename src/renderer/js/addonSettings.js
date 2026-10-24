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

/** What the installed addon is, compared with the copy in this app: [text, css class]. */
export function addonLineText(s) {
  const a = s.addon || {};
  const updated = s.addonUpdated && Date.now() - s.addonUpdated.at < 30 * 60 * 1000 ? s.addonUpdated : null;
  if (!s.wowPath) return ['Choose the game folder to install the addon.', ''];
  if (!a.installed) return ['Not installed. Install it here, or get "Keystone Lens" from CurseForge.', ''];
  if (a.action === 'update' && a.differs) return [`The installed addon (${a.installed}) is an older build than this app's. Update it, then /reload in game.`, 'bad'];
  if (a.action === 'update') return [`Version ${a.installed} installed; ${a.bundled} comes with this app. Update it, then /reload in game.`, 'bad'];
  if (updated) return [`✔ Updated to ${updated.version} by the app. In game, type /reload.`, 'good'];
  if (a.bundled && a.installed !== a.bundled) return [`Version ${a.installed} installed, newer than this app's ${a.bundled}. It is left alone.`, 'good'];
  return [`✔ Version ${a.installed} installed, the same as this app's.`, 'good'];
}

/** The "Game addon" part of Settings. Returns { node, dispose }. */
export function addonSection({ autoRefresh, onAutoRefresh, autoUpdate, onAutoUpdate }) {
  const folder = el('div.addon-folder.dim', '…');
  const chooseBtn = el('button.wow-btn.small', 'Change…');
  const addonLine = el('div.dialog-status');
  const installBtn = el('button.wow-btn.small', { hidden: true }, 'Install addon');
  const auto = el('input', { type: 'checkbox' });
  auto.checked = autoRefresh;
  const autoUpdateBox = el('input', { type: 'checkbox' });
  autoUpdateBox.checked = autoUpdate;
  const specList = el('div.addon-specs');
  const syncLine = el('div.dialog-status');
  const writeBtn = el('button.wow-btn.small', { title: 'Read the game folder again (addon version, your characters) and write the data for the addon' }, 'Rescan');

  let status = null;
  let justInstalled = null; // version installed with the button, while Settings is open
  let feedback = null; // what the last Rescan did
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
    // Always there once the game is found: Install, Update, or Reinstall (a fresh copy).
    installBtn.hidden = !s.wowPath || !a.bundled;
    installBtn.textContent = !a.installed ? 'Install addon' : a.action === 'update' ? 'Update addon' : 'Reinstall addon';
    installBtn.title = a.installed && !a.action ? "Copy this app's addon into the game again" : '';
    if (justInstalled && a.installed === justInstalled && !a.action) setLine(addonLine, `✔ Version ${a.installed} installed. In game, type /reload.`, 'good');
    else setLine(addonLine, ...addonLineText(s));

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
    else if (feedback) setLine(syncLine, ...feedback);
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
  installBtn.addEventListener('click', () =>
    act(installBtn, async () => {
      const res = await window.api.addonInstall();
      if (res.ok) justInstalled = res.status.addon.installed;
      return res;
    })
  );
  writeBtn.addEventListener('click', () =>
    act(writeBtn, async () => {
      await window.api.addonRescan();
      const res = await window.api.addonWrite();
      if (res.ok && res.status) {
        const n = res.status.specs.length;
        feedback = res.status.addon?.installed
          ? [`Data written for ${n} spec${n === 1 ? '' : 's'}. In game, type /reload.`, 'good']
          : ['Install the addon first: the data is written once it is installed.', 'bad'];
      }
      return res;
    })
  );
  auto.addEventListener('change', () => onAutoRefresh(auto.checked));
  autoUpdateBox.addEventListener('change', () => onAutoUpdate(autoUpdateBox.checked));

  const stop = window.api.onAddonStatus(render);
  window.api.addonStatus().then((s) => status || render(s), () => {});

  const node = el(
    'div.dialog-form',
    el('div.setting-row', el('div.wow-header', 'Game addon'), writeBtn),
    el('div.setting-row', folder, chooseBtn),
    el('div.setting-row.update-row', addonLine, installBtn),
    el('label.check-row', autoUpdateBox, el('span', 'Update the addon when this app comes with a newer one')),
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

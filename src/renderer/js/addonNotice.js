// Tells you about the game addon while it isn't installed (or is outdated): a banner under the
// title bar with Install / Not now, and a dot on the ⚙ button. Also says when the app has
// updated the addon by itself. See src/main/addonSync.js.
import { el, toast } from './util.js';

const DISMISSED_KEY = 'keystone-lens-addon-notice'; // app version in which "Not now" was clicked

function dismissedIn() {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function dismiss(version) {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // the banner comes back next start; nothing else depends on it
  }
}

/** 'install' | 'update' | 'setup' (World of Warcraft not found) | null, from the addon status. */
export function addonNoticeKind(status) {
  if (!status) return null;
  if (!status.wowPath) return 'setup';
  if (status.addon?.action === 'install') return 'install';
  if (status.addon?.action === 'update') return 'update';
  return null;
}

const WHAT = "See the top players' pick rates on your talent window, and their builds and gear, in World of Warcraft.";

/**
 * container: where the banner goes; settingsButton gets the dot.
 * version: the app version ("Not now" lasts until the next one); openSettings(): Settings dialog.
 */
export async function initAddonNotice(container, settingsButton, { version, openSettings }) {
  let status = null;

  async function install(button) {
    button.disabled = true;
    const res = await window.api.addonInstall();
    button.disabled = false;
    if (res.ok) {
      status = res.status;
      toast('Addon installed. In game, type /reload.');
    } else {
      toast(res.error || 'Could not install the addon.');
    }
    render();
  }

  function banner(kind) {
    const notNow = el(
      'button.link-btn',
      {
        onclick: () => {
          dismiss(version);
          render();
        },
      },
      'Not now'
    );
    if (kind === 'setup') {
      return el(
        'div.banner.addon-banner',
        el('span', el('b', 'Keystone Lens has a game addon. '), WHAT, ' World of Warcraft was not found on this PC: choose its folder to install it.'),
        el('div.banner-actions', el('button.wow-btn.small', { onclick: openSettings }, 'Set up'), notNow)
      );
    }
    const update = kind === 'update';
    const action = el('button.wow-btn.small', update ? 'Update addon' : 'Install addon');
    action.addEventListener('click', () => install(action));
    const a = status.addon;
    let text = el('span', el('b', 'Keystone Lens has a game addon. '), WHAT);
    if (update && a.differs) text = el('span', el('b', 'This app has a newer build of the game addon'), ` than the one installed (${a.installed}).`);
    else if (update) text = el('span', el('b', 'A newer game addon comes with this app'), ` (installed: ${a.installed}, new: ${a.bundled}).`);
    return el('div.banner.addon-banner', text, el('div.banner-actions', action, notNow));
  }

  let toastedUpdate = null;
  function render() {
    // The app replaced the addon it installed with its newer build: the game needs a /reload.
    const updated = status?.addonUpdated;
    if (updated && updated.at !== toastedUpdate && Date.now() - updated.at < 30 * 60 * 1000) {
      toastedUpdate = updated.at;
      toast(`Game addon updated to ${updated.version}. In game, type /reload.`);
    }
    const kind = addonNoticeKind(status);
    // The dot only when the game was found: someone without WoW on this PC isn't nagged.
    const dot = kind === 'install' || kind === 'update';
    settingsButton.classList.toggle('has-dot', dot);
    settingsButton.title = !dot ? 'Settings' : kind === 'update' ? 'Settings · a newer game addon is available' : 'Settings · the game addon is not installed';
    container.replaceChildren(...(kind && dismissedIn() !== version ? [banner(kind)] : []));
  }

  window.api.onAddonStatus((s) => {
    status = s;
    render();
  });
  const initial = await window.api.addonStatus().catch(() => null);
  if (!status) {
    status = initial; // unless an update arrived in the meantime
    render();
  }
}

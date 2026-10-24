// App updates: the title-bar notice and the texts for Settings → Updates (see src/main/updater.js).
import { toast } from './util.js';

/** One line describing the update status, for Settings. */
export function updateStatusText(s) {
  switch (s?.state) {
    case 'disabled':
      return 'Running from source: updates come with git pull.';
    case 'checking':
      return 'Checking for updates…';
    case 'latest':
      return 'You have the latest version.';
    case 'available':
      return s.portable ? `Version ${s.version} is available. The portable exe can't update itself: download the new one.` : `Version ${s.version} is available.`;
    case 'downloading':
      return `Downloading version ${s.version || ''}… ${s.percent || 0}%`;
    case 'ready':
      return `Version ${s.version} is ready. It installs when you restart or close the app.`;
    case 'error':
      return `Could not check for updates: ${s.error || 'unknown error'}`;
    default:
      return '';
  }
}

/** The button that moves an update along: { label, run } or null. */
export function updateAction(s) {
  if (s?.state === 'available') {
    if (s.portable) return { label: 'Download page', run: () => window.api.openExternal(s.releaseUrl) };
    return { label: 'Download & install', run: () => window.api.downloadUpdate() };
  }
  if (s?.state === 'ready') return { label: 'Restart now', run: () => window.api.installUpdate() };
  return null;
}

/**
 * The small notice next to the window buttons. `getMode()` returns the Updates setting:
 * in automatic mode the background download stays out of sight until the update is ready.
 */
export async function initUpdateNotice(button, { getMode }) {
  let status = null;
  let downloadAsked = false;
  const render = () => {
    const s = status;
    let label = null;
    let title = '';
    if (s?.state === 'available') {
      label = `Update ${s.version}`;
      title = s.portable ? `Keystone Lens ${s.version} is available: open the download page` : `Keystone Lens ${s.version} is available: download and install it`;
    } else if (s?.state === 'downloading' && (downloadAsked || getMode() !== 'auto')) {
      label = `Updating… ${s.percent || 0}%`;
      title = `Downloading Keystone Lens ${s.version || ''}`;
    } else if (s?.state === 'ready') {
      label = 'Restart to update';
      title = `Keystone Lens ${s.version} is ready. Restart now, or it installs when you close the app.`;
    }
    button.hidden = !label;
    button.textContent = label ? `⬆ ${label}` : '';
    button.title = title;
  };
  button.addEventListener('click', () => {
    const action = updateAction(status);
    if (!action) return;
    if (status.state === 'available' && !status.portable) downloadAsked = true;
    action.run();
  });
  window.api.onUpdateStatus((s) => {
    const becameReady = s.state === 'ready' && status?.state !== 'ready';
    status = s;
    render();
    if (becameReady) toast(`Keystone Lens ${s.version} is ready: restart to update`);
  });
  const initial = await window.api.updateStatus().catch(() => null);
  if (!status) {
    status = initial; // unless an update event arrived in the meantime
    render();
  }
}

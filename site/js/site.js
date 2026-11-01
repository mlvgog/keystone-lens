'use strict';

// The website's only script.
// - Download buttons: asks GitHub for the newest release and points every [data-download] link
//   straight at its installer or portable exe, with the version, size and date. Until then, and
//   whenever that fails (no JS, offline, GitHub's limit of 60 requests an hour per visitor), the
//   links keep their href to the newest release page, which always works.
// - Screenshots: a click opens them large in a <dialog>. Without JS the link opens the image.
// Loaded by Node in test/site.test.js, where it only exports its helpers.

(function () {
  const REPO = 'mlvgog/keystone-lens';
  const API = `https://api.github.com/repos/${REPO}/releases/latest`;
  const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
  const RELEASE_PREFIX = `https://github.com/${REPO}/releases/`;
  const CACHE_KEY = 'kl-latest-release';
  const CACHE_MS = 10 * 60 * 1000;

  function asset(release, re) {
    const a = release.assets.find((x) => x && re.test(String(x.name || '')));
    if (!a || typeof a.browser_download_url !== 'string' || !a.browser_download_url.startsWith(DOWNLOAD_PREFIX)) return null;
    return { name: a.name, url: a.browser_download_url, size: Number(a.size) || 0 };
  }

  // The first line of the release notes (docs/release-notes/vX.md starts with a bold summary),
  // as plain text.
  function summaryOf(body) {
    const line = String(body || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
    if (line.startsWith('#')) return '';
    const text = line
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .trim();
    return text.length > 220 ? text.slice(0, 217).trimEnd() + '…' : text;
  }

  // What the page needs from GitHub's "latest release" reply, or null when it has no installer.
  function pickAssets(release) {
    if (!release || typeof release !== 'object' || !Array.isArray(release.assets)) return null;
    const setup = asset(release, /^KeystoneLens-Setup-\d+\.\d+\.\d+\.exe$/);
    if (!setup) return null;
    const page = typeof release.html_url === 'string' && release.html_url.startsWith(RELEASE_PREFIX) ? release.html_url : `${RELEASE_PREFIX}latest`;
    return {
      version: String(release.tag_name || '').replace(/^v/, '') || setup.name.replace(/^KeystoneLens-Setup-|\.exe$/g, ''),
      setup,
      portable: asset(release, /^KeystoneLens-Portable-\d+\.\d+\.\d+\.exe$/),
      date: release.published_at || null,
      page,
      summary: summaryOf(release.body),
    };
  }

  function formatSize(bytes) {
    return bytes > 0 ? `${Math.round(bytes / (1024 * 1024))} MB` : '';
  }

  function formatDate(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { pickAssets, summaryOf, formatSize };
    return;
  }

  // ---------------------------------------------------------------- browser

  function cached() {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      return c && Date.now() - c.time < CACHE_MS ? c.release : null;
    } catch {
      return null;
    }
  }

  function remember(release) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), release }));
    } catch {
      /* private mode or storage off: just ask again next time */
    }
  }

  async function latestRelease() {
    const hit = cached();
    if (hit) return hit;
    const res = await fetch(API);
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const info = pickAssets(await res.json());
    if (info) remember(info);
    return info;
  }

  function show(info) {
    for (const a of document.querySelectorAll('a[data-download]')) {
      const file = a.dataset.download === 'portable' ? info.portable : info.setup;
      if (!file) continue;
      a.href = file.url;
      a.title = file.name;
    }
    const facts = [`Version ${info.version}`, formatSize(info.setup.size), formatDate(info.date)].filter(Boolean).join(' · ');
    for (const n of document.querySelectorAll('[data-release="version"]')) n.textContent = facts;
    for (const n of document.querySelectorAll('[data-release="portable-size"]')) {
      n.textContent = info.portable ? formatSize(info.portable.size) : '';
    }
    for (const n of document.querySelectorAll('[data-release="summary"]')) {
      n.textContent = info.summary;
      n.hidden = !info.summary;
    }
    for (const a of document.querySelectorAll('a[data-release="notes"]')) a.href = info.page;
  }

  function viewer() {
    const dialog = document.getElementById('viewer');
    if (!dialog || typeof dialog.showModal !== 'function') return;
    const img = dialog.querySelector('img');
    const caption = dialog.querySelector('figcaption');
    for (const link of document.querySelectorAll('a.shot')) {
      link.addEventListener('click', (e) => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        const thumb = link.querySelector('img');
        img.src = link.href;
        img.alt = thumb ? thumb.alt : '';
        caption.textContent = link.dataset.caption || (thumb ? thumb.alt : '');
        dialog.showModal();
      });
    }
    dialog.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => img.removeAttribute('src'));
  }

  function start() {
    viewer();
    if (document.querySelector('a[data-download]')) {
      latestRelease()
        .then((info) => info && show(info))
        .catch(() => {
          /* the links already point at the newest release page */
        });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

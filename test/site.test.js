'use strict';

// The website (site/, published by .github/workflows/pages.yml): links, images, the download
// buttons and the release lookup in site/js/site.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSite } = require('../scripts/build-site');
const { pickAssets, summaryOf, formatSize } = require('../site/js/site.js');

const LATEST = 'https://github.com/mlvgog/keystone-lens/releases/latest';

const out = buildSite(fs.mkdtempSync(path.join(os.tmpdir(), 'kl-site-')));
test.after(() => fs.rmSync(out, { recursive: true, force: true }));

const pages = fs.readdirSync(out).filter((f) => f.endsWith('.html'));
const read = (page) => fs.readFileSync(path.join(out, page), 'utf8');
const attrs = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => m[1]);
const ids = (html) => new Set(attrs(html, 'id'));
const tags = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((m) => m[0]);

test('the site has its pages, the app screenshots, the icon and the font', () => {
  assert.deepEqual(pages.sort(), ['guide.html', 'index.html']);
  for (const f of ['img/icon.png', 'img/app/talents.jpg', 'img/app/gear.jpg', 'fonts/marcellus.woff2', 'fonts/Marcellus-OFL.txt', 'css/site.css', 'js/site.js']) {
    assert.ok(fs.existsSync(path.join(out, f)), `${f} is missing`);
  }
});

test('the build refuses to delete the project', () => {
  assert.throws(() => buildSite(path.join(__dirname, '..')), /Refusing/);
  assert.throws(() => buildSite(path.join(__dirname, '..', '..')), /Refusing/);
});

test('every local link, image and anchor exists', () => {
  for (const page of pages) {
    const html = read(page);
    for (const ref of [...attrs(html, 'href'), ...attrs(html, 'src')]) {
      if (/^https:\/\//.test(ref)) continue;
      assert.ok(!/^[a-z]+:/i.test(ref), `${page}: ${ref} should be https or a local path`);
      const [file, anchor] = ref.split('#');
      const target = file === '' ? page : file === './' ? 'index.html' : file;
      assert.ok(fs.existsSync(path.join(out, target)), `${page}: ${ref} points at a missing file`);
      if (anchor) assert.ok(ids(read(target)).has(anchor), `${page}: ${ref} points at a missing #${anchor}`);
    }
  }
});

test('every page has a title, description, viewport and a strict Content Security Policy', () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /<title>[^<]+<\/title>/, page);
    assert.match(html, /<meta\s+name="description"\s+content="[^"]{40,}"/, page);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/, page);
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] || '';
    assert.match(csp, /default-src 'self'/, page);
    assert.match(csp, /connect-src https:\/\/api\.github\.com;/, page);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/, page);
    // The CSP blocks inline styles and scripts, so there must be none.
    assert.doesNotMatch(html, /\sstyle="|\son[a-z]+="/, `${page} has an inline style or event handler`);
    for (const s of tags(html, 'script')) assert.match(s, /\ssrc="/, `${page} has an inline script`);
  }
});

test('images have a size and alt text, and screenshots open full size', () => {
  for (const page of pages) {
    const html = read(page);
    for (const img of tags(html, 'img')) {
      assert.match(img, /\salt="/, `${page}: ${img}`);
      if (/\ssrc="/.test(img)) assert.match(img, /\swidth="\d+" height="\d+"/, `${page}: ${img}`);
    }
    for (const a of tags(html, 'a').filter((t) => /class="shot\b/.test(t))) {
      assert.match(a, /href="img\/[^"]+\.(jpe?g|png)"/, `${page}: ${a}`);
    }
  }
});

test('download links work before the script runs: they point at the newest release', () => {
  let n = 0;
  for (const page of pages) {
    for (const a of tags(read(page), 'a').filter((t) => /\sdata-(download|release)="/.test(t))) {
      assert.match(a, new RegExp(`href="${LATEST}"`), `${page}: ${a}`);
      n++;
    }
  }
  assert.ok(n >= 4);
  assert.match(read('index.html'), /data-download="setup"/);
  assert.match(read('index.html'), /data-download="portable"/);
});

test('every page links to the Ko-fi page, and only there, for donations', () => {
  for (const page of pages) {
    const links = tags(read(page), 'a').filter((t) => /\sdata-donate\b/.test(t));
    assert.ok(links.length >= 1, `${page} has no donate link`);
    for (const a of links) assert.match(a, /href="https:\/\/ko-fi\.com\/gog220748"/, `${page}: ${a}`);
  }
  assert.match(read('index.html'), /<div class="support" id="support">/);
  // A small Support button sits next to the top download button.
  const hero = /<div class="download-actions">([\s\S]*?)<\/div>/.exec(read('index.html'))?.[1] || '';
  assert.match(hero, /data-download="setup"/);
  assert.match(hero, /data-donate/);
});

const asset = (name, size = 1000) => ({
  name,
  size,
  browser_download_url: `https://github.com/mlvgog/keystone-lens/releases/download/v1.2.1/${name}`,
});

const RELEASE = {
  tag_name: 'v1.2.1',
  html_url: 'https://github.com/mlvgog/keystone-lens/releases/tag/v1.2.1',
  published_at: '2026-10-30T16:40:00Z',
  body: '**No red frame on talents the game gives you for free, in the [game addon](https://example.com).**\n\n## Download\n...',
  assets: [
    asset('KeystoneLens-Setup-1.2.1.exe.blockmap'),
    asset('latest.yml'),
    asset('SHA256SUMS.txt'),
    asset('KeystoneLens-Portable-1.2.1.exe', 112000000),
    asset('KeystoneLens-Setup-1.2.1.exe', 112489992),
  ],
};

test('the newest release gives the installer and portable exe, with version and summary', () => {
  const info = pickAssets(RELEASE);
  assert.equal(info.version, '1.2.1');
  assert.equal(info.setup.name, 'KeystoneLens-Setup-1.2.1.exe');
  assert.equal(info.setup.url, 'https://github.com/mlvgog/keystone-lens/releases/download/v1.2.1/KeystoneLens-Setup-1.2.1.exe');
  assert.equal(info.portable.name, 'KeystoneLens-Portable-1.2.1.exe');
  assert.equal(info.page, RELEASE.html_url);
  assert.equal(info.date, RELEASE.published_at);
  assert.equal(info.summary, 'No red frame on talents the game gives you for free, in the game addon.');
  assert.equal(formatSize(info.setup.size), '107 MB');
});

test('a release without an installer, or a strange reply, leaves the links as they are', () => {
  assert.equal(pickAssets({ ...RELEASE, assets: RELEASE.assets.filter((a) => !/Setup-[\d.]+\.exe$/.test(a.name)) }), null);
  assert.equal(pickAssets(null), null);
  assert.equal(pickAssets({ message: 'API rate limit exceeded' }), null);
  // Only files of this project's releases are linked.
  const elsewhere = { ...asset('KeystoneLens-Setup-1.2.1.exe'), browser_download_url: 'https://example.com/KeystoneLens-Setup-1.2.1.exe' };
  assert.equal(pickAssets({ ...RELEASE, assets: [elsewhere] }), null);
  const noPortable = pickAssets({ ...RELEASE, assets: RELEASE.assets.filter((a) => !/Portable/.test(a.name)), html_url: 'https://example.com/' });
  assert.equal(noPortable.portable, null);
  assert.equal(noPortable.page, LATEST);
});

test('the release summary is the first line of the notes, as plain text', () => {
  assert.equal(summaryOf('\n\n**Bold** and `code` and [a link](https://x.y)\nsecond line'), 'Bold and code and a link');
  assert.equal(summaryOf('## Download\n...'), '');
  assert.equal(summaryOf(''), '');
  assert.equal(summaryOf(null), '');
  assert.ok(summaryOf('x'.repeat(400)).length <= 220);
});

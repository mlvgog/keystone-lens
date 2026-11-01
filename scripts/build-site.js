'use strict';

// Builds the website (published on GitHub Pages by .github/workflows/pages.yml) into _site/:
// the pages in site/, the app screenshots the README uses (docs/screenshots), the app icon and
// the Marcellus heading font the app bundles. No other build step: open _site/index.html to look.
//
//   npm run site            build into _site/
//   node scripts/build-site.js <folder>

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'node_modules', '@fontsource', 'marcellus');

function buildSite(out = path.join(ROOT, '_site')) {
  out = path.resolve(out);
  // The folder is deleted first, so never let it be the project or one of its parents.
  if (ROOT === out || ROOT.startsWith(out + path.sep)) throw new Error(`Refusing to build the site into ${out}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'site'), out, { recursive: true });

  const shots = path.join(ROOT, 'docs', 'screenshots');
  fs.mkdirSync(path.join(out, 'img', 'app'), { recursive: true });
  for (const name of fs.readdirSync(shots)) {
    if (/\.(jpe?g|png|webp)$/i.test(name)) fs.copyFileSync(path.join(shots, name), path.join(out, 'img', 'app', name));
  }
  fs.copyFileSync(path.join(ROOT, 'src', 'assets', 'icon.png'), path.join(out, 'img', 'icon.png'));

  // Marcellus is under the SIL Open Font License, which travels with the font.
  fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(FONT, 'files', 'marcellus-latin-400-normal.woff2'), path.join(out, 'fonts', 'marcellus.woff2'));
  fs.copyFileSync(path.join(FONT, 'LICENSE'), path.join(out, 'fonts', 'Marcellus-OFL.txt'));
  return out;
}

if (require.main === module) {
  const out = buildSite(process.argv[2] || undefined);
  console.log(`Website built in ${path.relative(process.cwd(), out) || '.'}`);
}

module.exports = { buildSite };

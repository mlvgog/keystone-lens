// Updates the CSP hash of the inline script in src/renderer/wowhead-frame.html after it is edited.
// Usage: node scripts/update-frame-hash.js
'use strict';

const fs = require('fs');
const path = require('path');
const { frameScriptHash } = require('../src/main/frameHash');

const file = path.join(__dirname, '..', 'src', 'renderer', 'wowhead-frame.html');
const html = fs.readFileSync(file, 'utf8');
const next = html.replace(/'sha256-[^']*'/, `'sha256-${frameScriptHash(html)}'`);
fs.writeFileSync(file, next);
console.log(next === html ? 'Hash already up to date.' : 'Hash updated.');

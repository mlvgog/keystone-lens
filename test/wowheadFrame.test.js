'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { frameScriptHash } = require('../src/main/frameHash');

const FRAME = path.join(__dirname, '..', 'src', 'renderer', 'wowhead-frame.html');

test('the Wowhead frame allows exactly its own inline script (run scripts/update-frame-hash.js after editing it)', () => {
  const html = fs.readFileSync(FRAME, 'utf8');
  assert.ok(!html.includes('\r\n'), 'the frame must keep LF line endings (see .gitattributes)');
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] || '';
  assert.match(csp, new RegExp(`script-src 'sha256-${frameScriptHash(html).replace(/[+/=]/g, '\\$&')}'`));
  assert.ok(!/unsafe-inline/.test(csp.split(';').find((d) => d.trim().startsWith('script-src'))), 'no unsafe-inline scripts');
});

test('the frame only accepts item and spell references', () => {
  const html = fs.readFileSync(FRAME, 'utf8');
  assert.match(html, /\/\^\(item\|spell\)=/);
});

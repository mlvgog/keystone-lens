'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('../src/main/settings');

// Stand-in for Electron's safeStorage: reversible, but never the plain text.
const vault = {
  encrypt: (text) => Buffer.from(`enc:${text}`).toString('base64'),
  decrypt: (b64) => {
    const s = Buffer.from(b64, 'base64').toString();
    if (!s.startsWith('enc:')) throw new Error('not ours');
    return s.slice(4);
  },
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kl-settings-'));
}

test('the Warcraft Logs secret is only written encrypted', () => {
  const dir = tempDir();
  settings.init(dir, [0], { vault });
  settings.set({ wclClientId: 'client', wclClientSecret: 's3cret' });
  const onDisk = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!onDisk.includes('s3cret'));
  assert.equal(JSON.parse(onDisk).wclClientSecretEnc, vault.encrypt('s3cret'));

  settings.init(dir, [0], { vault });
  assert.equal(settings.get().wclClientSecret, 's3cret');
  assert.equal(settings.getPublic().wclHasSecret, true);
  assert.equal('wclClientSecret' in settings.getPublic(), false);
});

test('a plain-text secret from an older version is encrypted on load', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ wclClientId: 'client', wclClientSecret: 'old' }));
  settings.init(dir, [0], { vault });
  assert.equal(settings.get().wclClientSecret, 'old');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(onDisk.wclClientSecret, undefined);
  assert.equal(onDisk.wclClientSecretEnc, vault.encrypt('old'));
});

test('a secret that cannot be decrypted (other user or PC) is dropped', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ wclClientId: 'client', wclClientSecretEnc: 'Zm9v' }));
  settings.init(dir, [0], { vault });
  assert.equal(settings.get().wclClientSecret, '');
  assert.equal(settings.get().wclClientId, 'client');
});

test('the update mode defaults to automatic and only accepts known modes', () => {
  const dir = tempDir();
  settings.init(dir, [0]);
  assert.equal(settings.get().updates, 'auto');
  settings.set({ updates: 'notify' });
  assert.equal(settings.get().updates, 'notify');
  settings.set({ updates: 'sometimes' });
  assert.equal(settings.get().updates, 'auto');
  settings.set({ updates: 'off' });
  settings.init(dir, [0]);
  assert.equal(settings.getPublic().updates, 'off', 'saved and visible to the window');
});

test('game folder and background refresh settings', () => {
  const dir = tempDir();
  settings.init(dir, [0]);
  assert.equal(settings.get().wowPath, '');
  assert.equal(settings.get().addonSync, true);
  settings.set({ wowPath: 'C:\\Games\\World of Warcraft\\_retail_', addonSync: false });
  settings.init(dir, [0]);
  assert.equal(settings.get().wowPath, 'C:\\Games\\World of Warcraft\\_retail_');
  assert.equal(settings.get().addonSync, false);
  settings.set({ wowPath: 42, addonSync: 'yes' });
  assert.equal(settings.get().wowPath, '');
  assert.equal(settings.get().addonSync, true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wow = require('../src/main/wow');

function fakeGame() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-wow-'));
  const retail = path.join(root, 'World of Warcraft', '_retail_');
  fs.mkdirSync(path.join(retail, 'Interface', 'AddOns'), { recursive: true });
  fs.mkdirSync(path.join(retail, 'WTF', 'Account', 'ACCOUNT1', 'SavedVariables'), { recursive: true });
  fs.mkdirSync(path.join(retail, 'WTF', 'Account', 'ACCOUNT2', 'SavedVariables'), { recursive: true });
  fs.writeFileSync(path.join(retail, 'Wow.exe'), '');
  return { root, game: path.join(root, 'World of Warcraft'), retail };
}

function bundledAddon(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-bundled-'));
  fs.writeFileSync(path.join(dir, 'KeystoneLens.toc'), `## Interface: 120007\n## Version: ${version}\n\nCore.lua\n`);
  fs.writeFileSync(path.join(dir, 'Core.lua'), `-- ${version}\n`);
  return dir;
}

test('the retail folder is found from the game folder, _retail_ itself or a folder inside it', () => {
  const { game, retail } = fakeGame();
  assert.equal(wow.normalizeWowFolder(game), retail);
  assert.equal(wow.normalizeWowFolder(retail), retail);
  assert.equal(wow.normalizeWowFolder(path.join(retail, 'Interface', 'AddOns')), retail);
  assert.equal(wow.normalizeWowFolder(os.tmpdir()), null);
  assert.equal(wow.normalizeWowFolder(''), null);
});

test('the install path comes from the registry', async () => {
  const { game, retail } = fakeGame();
  const run = (cmd, args, opts, cb) => {
    if (args[1].includes('WOW6432Node')) return cb(new Error('not found'));
    cb(null, `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft\r\n    InstallPath    REG_SZ    ${retail}${path.sep}\r\n`);
  };
  assert.equal(await wow.registryInstallPath({ run }), `${retail}${path.sep}`);
  assert.equal(await wow.findWowFolder({ run }), retail);
  const none = (cmd, args, opts, cb) => cb(new Error('not found'));
  assert.equal(await wow.registryInstallPath({ run: none }), null);
  assert.ok(game);
});

test('the bundled addon is installed, updated, and never replaces a newer copy', async () => {
  const { retail } = fakeGame();
  const addonDir = path.join(retail, 'Interface', 'AddOns', 'KeystoneLens');
  const v1 = bundledAddon('1.0.0');
  assert.deepEqual(await wow.addonStatus(retail, v1), { installed: null, bundled: '1.0.0', managed: false, differs: false, action: 'install' });
  assert.equal(await wow.installAddon(retail, v1), '1.0.0');
  assert.deepEqual(await wow.addonStatus(retail, v1), { installed: '1.0.0', bundled: '1.0.0', managed: true, differs: false, action: null });
  const marker = JSON.parse(fs.readFileSync(path.join(addonDir, '.installed-by-keystone-lens'), 'utf8'));
  assert.equal(marker.version, '1.0.0');
  assert.equal(marker.fingerprint, await wow.addonFingerprint(v1));

  const v2 = bundledAddon('1.1.0');
  assert.equal((await wow.addonStatus(retail, v2)).action, 'update');
  assert.equal(await wow.installAddon(retail, v2), '1.1.0');
  assert.equal(fs.readFileSync(path.join(addonDir, 'Core.lua'), 'utf8'), '-- 1.1.0\n');
  assert.deepEqual(fs.readdirSync(path.join(retail, 'Interface', 'AddOns')), ['KeystoneLens'], 'no temporary folders left');

  assert.equal((await wow.addonStatus(retail, v1)).action, null, 'an older bundled copy leaves the newer one alone');
  assert.equal((await wow.addonStatus(null, v1)).action, null, 'nothing to do without a game folder');
});

test('a new build with the same version number is an update too', async () => {
  const { retail } = fakeGame();
  const addonDir = path.join(retail, 'Interface', 'AddOns', 'KeystoneLens');
  const first = bundledAddon('1.0.0');
  // Installed by hand (or by an app version without the marker): same version, other files.
  fs.cpSync(first, addonDir, { recursive: true });
  const rebuilt = bundledAddon('1.0.0');
  fs.writeFileSync(path.join(rebuilt, 'Panel.lua'), '-- the redesigned window\n');
  assert.deepEqual(await wow.addonStatus(retail, rebuilt), { installed: '1.0.0', bundled: '1.0.0', managed: false, differs: true, action: 'update' });

  await wow.installAddon(retail, rebuilt);
  const status = await wow.addonStatus(retail, rebuilt);
  assert.equal(status.action, null);
  assert.equal(status.managed, true);
});

test('the fingerprint ignores dotfiles and line endings', async () => {
  const a = bundledAddon('1.0.0');
  const b = bundledAddon('1.0.0');
  fs.writeFileSync(path.join(b, '.pkgmeta'), 'package-as: KeystoneLens\n');
  fs.writeFileSync(path.join(b, 'Core.lua'), '-- 1.0.0\r\n');
  assert.equal(await wow.addonFingerprint(a), await wow.addonFingerprint(b));
  fs.mkdirSync(path.join(b, 'Media'));
  fs.writeFileSync(path.join(b, 'Media', 'icon.tga'), Buffer.from([1, 2, 3]));
  assert.notEqual(await wow.addonFingerprint(a), await wow.addonFingerprint(b), 'files in subfolders count');
  assert.equal(await wow.addonFingerprint(path.join(os.tmpdir(), 'no-such-addon')), null);
});

test('characters are read from every account, the newest save winning', async () => {
  const { retail } = fakeGame();
  const sv = (account, text) => fs.writeFileSync(path.join(retail, 'WTF', 'Account', account, 'SavedVariables', 'KeystoneLens.lua'), text);
  sv(
    'ACCOUNT1',
    [
      'KeystoneLensDB = {',
      '\t["characters"] = {',
      '\t\t["Fjäll-tarren-mill-eu"] = {',
      '\t\t\t["name"] = "Fjäll", ["realm"] = "Tarren Mill", ["region"] = "eu", ["className"] = "Mage", ["specId"] = 64,',
      '\t\t\t["specName"] = "Frost", ["level"] = 90, ["itemLevel"] = 289.4, ["time"] = 100,',
      '\t\t\t["simc"] = "mage=\\"Fjäll\\"\\nspec=frost\\n",',
      '\t\t},',
      '\t\t["Broken-x-eu"] = { ["name"] = "Broken" },',
      '\t},',
      '}',
    ].join('\n')
  );
  sv(
    'ACCOUNT2',
    'KeystoneLensDB = { ["characters"] = { ["Fjäll-tarren-mill-eu"] = { ["name"] = "Fjäll", ["realm"] = "Tarren Mill", ["region"] = "eu", ["time"] = 200, ["simc"] = "newer", ["specId"] = 63 }, ["Alt-draenor-eu"] = { ["name"] = "Alt", ["region"] = "xx", ["time"] = 50, ["simc"] = "alt" } } }'
  );
  fs.mkdirSync(path.join(retail, 'WTF', 'Account', 'ACCOUNT3', 'SavedVariables'), { recursive: true });
  sv('ACCOUNT3', 'KeystoneLensDB = { broken');

  const chars = await wow.readAddonCharacters(retail);
  assert.deepEqual(chars.map((c) => [c.name, c.time]), [['Fjäll', 200], ['Alt', 50]]);
  assert.equal(chars[0].simc, 'newer');
  assert.equal(chars[0].specId, 63);
  assert.equal(chars[1].region, null, 'unknown regions are dropped');
  assert.deepEqual(await wow.readAddonCharacters(path.join(os.tmpdir(), 'nowhere')), []);
});

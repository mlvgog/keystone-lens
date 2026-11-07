'use strict';

// Uploading the weekly addon zip to CurseForge (scripts/upload-curseforge.js), with the API stubbed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { interfaceToVersion, gameVersionIds, metadata, upload, tocField, RETAIL } = require('../scripts/upload-curseforge');

const VERSIONS = [
  { id: 13000, gameVersionTypeID: RETAIL, name: '12.0.5' },
  { id: 13100, gameVersionTypeID: RETAIL, name: '12.1.0' },
  { id: 13105, gameVersionTypeID: RETAIL, name: '12.1.5' },
  { id: 99999, gameVersionTypeID: 67408, name: '1.15.7' }, // Classic, never picked
];

test('the Interface number becomes the game version CurseForge lists', () => {
  assert.equal(interfaceToVersion('120105'), '12.1.5');
  assert.equal(interfaceToVersion(' 120200 '), '12.2.0');
  assert.equal(interfaceToVersion(110002), '11.0.2');
  assert.throws(() => interfaceToVersion('abc'), /Not an Interface number/);

  assert.deepEqual(gameVersionIds(VERSIONS, '120105'), [13105]);
  assert.deepEqual(gameVersionIds(VERSIONS, '120105, 120100'), [13105, 13100]);
  // A patch CurseForge doesn't list yet: the newest version below it.
  assert.deepEqual(gameVersionIds(VERSIONS, '120107'), [13105]);
  assert.deepEqual(gameVersionIds(VERSIONS, '120007'), [13000]);
  // Older than anything listed: the newest retail version.
  assert.deepEqual(gameVersionIds(VERSIONS, '110000'), [13105]);
  assert.throws(() => gameVersionIds(VERSIONS.filter((v) => v.gameVersionTypeID !== RETAIL), '120105'), /no retail/);
});

test('the changelog says which week the data is from', () => {
  const m = metadata({ label: '1.2.0-data.20261111', gameVersions: [13105], changelog: '# Keystone Lens addon\n', dataDate: '2026-11-11' });
  assert.equal(m.displayName, '1.2.0-data.20261111');
  assert.equal(m.releaseType, 'release');
  assert.equal(m.changelogType, 'markdown');
  assert.match(m.changelog, /^\*\*Data of 2026-11-11:\*\* the top 50 Mythic\+ players of every spec, world-wide, from Raider\.IO\.\n\n# Keystone Lens addon/);
});

test('the upload asks for the game versions, then posts the zip with its metadata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-cf-'));
  const zip = path.join(dir, 'KeystoneLens-1.2.0-data.20261111.zip');
  fs.writeFileSync(zip, 'PK fake zip');
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/api/game/wow/versions')) return { ok: true, json: async () => VERSIONS };
    return { ok: true, status: 200, text: async () => '{"id":42}' };
  };
  const res = await upload({ zip, label: '1.2.0-data.20261111', dataDate: '2026-11-11', token: 'secret', projectId: '123456', toc: '## Interface: 120105\n## Version: 1.2.0\n', changelog: '# Log\n', fetchImpl });
  assert.equal(res.response, '{"id":42}');
  assert.equal(calls[0].url, 'https://wow.curseforge.com/api/game/wow/versions');
  assert.equal(calls[0].opts.headers['x-api-token'], 'secret');
  assert.equal(calls[1].url, 'https://wow.curseforge.com/api/projects/123456/upload-file');
  assert.equal(calls[1].opts.method, 'POST');
  const form = calls[1].opts.body;
  assert.deepEqual(JSON.parse(form.get('metadata')).gameVersions, [13105]);
  assert.equal(form.get('file').name, 'KeystoneLens-1.2.0-data.20261111.zip');
  assert.equal(await form.get('file').text(), 'PK fake zip');

  // Without CF_PROJECT_ID, the project comes from the .toc.
  calls.length = 0;
  await upload({ zip, label: 'x', token: 'secret', projectId: undefined, toc: '## Interface: 120105\n## X-Curse-Project-ID: 1790549\n', changelog: '', fetchImpl });
  assert.equal(calls[1].url, 'https://wow.curseforge.com/api/projects/1790549/upload-file');

  await assert.rejects(upload({ zip, label: 'x', token: '', projectId: '1', toc: '', changelog: '', fetchImpl }), /CF_API_TOKEN and a project ID/);
  await assert.rejects(upload({ zip, label: 'x', token: 't', projectId: '', toc: '## Interface: 120105', changelog: '', fetchImpl }), /CF_API_TOKEN and a project ID/);
  const failing = async (url) => (url.endsWith('/versions') ? { ok: true, json: async () => VERSIONS } : { ok: false, status: 403, text: async () => 'Forbidden' });
  await assert.rejects(upload({ zip, label: 'x', token: 't', projectId: '1', toc: '## Interface: 120105', changelog: '', fetchImpl: failing }), /HTTP 403 Forbidden/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the addon's .toc names its CurseForge project", () => {
  const toc = fs.readFileSync(path.join(__dirname, '..', 'addon', 'KeystoneLens', 'KeystoneLens.toc'), 'utf8');
  assert.equal(tocField(toc, 'X-Curse-Project-ID'), '1790549');
  assert.equal(tocField(toc, 'Nope'), null);
});

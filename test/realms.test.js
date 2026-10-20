'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRealmListing, slugifyRealm } = require('../src/main/sources/raiderio');

test('realm listing is flattened, de-duplicated and sorted', () => {
  const json = {
    realmListing: {
      realms: [
        {
          id: 1,
          connectedRealms: [
            { name: 'Tarren Mill', altName: null, slug: 'connected-tarren-mill', altSlug: 'tarren-mill' },
            { name: 'Dentarg', altName: null, slug: 'dentarg', altSlug: 'dentarg' },
          ],
        },
        {
          id: 2,
          connectedRealms: [
            { name: 'Azshara', altName: '아즈샤라', slug: 'azshara', altSlug: '아즈샤라' },
            { name: 'Dentarg', altName: null },
            { name: 'Aegwynn', altName: 'Aegwynn' },
          ],
        },
      ],
    },
  };
  assert.deepEqual(parseRealmListing(json), [
    { name: 'Aegwynn', altName: null },
    { name: 'Azshara', altName: '아즈샤라' },
    { name: 'Dentarg', altName: null },
    { name: 'Tarren Mill', altName: null },
  ]);
  assert.deepEqual(parseRealmListing({}), []);
});

test('realm names become raider.io slugs', () => {
  assert.equal(slugifyRealm('Tarren Mill'), 'tarren-mill');
  assert.equal(slugifyRealm("Mal'Ganis"), 'malganis');
  assert.equal(slugifyRealm('  Area 52 '), 'area-52');
});

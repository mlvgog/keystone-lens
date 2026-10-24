'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toLua, luaString, parseLua } = require('../src/main/lua');
const lua = require('./helpers/lua');

const sample = {
  schema: 1,
  name: 'Keystone "Lens"\\ n\nline 2',
  accents: 'Ragnarös · 世界',
  flags: { on: true, off: false },
  specs: {
    261: { pct: 0.123456789, list: [3, 1, 2], nested: [{ id: 7 }, { id: 8 }] },
    '-5': 'negative key',
  },
  'not an identifier': 1,
  end: 'reserved word key',
  empty: {},
  skipped: null,
};

test('toLua writes values Lua reads back exactly', () => {
  for (const indent of [0, 2]) {
    const L = lua.newState();
    lua.run(L, `Data = ${toLua(sample, { indent })}`);
    const back = lua.get(L, 'Data');
    assert.equal(back.schema, 1);
    assert.equal(back.name, sample.name);
    assert.equal(back.accents, sample.accents);
    assert.deepEqual(back.flags, { on: true, off: false });
    assert.equal(back.specs['261'].pct, 0.123457, 'floats keep 6 significant digits');
    assert.deepEqual(back.specs['261'].list, [3, 1, 2]);
    assert.deepEqual(back.specs['261'].nested, [{ id: 7 }, { id: 8 }]);
    assert.equal(back.specs['-5'], 'negative key');
    assert.equal(back['not an identifier'], 1);
    assert.equal(back.end, 'reserved word key');
    assert.equal('skipped' in back, false);
  }
});

test('integer-like keys become numeric Lua keys', () => {
  const L = lua.newState();
  lua.run(L, `Data = ${toLua({ specs: { 261: 'x' } })}`);
  assert.equal(lua.evaluate(L, 'Data.specs[261]'), 'x');
  assert.equal(lua.evaluate(L, 'Data.specs["261"]'), null);
});

test('arrays with holes keep their positions', () => {
  const L = lua.newState();
  lua.run(L, `Data = ${toLua([1, null, 3])}`);
  assert.equal(lua.evaluate(L, 'Data[3]'), 3);
  assert.equal(lua.evaluate(L, 'Data[2]'), null);
});

test('strings are plain ASCII with unambiguous escapes', () => {
  const s = luaString('a\u0001' + '1é');
  assert.match(s, /^[\x20-\x7e]+$/);
  assert.equal(s, '"a\\0011\\195\\169"');
});

test('parseLua reads a SavedVariables file as the game writes it', () => {
  const file = [
    '',
    'KeystoneLensDB = {',
    '\t["characters"] = {',
    '\t\t["Fjäll-Tarren Mill"] = {',
    '\t\t\t["simc"] = "rogue=\\"Fjäll\\"\\nspec=subtlety\\n",',
    '\t\t\t["time"] = 1761300000,',
    '\t\t\t["ilvl"] = 289.5,',
    '\t\t\t["offset"] = -3,',
    '\t\t\t["hex"] = 0x1F,',
    '\t\t\t["big"] = 1e+15,',
    '\t\t\t["favourite"] = true,',
    '\t\t\t["gone"] = nil,',
    '\t\t},',
    '\t},',
    '\t["list"] = {',
    '\t\t"a", -- [1]',
    '\t\t"b", -- [2]',
    '\t},',
    "\t['single'] = 'quoted\\065',",
    '\t[12] = { x = 1; y = 2 },',
    '}',
    '--[[ a block',
    'comment ]]',
    'KeystoneLensPerChar = nil',
    'Other = [[long',
    'string]]',
    '',
  ].join('\n');
  const out = parseLua(Buffer.from(file, 'utf8'));
  const c = out.KeystoneLensDB.characters['Fjäll-Tarren Mill'];
  assert.equal(c.simc, 'rogue="Fjäll"\nspec=subtlety\n');
  assert.equal(c.time, 1761300000);
  assert.equal(c.ilvl, 289.5);
  assert.equal(c.offset, -3);
  assert.equal(c.hex, 31);
  assert.equal(c.big, 1e15);
  assert.equal(c.favourite, true);
  assert.equal('gone' in c, false);
  assert.deepEqual(out.KeystoneLensDB.list, ['a', 'b']);
  assert.equal(out.KeystoneLensDB.single, 'quotedA');
  assert.deepEqual(out.KeystoneLensDB['12'], { x: 1, y: 2 });
  assert.equal('KeystoneLensPerChar' in out, false);
  assert.equal(out.Other, 'long\nstring');
});

test('parseLua reads what toLua writes', () => {
  const back = parseLua(`Data = ${toLua(sample, { indent: 2 })}`).Data;
  assert.equal(back.name, sample.name);
  assert.equal(back.accents, sample.accents);
  assert.deepEqual(back.specs['261'].nested, [{ id: 7 }, { id: 8 }]);
});

test('parseLua refuses code and broken files', () => {
  assert.throws(() => parseLua('X = os.execute("calc")'), { code: 'BAD_LUA' });
  assert.throws(() => parseLua('X = function() end'), { code: 'BAD_LUA' });
  assert.throws(() => parseLua('X = { "unfinished'), { code: 'BAD_LUA' });
  assert.throws(() => parseLua('X = { 1, 2'), { code: 'BAD_LUA' });
});

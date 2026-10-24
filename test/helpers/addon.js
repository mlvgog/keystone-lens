'use strict';

/** Loads the Keystone Lens addon into a Lua VM with the WoW API stub (test/helpers/wow_stub.lua). */

const fs = require('fs');
const path = require('path');
const { lua, lauxlib, to_luastring } = require('fengari');
const helpers = require('./lua');

const ADDON_DIR = path.join(__dirname, '..', '..', 'addon', 'KeystoneLens');
const STUB = path.join(__dirname, 'wow_stub.lua');

/** Lua files in the order the .toc lists them. */
function tocFiles() {
  const toc = fs.readFileSync(path.join(ADDON_DIR, 'KeystoneLens.toc'), 'utf8');
  return toc
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Run one addon file the way the game does: with (addonName, namespace) as its arguments. */
function runAddonFile(L, file) {
  const code = fs.readFileSync(path.join(ADDON_DIR, file));
  let status = lauxlib.luaL_loadbuffer(L, code, null, to_luastring(`=${file}`));
  if (status === lua.LUA_OK) {
    lua.lua_pushstring(L, to_luastring('KeystoneLens'));
    lua.lua_getglobal(L, to_luastring('__ns'));
    status = lua.lua_pcall(L, 2, 0, 0);
  }
  if (status !== lua.LUA_OK) {
    const message = lua.lua_tojsstring(L, -1);
    lua.lua_pop(L, 1);
    throw new Error(message);
  }
}

/**
 * A Lua state with the stub, optional Lua code run before the addon (data files), the addon's
 * files, and ADDON_LOADED + PLAYER_LOGIN fired. `ns` is reachable as the global __ns.
 */
function loadAddon({ before = [], login = true } = {}) {
  const L = helpers.newState();
  helpers.run(L, fs.readFileSync(STUB, 'utf8'), 'wow_stub.lua');
  for (const code of before) helpers.run(L, code, 'data');
  helpers.run(L, '__ns = {}');
  for (const file of tocFiles()) runAddonFile(L, file);
  helpers.run(L, '__fire("ADDON_LOADED", "KeystoneLens")');
  if (login) helpers.run(L, '__fire("PLAYER_LOGIN"); __runTimers()');
  return L;
}

/** Errors the addon reported through the game's error handler (it keeps running after them). */
function errors(L) {
  const list = helpers.get(L, '__errors');
  return Array.isArray(list) ? list : Object.values(list || {});
}

module.exports = { ADDON_DIR, tocFiles, loadAddon, errors, ...helpers };

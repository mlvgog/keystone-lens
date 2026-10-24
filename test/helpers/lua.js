'use strict';

/**
 * A Lua VM for tests (fengari, Lua 5.3 in JavaScript). WoW runs Lua 5.1: the addon avoids
 * 5.2+ features, which test/addon.test.js checks separately.
 */

const { lua, lauxlib, lualib, to_luastring } = require('fengari');

function newState() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  return L;
}

/** Run Lua code; throws with Lua's message on errors. */
function run(L, code, name = 'chunk') {
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(`=${name}`)) || lua.lua_pcall(L, 0, 0, 0);
  if (status !== lua.LUA_OK) {
    const message = lua.lua_tojsstring(L, -1);
    lua.lua_pop(L, 1);
    throw new Error(message);
  }
}

/** The Lua value at `idx` as JS: tables become objects, or arrays when their keys are exactly 1..n. */
function toJs(L, idx, seen = new Set()) {
  const t = lua.lua_type(L, idx);
  if (t === lua.LUA_TNIL || t === lua.LUA_TNONE) return null;
  if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, idx);
  if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, idx);
  if (t === lua.LUA_TSTRING) return lua.lua_tojsstring(L, idx);
  if (t !== lua.LUA_TTABLE) return `<${lua.lua_typename(L, t)}>`;
  const abs = lua.lua_absindex(L, idx);
  const ptr = lua.lua_topointer(L, abs);
  if (seen.has(ptr)) return '<cycle>';
  seen.add(ptr);
  const out = {};
  lua.lua_pushnil(L);
  while (lua.lua_next(L, abs) !== 0) {
    const key = lua.lua_type(L, -2) === lua.LUA_TNUMBER ? String(lua.lua_tonumber(L, -2)) : lua.lua_tojsstring(L, -2);
    out[key] = toJs(L, -1, seen);
    lua.lua_pop(L, 1);
  }
  seen.delete(ptr);
  const keys = Object.keys(out);
  if (keys.length && keys.every((k, i) => k === String(i + 1))) return keys.map((k) => out[k]);
  return out;
}

/** A global (or a dotted path like "ns.data") as JS. */
function get(L, path) {
  run(L, `__kl_test_value = ${path}`);
  lua.lua_getglobal(L, to_luastring('__kl_test_value'));
  const value = toJs(L, -1);
  lua.lua_pop(L, 1);
  return value;
}

/** Evaluate a Lua expression and return it as JS. */
function evaluate(L, expr) {
  return get(L, `(${expr})`);
}

module.exports = { newState, run, toJs, get, evaluate };

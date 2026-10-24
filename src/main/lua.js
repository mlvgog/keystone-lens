'use strict';

/**
 * Lua data for the game addon: `toLua` writes the data file the addon loads, `parseLua`
 * reads the addon's SavedVariables file (written by the game). Data only: no code is run.
 *
 * Object keys that look like integers ("261") become numeric Lua keys ([261]): spec, node,
 * item and dungeon IDs are numbers in the game's API.
 */

const RESERVED = new Set(
  'and break do else elseif end false for function if in local nil not or repeat return then true until while goto'.split(' ')
);
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INT_KEY_RE = /^-?(0|[1-9]\d{0,14})$/;

/** A Lua string literal. Bytes outside printable ASCII use 3-digit escapes, so the text is plain ASCII. */
function luaString(text) {
  let out = '"';
  for (const byte of Buffer.from(String(text), 'utf8')) {
    if (byte === 0x22) out += '\\"';
    else if (byte === 0x5c) out += '\\\\';
    else if (byte === 0x0a) out += '\\n';
    else if (byte >= 0x20 && byte < 0x7f) out += String.fromCharCode(byte);
    else out += `\\${String(byte).padStart(3, '0')}`;
  }
  return `${out}"`;
}

function luaNumber(n) {
  if (!Number.isFinite(n)) return null;
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(6)));
}

function luaKey(key) {
  if (INT_KEY_RE.test(key)) return `[${key}]`;
  if (IDENT_RE.test(key) && !RESERVED.has(key)) return key;
  return `[${luaString(key)}]`;
}

/**
 * A JS value as a Lua expression. Arrays become sequences, objects keyed tables; null,
 * undefined, NaN and functions are left out (Lua tables have no nil values).
 * `indent`: spaces per level, or 0 for one line.
 */
function toLua(value, { indent = 0 } = {}, depth = 0) {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return luaNumber(value) ?? 'nil';
  if (typeof value === 'string') return luaString(value);
  if (typeof value !== 'object') return 'nil';

  const pad = indent ? `\n${' '.repeat(indent * (depth + 1))}` : '';
  const end = indent ? `\n${' '.repeat(indent * depth)}` : '';
  const sep = indent ? ',' : ', ';
  const fields = [];
  if (Array.isArray(value)) {
    // Holes would make the Lua length operator unreliable: keep them as explicit keys.
    const items = value.map((v) => toLua(v, { indent }, depth + 1));
    const dense = !items.includes('nil');
    items.forEach((lua, i) => {
      if (lua !== 'nil') fields.push(dense ? lua : `[${i + 1}] = ${lua}`);
    });
  } else {
    for (const [k, v] of Object.entries(value)) {
      const lua = toLua(v, { indent }, depth + 1);
      if (lua === 'nil') continue;
      fields.push(`${luaKey(k)} = ${lua}`);
    }
  }
  if (!fields.length) return '{}';
  return indent ? `{${pad}${fields.join(sep + pad)}${sep}${end}}` : `{ ${fields.join(sep)} }`;
}

// ------------------------------------------------------------------ reading

function parseError(message, pos) {
  const err = new Error(`${message} at character ${pos}`);
  err.code = 'BAD_LUA';
  return err;
}

const ESCAPES = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34, "'": 39, '\n': 10 };

/**
 * Reads assignments of Lua values (`Name = value`), as in a SavedVariables file:
 * { Name: value }. Tables become objects, or arrays when their keys are exactly 1..n.
 * Strings are decoded as UTF-8.
 */
function parseLua(source) {
  // One character per byte, so \ddd escapes and raw UTF-8 bytes can be decoded together.
  const s = Buffer.isBuffer(source) ? source.toString('latin1') : Buffer.from(String(source), 'utf8').toString('latin1');
  let i = 0;

  function skip() {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith('--', i)) {
        i += 2;
        const long = /^\[(=*)\[/.exec(s.slice(i, i + 64));
        if (long) {
          const close = `]${long[1]}]`;
          const endAt = s.indexOf(close, i);
          if (endAt < 0) throw parseError('Unfinished comment', i);
          i = endAt + close.length;
        } else {
          while (i < s.length && s[i] !== '\n') i++;
        }
        continue;
      }
      return;
    }
  }

  function expect(ch) {
    skip();
    if (s[i] !== ch) throw parseError(`Expected "${ch}"`, i);
    i++;
  }

  const utf8 = (bin) => Buffer.from(bin, 'latin1').toString('utf8');

  function quoted() {
    const q = s[i++];
    let out = '';
    for (;;) {
      if (i >= s.length) throw parseError('Unfinished string', i);
      const c = s[i++];
      if (c === q) return utf8(out);
      if (c === '\n') throw parseError('Line break in string', i);
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = s[i];
      if (/\d/.test(e)) {
        const digits = /^\d{1,3}/.exec(s.slice(i, i + 3))[0];
        i += digits.length;
        const byte = Number(digits);
        if (byte > 255) throw parseError('Bad escape', i);
        out += String.fromCharCode(byte);
      } else if (e === '\r') {
        i += s[i + 1] === '\n' ? 2 : 1;
        out += '\n';
      } else if (e in ESCAPES) {
        i++;
        out += String.fromCharCode(ESCAPES[e]);
      } else {
        throw parseError('Bad escape', i);
      }
    }
  }

  function longString() {
    const open = /^\[(=*)\[/.exec(s.slice(i, i + 64));
    i += open[0].length;
    if (s[i] === '\r') i++;
    if (s[i] === '\n') i++;
    const close = `]${open[1]}]`;
    const endAt = s.indexOf(close, i);
    if (endAt < 0) throw parseError('Unfinished string', i);
    const text = s.slice(i, endAt);
    i = endAt + close.length;
    return utf8(text);
  }

  function number() {
    const m = /^-?\s*(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(s.slice(i, i + 64));
    if (!m) throw parseError('Expected a value', i);
    i += m[0].length;
    const text = m[0].replace(/\s+/g, '');
    const n = /0x/i.test(text) ? (text.startsWith('-') ? -parseInt(text.slice(1), 16) : parseInt(text, 16)) : Number(text);
    if (!Number.isFinite(n)) throw parseError('Bad number', i);
    return n;
  }

  function word() {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i, i + 256));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  }

  function table() {
    expect('{');
    const out = {};
    let next = 1;
    for (;;) {
      skip();
      if (s[i] === '}') {
        i++;
        break;
      }
      let key;
      if (s[i] === '[' && s[i + 1] !== '[' && s[i + 1] !== '=') {
        i++;
        key = value();
        expect(']');
        expect('=');
      } else {
        const save = i;
        const name = word();
        skip();
        if (name && s[i] === '=' && s[i + 1] !== '=') {
          i++;
          key = name;
        } else {
          i = save;
          key = next++;
        }
      }
      const v = value();
      if (v !== null) out[String(key)] = v;
      skip();
      if (s[i] === ',' || s[i] === ';') i++;
      else if (s[i] !== '}') throw parseError('Expected "," or "}"', i);
    }
    const keys = Object.keys(out);
    if (keys.length && keys.every((k, idx) => k === String(idx + 1))) return keys.map((k) => out[k]);
    return out;
  }

  function value() {
    skip();
    const c = s[i];
    if (c === '{') return table();
    if (c === '"' || c === "'") return quoted();
    if (c === '[' && /^\[=*\[/.test(s.slice(i, i + 64))) return longString();
    if (c === '-' || c === '.' || /\d/.test(c)) return number();
    const w = word();
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'nil') return null;
    throw parseError('Expected a value', i);
  }

  const result = {};
  for (;;) {
    skip();
    if (i >= s.length) break;
    const name = word();
    if (!name) throw parseError('Expected a name', i);
    expect('=');
    const v = value();
    if (v !== null) result[name] = v;
    skip();
    if (s[i] === ';') i++;
  }
  return result;
}

module.exports = { toLua, luaString, parseLua };

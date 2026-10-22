// Shared renderer helpers.

// Icon image servers: raider.io's (the one its API links to), then Blizzard's own.
const ICON_SOURCES = ['https://cdn.raiderio.net/images/wow/icons/large/', 'https://render.worldofwarcraft.com/us/icons/56/'];
const QUESTION_MARK = 'inv_misc_questionmark';

export const QUALITY_COLORS = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80', '#00ccff'];

export function qualityColor(q) {
  return QUALITY_COLORS[q] || '#ffffff';
}

/** <img> for a WoW icon name; tries each icon server, then shows the question mark. */
export function iconImg(name, { size, cls } = {}) {
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  if (cls) img.className = cls;
  if (size) {
    img.width = size;
    img.height = size;
  }
  const icon = (name || QUESTION_MARK).toLowerCase();
  const attempts = [...ICON_SOURCES.map((base) => base + icon + '.jpg'), ICON_SOURCES[0] + QUESTION_MARK + '.jpg'];
  let i = 0;
  const next = () => {
    if (i < attempts.length) img.src = attempts[i++];
    else img.removeEventListener('error', next);
  };
  img.addEventListener('error', next);
  next();
  return img;
}

export function iconUrl(name) {
  return ICON_SOURCES[0] + (name || QUESTION_MARK).toLowerCase() + '.jpg';
}

/** Tiny DOM builder: el('div.cls#id', {attrs}, children...) */
export function el(tag, attrs, ...children) {
  const [, name = 'div', rest = ''] = /^([a-z0-9]+)?(.*)$/i.exec(tag);
  const node = document.createElement(name);
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    else node.id = part.slice(1);
  }
  if (attrs !== undefined && attrs !== null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function pct(x, digits = 0) {
  return `${(x * 100).toFixed(digits)}%`;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function relDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A pick-rate change (fraction) as "▲12" / "▼8" percentage points. */
export function fmtDelta(d) {
  return `${d > 0 ? '▲' : '▼'}${Math.round(Math.abs(d) * 100)}`;
}

/** "M+ · Murder Row", "Crafted · Tailoring", ... (`long` adds the boss). */
export function sourceText(source, long = false) {
  if (!source) return '';
  const parts = [source.label];
  if (source.detail) parts.push(source.detail);
  if (long && source.boss && source.boss !== source.detail) parts.push(source.boss);
  return parts.join(' · ');
}

let toastTimer = null;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

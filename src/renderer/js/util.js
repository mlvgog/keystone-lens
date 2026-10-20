// Shared renderer helpers.

const ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/large/';
const ICON_FALLBACK = 'https://cdn.raiderio.net/images/wow/icons/large/';

export const QUALITY_COLORS = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80', '#00ccff'];

export function qualityColor(q) {
  return QUALITY_COLORS[q] || '#ffffff';
}

const spellIconCache = new Map();
/** Wowhead's own icon name for a spell (raidbots sometimes uses '_' where wowhead uses '-'). */
function spellIcon(spellId) {
  if (!spellIconCache.has(spellId)) {
    spellIconCache.set(spellId, window.api.spellTooltip(spellId).then((t) => t?.icon || null).catch(() => null));
  }
  return spellIconCache.get(spellId);
}

/**
 * <img> for a WoW icon name. Falls back to wowhead's icon name for the spell (when a
 * spellId is given), then the raider.io CDN, then the question mark.
 */
export function iconImg(name, { size, cls, spellId } = {}) {
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  if (cls) img.className = cls;
  if (size) {
    img.width = size;
    img.height = size;
  }
  const icon = (name || 'inv_misc_questionmark').toLowerCase();
  const attempts = [() => ICON_BASE + icon + '.jpg'];
  if (spellId) {
    attempts.push(async () => {
      const alt = await spellIcon(spellId);
      return alt && alt.toLowerCase() !== icon ? ICON_BASE + alt.toLowerCase() + '.jpg' : null;
    });
  }
  attempts.push(() => ICON_FALLBACK + icon + '.jpg', () => ICON_BASE + 'inv_misc_questionmark.jpg');
  let i = 0;
  const next = async () => {
    while (i < attempts.length) {
      const url = await attempts[i++]();
      if (url) {
        img.src = url;
        return;
      }
    }
    img.removeEventListener('error', next);
  };
  img.addEventListener('error', next);
  next();
  return img;
}

export function iconUrl(name) {
  return ICON_BASE + (name || 'inv_misc_questionmark').toLowerCase() + '.jpg';
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

const SANITIZE = {
  ALLOWED_TAGS: ['table', 'tbody', 'thead', 'tr', 'td', 'th', 'span', 'b', 'i', 'u', 'br', 'div', 'small', 'em', 'strong', 'ul', 'li', 'p'],
  ALLOWED_ATTR: ['class', 'width'],
  KEEP_CONTENT: true,
};

/** Sanitised DOM fragment for third-party (wowhead) tooltip HTML. */
export function safeFragment(html) {
  const clean = window.DOMPurify.sanitize(String(html || ''), { ...SANITIZE, RETURN_DOM_FRAGMENT: true });
  return clean;
}

/** Wowhead tooltip HTML as plain text lines. */
export function tooltipLines(html) {
  const prepared = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<table/gi, '\n<table')
    .replace(/<\/(tr|div|table|p|li)>/gi, '\n</$1>')
    .replace(/<\/(td|th)>/gi, ' </$1>');
  const frag = safeFragment(prepared);
  return (frag.textContent || '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const SECONDARY = /^\+?([\d,]+)\s+(Critical Strike|Haste|Mastery|Versatility|Leech|Avoidance|Speed|Indestructible)$/i;
const PRIMARY = /^\+?([\d,]+)\s+(\[[^\]]+\]|Agility|Strength|Intellect|Stamina|Armor)$/i;

/** Pull the interesting bits out of an item tooltip for the compact item row. */
export function parseItemTooltip(html) {
  const lines = tooltipLines(html);
  const out = { primary: [], secondary: [], effects: [], track: null, slotType: null, sockets: 0, extra: [] };
  for (const line of lines) {
    let m;
    if ((m = SECONDARY.exec(line))) out.secondary.push({ value: m[1], stat: m[2] });
    else if ((m = PRIMARY.exec(line))) out.primary.push({ value: m[1], stat: m[2].replace(/^\[|\]$/g, '').replace(/ or /g, '/') });
    else if (/^(Equip|Use|Chance on hit):/i.test(line)) out.effects.push(line);
    else if (/^Upgrade Level:/i.test(line)) out.track = line.replace(/^Upgrade Level:\s*/i, '');
    else if (/Socket$/i.test(line)) out.sockets++;
    else if (/^Embellish|^Crafted|Crafting Quality|^Unique-Equipped: Embellished/i.test(line)) out.extra.push(line);
  }
  // The slot / armour type line, e.g. "Head Cloth", "Two-Hand Staff", "One-Hand Dagger"
  const slotLine = lines.find((l) =>
    /^(Head|Neck|Shoulder|Back|Chest|Wrist|Hands|Waist|Legs|Feet|Finger|Trinket|One-Hand|Two-Hand|Main Hand|Off Hand|Held In Off-hand|Ranged)\b/i.test(l)
  );
  if (slotLine) out.slotType = slotLine;
  return out;
}

const SHORT_STAT = {
  'Critical Strike': 'Crit',
  Haste: 'Haste',
  Mastery: 'Mastery',
  Versatility: 'Vers',
  Leech: 'Leech',
  Avoidance: 'Avoidance',
  Speed: 'Speed',
  Indestructible: 'Indestructible',
};
export function shortStat(stat) {
  return SHORT_STAT[stat] || stat;
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

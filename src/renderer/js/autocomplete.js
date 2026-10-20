import { el } from './util.js';

/** Case-, accent- and punctuation-insensitive form used for matching ("Mal'Ganis" -> "malganis"). */
export function fold(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’\s-]/g, '');
}

/**
 * Items matching `query`, best first: prefix matches before substring matches, then
 * alphabetical. `keysOf(item)` lists the strings to match (e.g. English + localized name).
 */
export function matchItems(items, query, keysOf, max = 10) {
  const q = fold(query);
  if (!q) return items.slice(0, max);
  const scored = [];
  for (const item of items) {
    let best = Infinity;
    for (const key of keysOf(item)) {
      const k = fold(key);
      if (!k) continue;
      if (k.startsWith(q)) best = Math.min(best, 0);
      else if (k.includes(q)) best = Math.min(best, 1);
    }
    if (best < Infinity) scored.push({ item, best, label: String(keysOf(item)[0] || '') });
  }
  scored.sort((a, b) => a.best - b.best || a.label.localeCompare(b.label));
  return scored.slice(0, max).map((s) => s.item);
}

/**
 * Suggestion list under a text input.
 * options: { source(query) -> items | Promise<items>, render(item) -> Node|Node[], onPick(item), minChars }
 * The list lives inside the enclosing modal (if any) so it disappears with it.
 */
export function attachAutocomplete(input, { source, render, onPick, minChars = 1 }) {
  const list = el('div.ac-list');
  list.hidden = true;
  let items = [];
  let active = -1;
  let timer = null;
  let token = 0;

  const host = () => input.closest('.modal-overlay') || document.body;

  function close() {
    list.hidden = true;
    items = [];
    active = -1;
  }

  function highlight() {
    [...list.children].forEach((row, i) => row.classList.toggle('active', i === active));
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function position() {
    const r = input.getBoundingClientRect();
    list.style.left = `${r.left}px`;
    list.style.top = `${r.bottom + 2}px`;
    list.style.minWidth = `${r.width}px`;
  }

  function pick(i) {
    const item = items[i];
    close();
    if (item) onPick(item);
  }

  async function update() {
    const query = input.value.trim();
    const mine = ++token;
    if (query.length < minChars || document.activeElement !== input) return close();
    const found = await source(query);
    if (mine !== token || document.activeElement !== input) return;
    items = found || [];
    if (!items.length) return close();
    list.replaceChildren(
      ...items.map((item, i) => {
        const row = el('div.ac-item', render(item));
        // mousedown (not click) so the input does not lose focus first
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(i);
        });
        row.addEventListener('mousemove', () => {
          if (active !== i) {
            active = i;
            highlight();
          }
        });
        return row;
      })
    );
    if (list.parentNode !== host()) host().append(list);
    active = 0;
    position();
    list.hidden = false;
    highlight();
  }

  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 60);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= minChars) update();
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('keydown', (e) => {
    if (list.hidden) {
      if (e.key === 'ArrowDown') update();
      return;
    }
    if (e.key === 'ArrowDown') {
      active = (active + 1) % items.length;
      highlight();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = (active - 1 + items.length) % items.length;
      highlight();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (active >= 0) {
        pick(active);
        e.preventDefault();
        e.stopImmediatePropagation(); // don't also submit the form with the half-typed text
      }
    } else if (e.key === 'Escape') {
      close();
      e.stopPropagation();
      e.preventDefault();
    } else if (e.key === 'Tab') {
      close();
    }
  });

  return { close, refresh: update };
}

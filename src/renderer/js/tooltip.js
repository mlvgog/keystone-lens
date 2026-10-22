// A single floating GameTooltip that follows the cursor, optionally with Wowhead's own tooltip
// beside it (see wowheadTooltip.js).

import { showWowhead, moveWowhead, hideWowhead } from './wowheadTooltip.js';

const tip = () => document.getElementById('tooltip');
let owner = null;
let lastEvent = null;
let withWowhead = false;

function place(ev) {
  const t = tip();
  if (t.hidden || !ev) return;
  const pad = 16;
  const { innerWidth: W, innerHeight: H } = window;
  const r = t.getBoundingClientRect();
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + r.width > W - 6) x = ev.clientX - r.width - pad;
  if (y + r.height > H - 6) y = Math.max(6, H - r.height - 6);
  t.style.left = `${Math.max(6, x)}px`;
  t.style.top = `${y}px`;
  if (withWowhead) moveWowhead(t.getBoundingClientRect());
}

// Content can grow after it is shown.
new ResizeObserver(() => place(lastEvent)).observe(tip());

/** Each top-level node becomes its own GameTooltip box (like WoW's side-by-side comparison tooltips). */
function boxes(content) {
  const list = Array.isArray(content) ? content : [content];
  return list.filter(Boolean).map((node) => {
    if (node.classList?.contains('tt-box')) return node;
    const box = document.createElement('div');
    box.className = 'tt-box';
    box.append(node);
    return box;
  });
}

/**
 * Attach a tooltip to `target`. `build()` returns the content: a Node, or an array of Nodes that
 * are shown as separate boxes side by side. `wowhead()` (optional) returns what Wowhead's tooltip
 * shows next to it, e.g. "item=123&ilvl=600" (see wowheadTooltip.itemRef / spellRef).
 */
export function attachTooltip(target, build, { wowhead } = {}) {
  target.addEventListener('mouseenter', (ev) => {
    owner = target;
    lastEvent = ev;
    const t = tip();
    t.replaceChildren(...boxes(build()));
    t.hidden = false;
    const what = wowhead?.() || null;
    withWowhead = !!what;
    place(ev);
    if (what) showWowhead(what, t.getBoundingClientRect());
    else hideWowhead();
  });
  target.addEventListener('mousemove', (ev) => {
    lastEvent = ev;
    if (owner === target) place(ev);
  });
  target.addEventListener('mouseleave', () => {
    if (owner === target) hideTooltip();
  });
}

export function hideTooltip() {
  owner = null;
  tip().hidden = true;
  if (withWowhead) hideWowhead();
  withWowhead = false;
}

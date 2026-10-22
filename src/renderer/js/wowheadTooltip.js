// Wowhead's own tooltips (official tooltips script), shown beside the app's tooltip box.
// The script runs in a sandboxed frame over the window (wowhead-frame.html); this module only
// tells it what to show and where the app's box is.

let frame = null;
let ready = false;
let pending = null;
let domain = '';

function post(message) {
  if (!frame) return;
  if (!ready) {
    pending = message.type === 'hide' ? null : message;
    return;
  }
  frame.contentWindow.postMessage(message, '*');
}

/** Create the frame once the page is up. */
export function initWowheadTooltips() {
  if (frame) return;
  frame = document.createElement('iframe');
  frame.src = 'wowhead-frame.html';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.className = 'wowhead-layer';
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || e.data?.type !== 'ready') return;
    ready = true;
    if (pending) post(pending);
    pending = null;
  });
  document.body.append(frame);
}

/** Tooltip language, as a Wowhead domain ('' = English, 'de', 'fr', ...). */
export function setWowheadDomain(value) {
  domain = /^[a-z]{0,2}$/.test(value || '') ? value || '' : '';
}

function withDomain(what) {
  return domain ? `${what}&domain=${domain}` : what;
}

/** "item=ID&bonus=1:2&ilvl=N[&gems=a:b]" for an item variant. */
export function itemRef({ id, bonuses = [], ilvl, gems = [] }) {
  if (!id) return null;
  let ref = `item=${Number(id)}`;
  const b = bonuses.map(Number).filter(Boolean);
  if (b.length) ref += `&bonus=${b.join(':')}`;
  if (ilvl) ref += `&ilvl=${Number(ilvl)}`;
  const g = gems.map(Number).filter(Boolean);
  if (g.length) ref += `&gems=${g.join(':')}`;
  return ref;
}

export function spellRef(spellId) {
  return spellId ? `spell=${Number(spellId)}` : null;
}

function anchorOf(rect) {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

export function showWowhead(what, rect) {
  if (!what) return hideWowhead();
  post({ type: 'show', what: withDomain(what), anchor: anchorOf(rect) });
}

export function moveWowhead(rect) {
  post({ type: 'move', anchor: anchorOf(rect) });
}

export function hideWowhead() {
  post({ type: 'hide' });
}

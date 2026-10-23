import { el, iconImg, clear, pct, toast, fmtDelta } from './util.js';
import { attachTooltip, hideTooltip } from './tooltip.js';
import { spellRef } from './wowheadTooltip.js';

const UNIT = 600; // game position units per grid cell
const CELL = 60; // px per grid cell
const PAD_X = 52;
const PAD_TOP = 34;
const PAD_BOTTOM = 42;
const SVG_NS = 'http://www.w3.org/2000/svg';

function pickClass(p, picked) {
  if (!picked) return 'p-zero';
  if (p >= 0.75) return 'p-gold';
  if (p >= 0.25) return 'p-green';
  return 'p-grey';
}

function shapeClass(node) {
  if (node.type === 'tiered') return 'tiered';
  if (node.type === 'choice') return 'choice';
  return node.entries[0]?.type === 'active' ? 'active' : 'passive';
}

function lineStyle(v) {
  // grey -> green -> gold as the path gets more popular
  const stops = [
    [0, [70, 70, 70]],
    [0.35, [63, 170, 63]],
    [0.75, [255, 209, 0]],
    [1, [255, 225, 90]],
  ];
  let c = stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (v - a) / (b - a || 1);
      c = ca.map((x, k) => Math.round(x + (cb[k] - x) * t));
      break;
    }
  }
  return { color: `rgb(${c.join(',')})`, width: 2 + 2.5 * v, opacity: 0.45 + 0.55 * v };
}

function mostCommonRank(ranks) {
  let best = null;
  for (const [r, c] of Object.entries(ranks || {})) if (!best || c > best[1]) best = [Number(r), c];
  return best ? best[0] : 0;
}

function majorityEntry(stats) {
  return Object.entries(stats.entries || {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** nodeId -> { entryId, rank } for a talent loadout. */
export function pickMap(talents) {
  const m = new Map();
  for (const n of talents?.nodes || []) if (n.rank > 0 && !m.has(n.nodeId)) m.set(n.nodeId, n);
  return m;
}

const EMPTY_STATS = { picked: 0, total: 0, pct: 0, ranks: {}, entries: {}, avgRank: 0 };

/** The entry whose description Wowhead's tooltip shows: the pick (player's, then yours), else the most popular. */
function describedEntry(node, stats, d) {
  if (node.type !== 'choice') return node.entries[0];
  const id = d.pick?.entryId ?? d.you?.entryId ?? majorityEntry(stats);
  return node.entries.find((e) => String(e.id) === String(id)) || node.entries[0];
}

function entryName(node, entryId) {
  return node.entries.find((e) => e.id === Number(entryId))?.name || node.entries[0]?.name || node.name;
}

function pickText(node, pick) {
  if (!pick) return 'not taken';
  if (node.type === 'choice') return entryName(node, pick.entryId);
  if (node.maxRanks > 1) return `rank ${pick.rank}/${node.maxRanks}`;
  return 'taken';
}

function nodeTooltip(node, stats, d) {
  const kind =
    node.type === 'tiered' ? 'Apex talent' : node.type === 'choice' ? 'Choice node' : node.entries[0]?.type === 'active' ? 'Active ability' : 'Passive';
  const title = node.type === 'choice' ? node.entries.map((e) => e.name).join(' / ') : node.entries[0]?.name || node.name;
  const box = el(
    'div',
    el('div.tt-title', title),
    el('div.tt-grey', `${kind}${node.maxRanks > 1 ? ` · ${node.maxRanks} ranks` : ''}${node.freeNode ? ' · granted for free' : ''}`)
  );

  if (d.mode === 'player') {
    box.append(el(d.pick ? 'div.tt-gold' : 'div.tt-grey', `${d.playerName}: ${pickText(node, d.pick)}`));
  }
  if (stats.total) box.append(el('div.tt-gold', `Picked by ${stats.picked} / ${stats.total} ${d.scopeLabel} (${pct(stats.pct)})`));
  if (d.you !== undefined) box.append(el(d.you ? 'div.tt-you' : 'div.tt-you.missing', `You: ${pickText(node, d.you)}`));
  if (d.trend) box.append(el(d.trend > 0 ? 'div.tt-green' : 'div.tt-red', `${fmtDelta(d.trend)} points since ${d.trendSince}`));
  if (d.isDiff) box.append(el('div.tt-cyan', 'This build differs from the overall majority here'));

  if (node.maxRanks > 1 && stats.picked && d.mode !== 'player') {
    const ranks = Object.entries(stats.ranks).sort((a, b) => Number(b[0]) - Number(a[0]));
    for (const [r, c] of ranks) box.append(el('div.tt-row', el('span', `Rank ${r}/${node.maxRanks}`), el('span.tt-green', `${c} players`)));
    box.append(el('div.tt-grey', `Average rank: ${stats.avgRank.toFixed(2)}`));
  }

  if (node.type === 'choice') {
    for (const e of node.entries) {
      const n = stats.entries[e.id] || 0;
      const chosen = d.pick && d.pick.entryId === e.id;
      box.append(el('div.tt-sep'));
      box.append(
        el(
          'div.tt-choice',
          iconImg(e.icon, { cls: 'icon' }),
          el(
            'div',
            el(
              'div.tt-row',
              el('span', e.name, chosen ? el('span.tt-gold', ' ✔') : null),
              stats.total ? el('span.tt-gold', `${n} (${pct(n / stats.total)})`) : null
            ),
          )
        )
      );
    }
  } else if (node.type === 'tiered') {
    let rank = 0;
    node.entries.forEach((e, i) => {
      const from = rank + 1;
      rank += e.maxRanks || 1;
      box.append(el('div.tt-sep'));
      box.append(
        el(
          'div.tt-choice',
          iconImg(e.icon, { cls: 'icon' }),
          el('div', `Tier ${i + 1} · rank ${from === rank ? from : `${from}–${rank}`}`)
        )
      );
    });
  }
  return box;
}

/**
 * One talent node. `d` (decorations):
 *   mode 'overview' | 'player', pick (the inspected player's pick), you (your pick or null,
 *   undefined when not comparing), trend (pick-rate change), isDiff, scopeLabel, playerName.
 */
function nodeElement(node, stats, d) {
  const shape = shapeClass(node);
  const player = d.mode === 'player';
  const level = player ? (d.pick ? 'p-gold' : 'p-zero') : pickClass(stats.pct, stats.picked);
  const inner = el('div.inner');
  if (node.type === 'choice' && node.entries.length >= 2 && !(player && d.pick)) {
    for (const e of node.entries.slice(0, 2)) inner.append(el('div.half', iconImg(e.icon)));
  } else {
    const entry = (player && d.pick && node.entries.find((e) => e.id === d.pick.entryId)) || node.entries[0];
    inner.append(iconImg(entry?.icon));
  }

  const nodeEl = el(`div.tnode.${shape}.${level}`, el('div.shape', inner));
  if (player) {
    if (d.pick && node.maxRanks > 1) nodeEl.append(el('div.rank', `${d.pick.rank}/${node.maxRanks}`));
  } else {
    if (node.type === 'choice' && node.entries.length >= 2 && stats.total) {
      const [a, b] = node.entries.map((e) => (stats.entries[e.id] || 0) / stats.total);
      nodeEl.append(el('div.pct', `${Math.round(a * 100)}`, el('span.sep', '|'), `${Math.round(b * 100)}%`));
    } else {
      nodeEl.append(el('div.pct', pct(stats.pct)));
    }
    if (node.maxRanks > 1 && stats.picked) nodeEl.append(el('div.rank', `${mostCommonRank(stats.ranks)}/${node.maxRanks}`));
  }

  if (d.isDiff) nodeEl.classList.add('diff');
  if (d.trend) nodeEl.append(el(`div.trend.${d.trend > 0 ? 'up' : 'down'}`, fmtDelta(d.trend)));
  if (d.you !== undefined && stats.total) {
    if (d.you) {
      nodeEl.append(el('div.you-mark', '✔'));
      const minority =
        stats.pct < 0.25 || (node.type === 'choice' && majorityEntry(stats) != null && String(d.you.entryId) !== majorityEntry(stats));
      if (minority) nodeEl.classList.add('you-rare');
    } else if (stats.pct >= 0.75) {
      nodeEl.classList.add('you-missing');
    }
  }
  attachTooltip(nodeEl, () => nodeTooltip(node, stats, d), { wowhead: () => spellRef(describedEntry(node, stats, d)?.spellId) });
  return nodeEl;
}

/** Render one tree (class, spec or a hero sub-tree) into a positioned block. */
function renderTree(nodes, nodeStats, decorate) {
  const xs = nodes.map((n) => n.posX);
  const ys = nodes.map((n) => n.posY);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = PAD_X * 2 + ((maxX - minX) / UNIT) * CELL;
  const height = PAD_TOP + PAD_BOTTOM + ((maxY - minY) / UNIT) * CELL;
  const pos = new Map(nodes.map((n) => [n.id, { x: PAD_X + ((n.posX - minX) / UNIT) * CELL, y: PAD_TOP + ((n.posY - minY) / UNIT) * CELL }]));

  const block = el('div.tree', { style: { width: `${width}px`, height: `${height}px` } });

  // gates ("X points required")
  const gates = new Map();
  for (const n of nodes) {
    if (!n.reqPoints) continue;
    const y = pos.get(n.id).y;
    if (!gates.has(n.reqPoints) || y < gates.get(n.reqPoints)) gates.set(n.reqPoints, y);
  }
  for (const [points, y] of gates) {
    block.append(el('div.gate', { style: { top: `${y - CELL / 2 - 2}px` } }, el('span', { title: `Requires ${points} points spent` }, `${points} pts`)));
  }

  // connections
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const strength = (id) => decorate.lineValue(id, nodeStats[id] || EMPTY_STATS);
  const ordered = [];
  for (const n of nodes) {
    for (const nextId of n.next || []) {
      if (!pos.has(nextId)) continue;
      ordered.push({ from: pos.get(n.id), to: pos.get(nextId), v: Math.min(strength(n.id), strength(nextId)) });
    }
  }
  ordered.sort((p, q) => p.v - q.v); // popular paths drawn on top
  for (const { from, to, v } of ordered) {
    const s = lineStyle(v);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y);
    line.setAttribute('x2', to.x);
    line.setAttribute('y2', to.y);
    line.setAttribute('stroke', s.color);
    line.setAttribute('stroke-width', s.width.toFixed(1));
    line.setAttribute('stroke-opacity', s.opacity.toFixed(2));
    line.setAttribute('stroke-linecap', 'round');
    if (v >= 0.75) line.setAttribute('filter', 'drop-shadow(0 0 2px rgba(255,209,0,0.6))');
    svg.append(line);
  }
  block.append(svg);

  for (const n of nodes) {
    const p = pos.get(n.id);
    const nodeEl = nodeElement(n, nodeStats[n.id] || EMPTY_STATS, decorate.node(n));
    nodeEl.style.left = `${p.x}px`;
    nodeEl.style.top = `${p.y}px`;
    block.append(nodeEl);
  }
  return block;
}

function buildCard(b, active, onFilter) {
  const sign = { add: '+', drop: '−', swap: '⇄' };
  const diffs = b.diffs.slice(0, 3).map((x) => el(`span.diff-${x.kind}`, `${sign[x.kind]} ${x.name}`));
  const copy = el('button.wow-btn.tiny', { title: `Copy ${b.medoidName}'s talent import string` }, 'Copy');
  copy.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!b.loadoutText) return toast('No import string available for this build');
    await window.api.copy(b.loadoutText);
    toast(`Copied build ${b.index} (${b.medoidName})`);
  });
  const card = el(
    'div.build-card',
    { onclick: () => onFilter({ build: active ? null : b.id }) },
    el('div.build-head', el('span.build-name', `Build ${b.index}`), el('span.dim', b.heroName || ''), copy),
    el('div.build-size', el('b', String(b.size)), ` players · ${pct(b.pct)}`),
    el('div.build-diffs', diffs.length ? diffs : el('span.faint', 'Closest to the overall majority'))
  );
  if (active) card.classList.add('active');
  attachTooltip(card, () =>
    el(
      'div',
      el('div.tt-title', `Build ${b.index} — ${b.size} players`),
      el('div.tt-grey', `${b.heroName || ''} · represented by ${b.medoidName}`),
      el('div.tt-sep'),
      b.diffs.length
        ? b.diffs.map((x) =>
            el('div', x.kind === 'swap' ? `⇄ ${x.name} instead of ${x.from}` : `${x.kind === 'add' ? '+ takes' : '− skips'} ${x.name}`)
          )
        : el('div.tt-grey', 'Matches the overall majority'),
      el('div.tt-sep'),
      el('div.tt-gold', active ? 'Click to show all players again' : 'Click to show only this build')
    )
  );
  return card;
}

/**
 * Talents tab: class tree | hero tree | spec tree, scaled to fit.
 * ctx: { meta, tree, view, filters, inspect (player detail | null), character (| null),
 *        trendSince (label), onFilter(patch) }
 */
export function renderTalents(container, ctx) {
  clear(container);
  const { meta, tree, view, filters, inspect, character } = ctx;
  const mode = inspect ? 'player' : 'overview';
  const stats = view.talents.nodes;

  if (!inspect && !view.sampleSize) {
    container.append(el('div.empty-state', 'No players match these filters.'));
    return () => {};
  }

  const picks = inspect ? pickMap(inspect.talents) : null;
  const yours = character && !inspect ? pickMap(character.talents) : null;
  const trends = !inspect ? view.trends : null;
  // Rings: where a selected build differs from the majority, or what changes on a raid boss.
  const diff = new Set(!inspect ? [...view.diffNodes, ...(view.bossDiff || []).map((d) => d.nodeId)] : []);
  const heroIds = view.hero.map((h) => h.id);
  // Default to the hero tree most of the *shown* players use (e.g. a selected build's hero tree).
  // When comparing, start on your own hero tree.
  const yourHero = character && heroIds.includes(character.talents.heroSubTreeId) ? character.talents.heroSubTreeId : null;
  let heroId = inspect ? inspect.talents.heroSubTreeId : filters.hero ?? (filters.build ? null : yourHero) ?? view.talents.hero[0]?.id ?? heroIds[0] ?? null;
  const fixedHero = !!inspect || filters.hero != null;

  const decorate = (scopeLabel) => ({
    node: (n) => ({
      mode,
      scopeLabel,
      playerName: inspect?.name,
      pick: picks ? picks.get(n.id) || null : undefined,
      you: yours ? yours.get(n.id) || null : undefined,
      trend: trends?.nodes?.[n.id] || 0,
      trendSince: ctx.trendSince,
      isDiff: diff.has(n.id),
    }),
    lineValue: (id, s) => (picks ? (picks.has(id) ? 1 : 0) : s.pct),
  });

  const frame = el('div.talent-frame');
  frame.style.setProperty('--class-color', meta.color || '#ffd100');
  const heroCol = el('div.tree-col');
  const classCol = el('div.tree-col', el('div.tree-title', meta.className), renderTree(tree.classNodes, stats, decorate('players')));
  const specCol = el('div.tree-col', el('div.tree-title', meta.specName), renderTree(tree.specNodes, stats, decorate('players')));

  function renderHero() {
    clear(heroCol);
    const current = view.hero.find((h) => h.id === heroId);
    heroCol.append(el('div.tree-title', fixedHero && current ? `Hero Talents · ${current.name}` : 'Hero Talents'));
    if (!fixedHero) {
      const switcher = el('div.hero-switch');
      for (const h of view.hero) {
        const btn = el(
          'button.hero-btn',
          { onclick: () => { heroId = h.id; renderHero(); fit(); } },
          iconImg(h.icon),
          el('span', h.name, ' ', el('b', pct(h.pct)))
        );
        if (h.id === heroId) btn.classList.add('active');
        attachTooltip(btn, () =>
          el('div', el('div.tt-title', h.name), el('div.tt-gold', `Chosen by ${h.count} / ${view.baseSize} players (${pct(h.pct)})`), el('div.tt-grey', 'Click to show this hero tree'))
        );
        switcher.append(btn);
      }
      heroCol.append(switcher);
    }
    const heroNodes = tree.heroNodes.filter((n) => n.subTreeId === heroId);
    if (heroNodes.length) heroCol.append(renderTree(heroNodes, stats, decorate(`players on ${current?.name || 'this hero tree'}`)));
    else heroCol.append(el('div.dim', { style: { padding: '30px' } }, 'No hero talent data.'));
  }
  renderHero();

  const caption = el('div.tree-caption', captionText(ctx));
  frame.append(el('div.tree-row', classCol, heroCol, specCol), caption);

  const zoomBox = el('div', frame);
  const wrap = el('div.talent-wrap', zoomBox);
  container.append(
    ...[toolbar(ctx, mode, () => exportImage), mode === 'overview' ? buildsStrip(ctx) : null, mode === 'overview' ? bossDiffCard(ctx) : null, wrap].filter(Boolean)
  );

  function fit() {
    zoomBox.style.zoom = 1;
    const naturalW = frame.offsetWidth;
    const naturalH = frame.offsetHeight;
    const availW = wrap.clientWidth - 24;
    const availH = wrap.clientHeight - 24;
    const z = Math.max(0.5, Math.min(1.35, availW / naturalW, availH / naturalH));
    zoomBox.style.zoom = z;
  }

  async function exportImage(how) {
    hideTooltip();
    wrap.scrollTop = 0;
    fit();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = frame.getBoundingClientRect();
    const name = `${meta.specName} ${meta.className} talents${inspect ? ` - ${inspect.name}` : ''}`;
    const res = await window.api.exportImage({ x: r.x, y: r.y, width: r.width, height: r.height }, how, name);
    if (res?.ok) toast(how === 'copy' ? 'Talent tree image copied to the clipboard' : `Saved ${res.filePath}`);
  }

  const ro = new ResizeObserver(() => fit());
  ro.observe(wrap);
  requestAnimationFrame(fit);
  return () => ro.disconnect();
}

function captionText({ meta, view, filters, inspect }) {
  const region = meta.region === 'world' ? 'World' : meta.region.toUpperCase();
  const parts = [`${meta.specName} ${meta.className}`];
  const raid = meta.mode === 'raid';
  if (inspect) parts.push(`${inspect.name} — ${inspect.realm} (${String(inspect.region).toUpperCase()})`, raid ? inspect.run.dungeon : `+${inspect.run.level} ${inspect.run.dungeon}`);
  else parts.push(raid ? `Top ${view.sampleSize} ${meta.difficultyName} raid ${view.dungeon ? 'kills' : 'players'}` : `Top ${view.sampleSize} M+ players`);
  if (raid) parts.push(meta.zone.name);
  else parts.push(region, `Patch ${meta.patch || '?'}`);
  if (!inspect && view.dungeon) parts.push(view.dungeon.name);
  if (!inspect && filters.hero != null) parts.push(view.hero.find((h) => h.id === filters.hero)?.name || '');
  if (!inspect && filters.build) parts.push(`Build ${view.builds.list.find((b) => b.id === filters.build)?.index ?? ''}`);
  parts.push(new Date(meta.generatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
  return parts.filter(Boolean).join('  ·  ');
}

function toolbar(ctx, mode, getExport) {
  const { view, inspect } = ctx;
  const legend =
    mode === 'player'
      ? el(
          'div.legend',
          el('span', el('i', { style: { background: 'var(--pick-gold)' } }), `Taken by ${inspect.name}`),
          el('span', el('i', { style: { background: '#2a2a2a', border: '1px solid #555' } }), 'Not taken'),
          el('span.faint', 'Hover a talent to see how popular it is')
        )
      : el(
          'div.legend',
          el('span', el('i', { style: { background: 'var(--pick-gold)' } }), '≥ 75%'),
          el('span', el('i', { style: { background: 'var(--pick-green)' } }), '25–75%'),
          el('span', el('i', { style: { background: 'var(--pick-grey)' } }), '< 25%'),
          el('span', el('i', { style: { background: '#2a2a2a', border: '1px solid #555' } }), 'never'),
          ctx.character ? el('span', el('i.you-legend'), 'your picks') : null,
          view.diffNodes.length ? el('span', el('i.diff-legend'), 'differs from majority') : null,
          view.bossDiff?.length ? el('span', el('i.diff-legend'), `picked differently on ${view.dungeon?.name || 'this boss'}`) : null,
          el('span.faint', 'choice nodes: left | right')
        );

  const loadout = mode === 'player' ? inspect.talents.loadoutText : view.talents.representative?.loadoutText;
  const copyBtn = el(
    'button.wow-btn.small',
    {
      disabled: !loadout,
      title:
        mode === 'player'
          ? `Copy ${inspect.name}'s talent import string`
          : view.talents.representative
            ? `${view.talents.representative.name}'s build matches the most common choices (${pct(view.talents.representative.agreement)} agreement)`
            : '',
      onclick: async () => {
        await window.api.copy(loadout);
        toast(mode === 'player' ? `Copied ${inspect.name}'s talent import string` : `Copied ${view.talents.representative.name}'s talent import string`);
      },
    },
    mode === 'player' ? 'Copy build' : 'Copy most common build'
  );
  const saveBtn = el('button.wow-btn.small', { onclick: () => getExport()('save'), title: 'Save the talent tree as a PNG image' }, 'Save image');
  const copyImgBtn = el('button.wow-btn.small', { onclick: () => getExport()('copy'), title: 'Copy the talent tree image (paste into Discord)' }, 'Copy image');
  return el('div.talent-toolbar', legend, el('div.spacer'), copyBtn, saveBtn, copyImgBtn);
}

/** Raid mode, one boss: the talents picked noticeably differently than on the other bosses. */
function bossDiffCard({ view, meta }) {
  if (meta.mode !== 'raid' || !view.dungeon || !view.bossDiff) return null;
  const card = el('div.boss-diff.inset', el('span.wow-header', `Picked differently on ${view.dungeon.name}`));
  if (!view.bossDiff.length) {
    card.append(el('span.faint', 'Nothing stands out: the top players use the same talents here as on the other bosses.'));
    return card;
  }
  for (const d of view.bossDiff) {
    const up = d.boss > d.others;
    card.append(
      el(
        'span.boss-diff-item',
        { title: `${pct(d.boss)} of the top players here, ${pct(d.others)} on the other bosses` },
        iconImg(d.icon, { cls: 'mini-icon' }),
        ` ${d.name} `,
        el(up ? 'b.tt-green' : 'b.tt-red', `${pct(d.boss)}`),
        el('span.faint', ` vs ${pct(d.others)}`)
      )
    );
  }
  return card;
}

function buildsStrip({ view, filters, onFilter }) {
  const list = view.builds.list.filter((b) => filters.hero == null || b.heroSubTreeId === filters.hero || b.id === filters.build);
  const strip = el('div.builds-strip');
  if (!list.length) {
    strip.append(el('div.faint.builds-empty', 'No common builds — every player runs a noticeably different build.'));
    return strip;
  }
  strip.append(el('div.builds-label', el('span.wow-header', 'Popular builds'), el('span.faint', `${view.builds.singles} unique`)));
  for (const b of list) strip.append(buildCard(b, filters.build === b.id, onFilter));
  return strip;
}

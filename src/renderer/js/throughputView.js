import { el, clear, pct, relDate } from './util.js';
import { attachTooltip } from './tooltip.js';
import { castbar } from './progress.js';

const FEW = 5; // fewer logged runs than this: shown, but greyed out
const LEVELS = Array.from({ length: 29 }, (_, i) => i + 2);

/** 242452 -> "242k", 1250000 -> "1.25M" */
export function fmtAmount(x) {
  if (x == null || !Number.isFinite(x)) return '–';
  if (x >= 1e6) return `${(x / 1e6).toFixed(x >= 1e7 ? 1 : 2)}M`;
  if (x >= 1e4) return `${Math.round(x / 1e3)}k`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}k`;
  return String(Math.round(x));
}

function fmtDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtPct(d) {
  if (d == null) return '';
  const v = Math.round(d * 100);
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}%`;
}

function deltaClass(d) {
  if (d == null) return 'na';
  if (d >= 0.03) return 'up';
  if (d <= -0.03) return 'down';
  return 'even';
}

function logUrl(r) {
  return r.report ? `https://www.warcraftlogs.com/reports/${r.report}${r.fight != null ? `#fight=${r.fight}` : ''}` : null;
}

function cellTooltip(rowName, colLabel, s, unit, groupBy) {
  return el(
    'div',
    el('div.tt-title', `${rowName} · ${groupBy === 'ilvl' ? `item level ${colLabel}` : colLabel}`),
    el('div.tt-gold', `Median ${fmtAmount(s.median)} ${unit} · average ${fmtAmount(s.mean)}`),
    el('div', `Middle half of runs: ${fmtAmount(s.p25)} – ${fmtAmount(s.p75)}`),
    el('div.tt-grey', `Lowest ${fmtAmount(s.min)} · highest ${fmtAmount(s.max)}`),
    s.ilvl ? el('div.tt-grey', `Average item level ${s.ilvl.toFixed(1)}`) : null,
    el('div.tt-grey', `Average run time ${fmtDuration(s.duration)}`),
    el('div.tt-sep'),
    el(s.n < FEW ? 'div.tt-red' : 'div.tt-grey', `Based on ${s.n} logged run${s.n === 1 ? '' : 's'}${s.n < FEW ? ' — too few to be reliable' : ''}`)
  );
}

function yourTooltip(r, unit) {
  return el(
    'div',
    el('div.tt-title', `You · +${r.level}`),
    el('div.tt-gold', `${fmtAmount(r.amount)} ${unit} · ${relDate(r.start ? new Date(r.start).toISOString() : null)}`),
    r.median != null
      ? [
          el('div', `Spec median at +${r.level}: ${fmtAmount(r.median)} (${fmtPct(r.delta)})`),
          el('div', `Better than ${pct(r.percentile)} of ${r.n} other logged runs`),
        ]
      : el('div.tt-grey', `Only ${r.n} other logged run${r.n === 1 ? '' : 's'} at +${r.level} — not enough to compare`),
    el('div.tt-grey', `Run time ${fmtDuration(r.duration)}`)
  );
}

function setupPanel(openSettings) {
  return el(
    'div.tp-setup.inset',
    el('div.wow-header', 'Damage and healing need Warcraft Logs'),
    el('p.dim', 'Add your free Warcraft Logs API client in Settings to see how much damage (or healing) this spec does in each dungeon, and how your own logged runs compare.'),
    el('button.wow-btn', { onclick: openSettings }, 'Open Settings')
  );
}

/**
 * Damage tab. ctx: { meta, tp: { params, data, loading, error }, character, hasWcl,
 * onLoad(paramsPatch, { force }), onCancel(), openSettings() }.
 * Returns { setProgress(p) } while loading.
 */
export function renderThroughput(container, ctx) {
  clear(container);
  const { tp, meta } = ctx;
  if (!ctx.hasWcl) {
    container.append(el('div.tp-wrap', setupPanel(ctx.openSettings)));
    return {};
  }
  const params = tp?.params || {};
  const data = tp?.data;
  const metric = data?.metric || params.metric || 'dps';
  const unit = metric === 'hps' ? 'HPS' : 'DPS';

  // ---------------------------------------------------------------- toolbar
  const seg = (options, value, onPick, titles = {}) =>
    el(
      'div.segmented',
      options.map(([v, label]) => {
        const b = el('button.seg', { onclick: () => v !== value && onPick(v), title: titles[v] || '' }, label);
        if (v === value) b.classList.add('active');
        return b;
      })
    );
  const levelSelect = (value, onPick) => {
    const s = el('select.wow-select', {}, LEVELS.map((l) => el('option', { value: String(l) }, `+${l}`)));
    s.value = String(value);
    s.addEventListener('change', () => onPick(Number(s.value)));
    return s;
  };
  const from = data?.from ?? params.from ?? 14;
  const to = data?.to ?? params.to ?? 21;
  const groupBy = data?.groupBy || params.groupBy || 'level';
  const toolbar = el(
    'div.tp-toolbar',
    seg([['dps', 'Damage (DPS)'], ['hps', 'Healing (HPS)']], metric, (v) => ctx.onLoad({ metric: v })),
    el(
      'div.fb-group',
      { title: 'Each key level is one lookup per dungeon. Warcraft Logs limits lookups per hour, so wide ranges can hit the limit; loaded levels are kept for 30 minutes while the app is open.' },
      el('span.fb-label', 'Key levels'),
      levelSelect(from, (v) => ctx.onLoad({ from: v, to: Math.max(v, to) })),
      el('span.faint', 'to'),
      levelSelect(to, (v) => ctx.onLoad({ to: v, from: Math.min(v, from) }))
    ),
    el(
      'div.fb-group',
      el('span.fb-label', 'Columns'),
      seg([['level', 'Key level'], ['ilvl', 'Item level']], groupBy, (v) => ctx.onLoad({ groupBy: v }), {
        ilvl: 'Needs each run’s gear: about 3 MB per key level and dungeon, and a large share of the hourly Warcraft Logs limit for your key. Kept for 30 minutes while the app is open.',
      })
    ),
    el('div.spacer'),
    data?.rate ? el('span.faint.small', `API points ${Math.round(data.rate.pointsSpentThisHour)} / ${data.rate.limitPerHour} this hour`) : null,
    el('button.wow-btn.small', { onclick: () => ctx.onLoad({}, { force: true }), disabled: tp?.loading, title: 'Download fresh data from Warcraft Logs' }, 'Refresh')
  );

  const wrap = el('div.tp-wrap');
  container.append(toolbar, wrap);

  // ---------------------------------------------------------------- loading / errors
  if (tp?.loading) {
    const bar = castbar('.small');
    bar.set(0, 'Contacting Warcraft Logs…');
    wrap.append(el('div.tp-loading.inset', el('div.wow-header', `Loading ${meta.specName} ${meta.className} logs`), bar.bar, el('button.wow-btn.small', { onclick: ctx.onCancel }, 'Cancel')));
    return {
      setProgress(p) {
        bar.set(p.overall || 0, `${p.phase}${p.total ? ` · ${p.done}/${p.total}` : ''}${p.label ? ` · ${p.label}` : ''}`);
      },
    };
  }
  if (tp?.error && !data) {
    wrap.append(el('div.tp-setup.inset', el('div.error-box', tp.error), el('button.wow-btn.small', { onclick: () => ctx.onLoad({}) }, 'Try again')));
    return {};
  }
  if (!data) return {};
  if (tp?.error) wrap.append(el('div.banner.tp-warn', el('span.warn', tp.error)));
  if (data.missing?.length) {
    const minutes = data.resetIn ? Math.max(1, Math.ceil(data.resetIn / 60)) : null;
    wrap.append(
      el(
        'div.banner.tp-warn',
        el(
          'span.warn',
          `Warcraft Logs' hourly limit was reached before ${data.missing.join(', ')} loaded${minutes ? ` — try again in about ${minutes} min` : ''}. The other dungeons are complete.`
        )
      )
    );
  }

  // ---------------------------------------------------------------- table
  const { table, you } = data;
  // Thin cells (few runs) are not reliable enough to set the colour scale.
  const medians = table.rows.flatMap((r) => table.columns.map((c) => r.cells[c.key]).filter((x) => x && x.n >= FEW).map((x) => x.median));
  const lo = Math.min(...medians);
  const hi = Math.max(...medians);
  const heat = (m) => (hi > lo ? Math.max(0, Math.min(1, (m - lo) / (hi - lo))) : 0.5);
  const yours = you?.found ? you.dungeons : null;

  const cell = (rowName, col, s, mine) => {
    if (!s) return el('td.tp-cell.empty', '–');
    const td = el(
      `td.tp-cell${s.n < FEW ? '.few' : ''}`,
      { style: { background: s.n < FEW ? 'rgba(255, 255, 255, 0.03)' : `rgba(255, 209, 0, ${(0.05 + 0.25 * heat(s.median)).toFixed(3)})` } },
      el('div.tp-median', fmtAmount(s.median)),
      el('div.tp-n', `${s.n} run${s.n === 1 ? '' : 's'}`)
    );
    attachTooltip(td, () => cellTooltip(rowName, col.label, s, unit, groupBy));
    if (mine) {
      const yourLine = el(`div.tp-you.${deltaClass(mine.delta)}`, `You ${fmtAmount(mine.amount)}`, mine.delta != null ? ` ${fmtPct(mine.delta)}` : '');
      attachTooltip(yourLine, () => yourTooltip(mine, unit));
      td.append(yourLine);
    }
    return td;
  };

  const head = el(
    'tr',
    el('th', 'Dungeon'),
    table.columns.map((c) => el('th.num', c.label)),
    el('th.num', groupBy === 'ilvl' ? 'All item levels' : 'All levels')
  );
  const body = table.rows.map((r) => {
    const best = yours?.[r.id]?.best;
    return el(
      'tr',
      el(
        'td.tp-name',
        el('div', r.name),
        best
          ? el(
              `div.tp-you-line.${deltaClass(best.delta)}`,
              `You: +${best.level} ${fmtAmount(best.amount)}`,
              best.delta != null ? ` (${fmtPct(best.delta)})` : ' (too few runs to compare)'
            )
          : null
      ),
      table.columns.map((c) => cell(r.name, c, r.cells[c.key], groupBy === 'level' ? yours?.[r.id]?.byLevel?.[c.key] : null)),
      cell(r.name, { label: groupBy === 'ilvl' ? 'all item levels' : `+${data.from} to +${data.to}` }, r.all, null)
    );
  });
  const foot = el(
    'tr.tp-total',
    el('td.tp-name', 'All dungeons'),
    table.columns.map((c) => cell('All dungeons', c, table.total.cells[c.key], null)),
    cell('All dungeons', { label: 'everything shown' }, table.total.all, null)
  );
  wrap.append(
    el(
      'div.tp-summary.faint',
      `Median ${unit} of ${meta.specName} ${meta.className} in logged keys · ${data.zone.name} on Warcraft Logs · hover a cell for the spread`
    ),
    el('div.inset.tp-table-wrap', el('table.wow-table.tp-table', el('thead', head), el('tbody', body, foot)))
  );

  // ---------------------------------------------------------------- your runs
  wrap.append(yourRunsPanel(ctx, data, table, unit));
  wrap.append(
    el(
      'div.faint.small.tp-foot',
      'Per dungeon and key level, Warcraft Logs ranks up to 100 of the best-timed logged runs of the spec; their median is shown. ',
      'Numbers are damage (or healing) per second over the whole key, like Details’ "overall" segment. ',
      'Runs shorter than 10 minutes (partial logs) are left out. Players who log tend to be above average, so treat this as "typical for players who log".'
    )
  );
  return {};
}

function yourRunsPanel(ctx, data, table, unit) {
  const { you } = data;
  const panel = el('div.tp-yours.inset');
  if (!ctx.character) {
    panel.append(el('div.faint', 'Use “Compare with my character” (top right) to see your own logged runs next to these numbers.'));
    return panel;
  }
  const name = ctx.character.name;
  if (!you || you.error) {
    panel.append(el('div.wow-header', 'Your logged runs'), el('div.error-box', you?.error || 'Could not load your logs.'));
    return panel;
  }
  if (!you.found) {
    panel.append(
      el('div.wow-header', 'Your logged runs'),
      el('div.dim', `Warcraft Logs has no ${ctx.meta.specName} logs for ${name}. Upload your keys with the Warcraft Logs uploader (or the Archon app) to compare.`)
    );
    return panel;
  }
  const rows = table.rows.flatMap((r) => (you.dungeons[r.id]?.runs || []).map((run) => ({ dungeon: r.name, run })));
  panel.append(el('div.wow-header', `Your logged runs — ${name} (${rows.length} in +${data.from} to +${data.to})`));
  if (!rows.length) {
    panel.append(el('div.dim', `No logged ${ctx.meta.specName} runs between +${data.from} and +${data.to}. Widen the key level range above.`));
    return panel;
  }
  panel.append(
    el(
      'table.wow-table.tp-runs',
      el(
        'thead',
        el('tr', ['Dungeon', 'Key', `Your ${unit}`, 'Spec median', 'Difference', 'Better than', 'Run time', 'Played', ''].map((h, i) => el(i >= 2 && i <= 6 ? 'th.num' : 'th', h)))
      ),
      el(
        'tbody',
        rows.map(({ dungeon, run }) =>
          el(
            'tr',
            el('td', dungeon),
            el('td', `+${run.level}`),
            el('td.num.tp-amount', fmtAmount(run.amount)),
            el('td.num', run.median != null ? fmtAmount(run.median) : el('span.faint', { title: `Only ${run.n} other logged run${run.n === 1 ? '' : 's'} at +${run.level}` }, `too few (${run.n})`)),
            el(`td.num.${deltaClass(run.delta)}`, run.delta != null ? fmtPct(run.delta) : '–'),
            el('td.num', run.percentile != null ? pct(run.percentile) : '–'),
            el('td.num.faint', fmtDuration(run.duration)),
            el('td.faint', run.start ? relDate(new Date(run.start).toISOString()) : ''),
            el('td', logUrl(run) ? el('button.link-btn', { onclick: () => window.api.openExternal(logUrl(run)) }, 'View log') : null)
          )
        )
      )
    )
  );
  return panel;
}

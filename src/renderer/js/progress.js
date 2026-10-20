import { el, iconImg, clear } from './util.js';

export function castbar(cls = '') {
  const fill = el('div.fill');
  const spark = el('div.spark');
  const text = el('div.text');
  const bar = el(`div.castbar${cls}`, el('div.track', fill, spark), text);
  return {
    bar,
    set(frac, label) {
      const p = Math.max(0, Math.min(1, frac));
      fill.style.width = `${p * 100}%`;
      spark.style.left = `${p * 100}%`;
      spark.hidden = p <= 0 || p >= 1;
      text.textContent = label;
      bar.classList.toggle('done', p >= 1);
    },
  };
}

/**
 * Progress screen with a casting-bar style overall bar, a per-step bar,
 * a checklist of phases and a short live log.
 * Returns { update(progressEvent), showError(msg, onBack) }.
 */
export function renderProgress(container, opts, onCancel) {
  clear(container);
  const overall = castbar();
  const stepBar = castbar('.small');
  const steps = el('div.steps');
  const log = el('div.log.inset');
  const cancelBtn = el('button.wow-btn', { onclick: onCancel }, 'Cancel');
  const regionName = opts.region === 'world' ? 'World' : opts.region.toUpperCase();

  const panel = el(
    'div.progress-panel.inset',
    el(
      'div.spec-line',
      iconImg(opts.specIcon, { cls: 'icon' }),
      el(
        'div',
        el('h2.wow-header', 'Inspecting players…'),
        el('div.dim', el('span', { style: { color: opts.color } }, `${opts.specName} ${opts.className}`), ` · Top ${opts.sampleSize} · ${regionName}`)
      )
    ),
    overall.bar,
    stepBar.bar,
    steps,
    log,
    cancelBtn
  );
  container.append(el('div.progress-view', panel));
  overall.set(0, 'Starting…');
  stepBar.set(0, '');

  let phaseNames = null;
  const stepEls = [];
  const logLines = [];

  function ensureSteps(names) {
    if (phaseNames) return;
    phaseNames = names;
    for (const name of names) {
      const mark = el('span.mark');
      const count = el('span.count');
      const row = el('div.step', mark, el('span', name), count);
      stepEls.push({ row, mark, count });
      steps.append(row);
    }
  }

  return {
    update(p) {
      ensureSteps(p.phases);
      overall.set(p.overall, `${p.phase}  —  ${Math.round(p.overall * 100)}%`);
      const frac = p.total ? p.done / p.total : 0;
      stepBar.set(frac, p.total > 1 ? `${p.done} / ${p.total}${p.label ? `  ·  ${p.label}` : ''}` : p.label || '');
      stepEls.forEach((s, i) => {
        s.row.classList.toggle('done', i < p.phaseIndex);
        s.row.classList.toggle('active', i === p.phaseIndex);
        s.mark.textContent = i < p.phaseIndex ? '✓' : i === p.phaseIndex ? '…' : '';
        if (i === p.phaseIndex && p.total > 1) s.count.textContent = `${p.done}/${p.total}`;
      });
      if (p.log) {
        const cls = p.log.startsWith('✓') ? 'ok' : p.log.startsWith('↺') ? 'fb' : p.log.startsWith('✗') ? 'skip' : '';
        logLines.push(el(`div${cls ? '.' + cls : ''}`, p.log));
        if (logLines.length > 9) logLines.shift();
        log.replaceChildren(...logLines);
      }
    },
    showError(message, onBack) {
      overall.set(0, 'Failed');
      cancelBtn.replaceWith(el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' } },
        el('div.error-box', message),
        el('button.wow-btn', { onclick: onBack }, 'Back')));
    },
  };
}

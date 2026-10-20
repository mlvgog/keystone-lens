'use strict';

const stats = require('./stats');

const USER_AGENT = 'MPlusTalentGearInspector/1.0 (desktop app)';

function abortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  return err;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Simple promise concurrency limiter. */
class Limiter {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.active = 0;
    this.queue = [];
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._next();
    });
  }

  _next() {
    if (this.active >= this.concurrency || this.queue.length === 0) return;
    const { fn, resolve, reject } = this.queue.shift();
    this.active++;
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        this.active--;
        this._next();
      });
  }
}

// One limiter per host keeps us polite towards each API. raider.io response times vary a lot
// (0.1s to 40s+ for uncached run snapshots), so it gets more parallel slots.
const HOST_CONCURRENCY = { 'raider.io': 8 };
const REQUEST_TIMEOUT_MS = 60000;
const limiters = new Map();
function limiterFor(url) {
  const host = new URL(url).host;
  if (!limiters.has(host)) limiters.set(host, new Limiter(HOST_CONCURRENCY[host] || 4));
  return limiters.get(host);
}

function backoffMs(attempt) {
  return Math.min(30000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400);
}

/**
 * GET a URL and parse the body (JSON by default). Retries on network errors, HTTP 429
 * and 5xx with exponential backoff (honouring Retry-After). Throws on other HTTP errors.
 */
async function request(url, { signal, retries = 5, as = 'json' } = {}) {
  return limiterFor(url).run(async () => {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError();
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const started = performance.now();
      let res;
      let body;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: as === 'json' ? 'application/json' : '*/*' },
          signal: combined,
        });
        if (res.ok) {
          const text = await res.text();
          body = as === 'json' ? JSON.parse(text) : text;
          stats.recordRequest({ url, status: res.status, bytes: Buffer.byteLength(text), ms: performance.now() - started, retry: attempt > 0 });
        }
      } catch (err) {
        if (signal?.aborted) throw abortError();
        stats.recordRequest({ url, status: res?.status ?? null, ms: performance.now() - started, retry: attempt > 0, error: err.message });
        // Timeouts, network errors and truncated bodies are retried.
        if (attempt >= retries) throw new Error(`Network error for ${url}: ${err.message}`);
        await sleep(backoffMs(attempt), signal);
        continue;
      }
      if (res.ok) return body;
      stats.recordRequest({ url, status: res.status, ms: performance.now() - started, retry: attempt > 0, error: `HTTP ${res.status}` });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt), signal);
        continue;
      }
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      throw err;
    }
  });
}

const fetchJson = (url, opts = {}) => request(url, { ...opts, as: 'json' });
const fetchText = (url, opts = {}) => request(url, { ...opts, as: 'text' });

module.exports = { fetchJson, fetchText, sleep, abortError, Limiter };

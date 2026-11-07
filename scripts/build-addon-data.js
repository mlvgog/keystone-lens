'use strict';

// Builds the weekly data that ships with the game addon on CurseForge: the `KeystoneLens_DB`
// folder, with the same per-spec records the app writes (src/main/addonExport.js), for every
// Mythic+ spec, world-wide, top 50 players, with every dungeon. Run by .github/workflows/addon.yml.
// Raider.IO agreed to this use of their API (weekly, aggregated stats, credited, no player names).
//
//   node scripts/build-addon-data.js [--out <dir>] [--cache <dir>] [--specs 261,262] [--max-missing 3]
//
// Players' key snapshots never change and stay in the cache folder, so a weekly run with the
// previous week's cache mostly fetches new keys. The run fails when more specs fail than
// --max-missing, so a broken week is never published.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOC = path.join(ROOT, 'addon', 'KeystoneLens', 'KeystoneLens.toc');

const REGION = 'world';
const SAMPLE_SIZE = 50;
const MIN_PLAYERS = 10;

function defaultDeps() {
  const talentTrees = require('../src/main/sources/talentTrees');
  const { buildClassList } = require('../src/main/specs');
  const { analyze, loadDungeon } = require('../src/main/collector');
  const races = require('../src/main/races');
  const { specRecord } = require('../src/main/addonExport');
  return {
    classList: async () => buildClassList(await talentTrees.getTalentData()),
    analyze,
    loadDungeon,
    specRecord: (session) => specRecord(session, { racials: (classId) => races.racialsByRace(classId) }),
  };
}

/** analyze() options of every spec, or of the given spec IDs. */
function specList(classes, only = null) {
  const out = [];
  for (const c of classes) {
    for (const s of c.specs) {
      if (only && !only.includes(s.specId)) continue;
      out.push({
        classSlug: c.classSlug,
        className: c.className,
        color: c.color,
        specSlug: s.specSlug,
        specName: s.specName,
        specId: s.specId,
        specIcon: s.icon,
        region: REGION,
        sampleSize: SAMPLE_SIZE,
        since: null,
      });
    }
  }
  return out;
}

/**
 * Build the records and write `<out>/KeystoneLens_DB/{KeystoneLens_DB.toc,Data.lua}`.
 * Returns { dir, records, failed, bytes }.
 */
async function buildAddonData({ out, only = null, maxMissing = 3, minPlayers = MIN_PLAYERS, deps = defaultDeps(), log = console.log, now = Date.now() } = {}) {
  const { dataFileText, bundleTocText, readTocField, BUNDLE_ADDON } = require('../src/main/addonExport');
  const specs = specList(await deps.classList(), only);
  if (!specs.length) throw new Error(only ? `No spec matches ${only.join(', ')}` : 'No specs found in the talent data');

  const records = {};
  const failed = [];
  for (const [i, opts] of specs.entries()) {
    const label = `${opts.specName} ${opts.className}`;
    const started = Date.now();
    try {
      const { session } = await deps.analyze(opts, {});
      for (const d of session.meta.dungeons || []) await deps.loadDungeon(session, d.id, {});
      const rec = await deps.specRecord(session);
      if ((rec.sample || 0) < minPlayers) throw new Error(`only ${rec.sample || 0} players`);
      records[rec.specId] = rec;
      log(`[${i + 1}/${specs.length}] ${label}: ${rec.sample} players, ${Object.keys(rec.dungeons || {}).length} dungeons (${Math.round((Date.now() - started) / 1000)}s)`);
    } catch (err) {
      failed.push({ specId: opts.specId, label, error: err.message });
      log(`[${i + 1}/${specs.length}] ${label}: FAILED: ${err.message}`);
    }
  }
  if (failed.length > maxMissing) {
    throw new Error(`${failed.length} specs failed (at most ${maxMissing} may): ${failed.map((f) => f.label).join(', ')}`);
  }

  const interfaceVersion = readTocField(fs.readFileSync(TOC, 'utf8'), 'Interface');
  const date = new Date(now);
  const version = `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${String(date.getUTCDate()).padStart(2, '0')}`;
  const dir = path.join(out, BUNDLE_ADDON);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const { version: appVersion } = require('../package.json');
  const data = dataFileText(records, { appVersion, now, bundle: true });
  fs.writeFileSync(path.join(dir, 'Data.lua'), data);
  fs.writeFileSync(path.join(dir, `${BUNDLE_ADDON}.toc`), bundleTocText({ interfaceVersion, version }));
  return { dir, records, failed, bytes: Buffer.byteLength(data) };
}

function parseArgs(argv) {
  const args = { out: path.join(ROOT, 'build', 'addon'), cache: path.join(ROOT, '.addon-data-cache'), only: null, maxMissing: 3 };
  for (let i = 0; i < argv.length; i++) {
    const [key, value] = [argv[i], argv[i + 1]];
    if (key === '--out') args.out = path.resolve(value);
    else if (key === '--cache') args.cache = path.resolve(value);
    else if (key === '--specs') args.only = value ? value.split(',').map(Number).filter(Boolean) : null;
    else if (key === '--max-missing') args.maxMissing = Number(value);
    else throw new Error(`Unknown option ${key}`);
    i++;
  }
  return args;
}

/** Requests and bytes per host, from the stats the app's http layer records. */
function requestSummary(stats) {
  const s = stats.snapshot().session || {};
  return Object.entries(s.sources || s)
    .filter(([, v]) => v && typeof v === 'object' && 'requests' in v)
    .map(([host, v]) => `${host}: ${v.requests} requests, ${v.errors} errors, ${Math.round((v.bytes || 0) / 1e6)} MB`)
    .join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cache = require('../src/main/cache');
  const stats = require('../src/main/stats');
  const http = require('../src/main/http');
  // Gentler than the app: one job, few parallel requests, and it says what it is.
  http.configure({ context: 'addon data build', concurrency: { 'raider.io': 3 } });
  fs.mkdirSync(args.cache, { recursive: true });
  cache.init(args.cache);
  const started = Date.now();
  const res = await buildAddonData({ out: args.out, only: args.only, maxMissing: args.maxMissing });
  console.log(`\nWrote ${path.relative(process.cwd(), res.dir)}: ${Object.keys(res.records).length} specs, ${(res.bytes / 1e6).toFixed(2)} MB, ${Math.round((Date.now() - started) / 60000)} min`);
  if (res.failed.length) console.log(`Missing: ${res.failed.map((f) => f.label).join(', ')}`);
  console.log(`\nRequests:\n${requestSummary(stats)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { buildAddonData, specList, parseArgs, REGION, SAMPLE_SIZE };

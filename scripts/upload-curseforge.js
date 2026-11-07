'use strict';

// Uploads the addon zip (built by .github/workflows/addon.yml) to CurseForge, the way the
// BigWigs packager does: the game version comes from "## Interface" in the addon's .toc, and
// the changelog is addon/KeystoneLens/CHANGELOG.md with a line about the week's data on top.
//
//   CF_API_TOKEN=... node scripts/upload-curseforge.js --zip <file> --label <name>
//
// The project is "## X-Curse-Project-ID" in the .toc (CF_PROJECT_ID overrides it).
//
// API: GET /api/game/wow/versions and POST /api/projects/<id>/upload-file on wow.curseforge.com,
// with the token in the x-api-token header.

const fs = require('fs');
const path = require('path');

const SITE = 'https://wow.curseforge.com';
const RETAIL = 517; // CurseForge's game version type for retail World of Warcraft
const ROOT = path.join(__dirname, '..');

/** "120105" -> "12.1.5" (the game's Interface number to its version). */
function interfaceToVersion(value) {
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n < 10000) throw new Error(`Not an Interface number: ${value}`);
  return `${Math.floor(n / 10000)}.${Math.floor(n / 100) % 100}.${n % 100}`;
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * CurseForge game version IDs for the .toc's Interface values ("120105, 120200"). A version
 * CurseForge doesn't list yet (a new patch) falls back to its newest retail version below it,
 * else its newest retail version, as the packager does.
 */
function gameVersionIds(versions, interfaceField) {
  const retail = versions.filter((v) => v.gameVersionTypeID === RETAIL && /^\d+(\.\d+)*$/.test(v.name));
  if (!retail.length) throw new Error('CurseForge listed no retail game versions');
  const ids = [];
  for (const iface of String(interfaceField).split(',').map((s) => s.trim()).filter(Boolean)) {
    const wanted = interfaceToVersion(iface);
    const exact = retail.find((v) => v.name === wanted);
    const below = retail.filter((v) => compareVersions(v.name, wanted) < 0).sort((a, b) => compareVersions(b.name, a.name))[0];
    const newest = [...retail].sort((a, b) => compareVersions(b.name, a.name))[0];
    const pick = exact || below || newest;
    if (!exact) console.warn(`CurseForge has no game version ${wanted}; using ${pick.name}`);
    if (!ids.includes(pick.id)) ids.push(pick.id);
  }
  return ids;
}

/** A `## Field: value` line of a .toc, or null. */
function tocField(toc, field) {
  return new RegExp(`^##\\s*${field}\\s*:\\s*(.+?)\\s*$`, 'mi').exec(String(toc || ''))?.[1] || null;
}

function metadata({ label, gameVersions, changelog, dataDate }) {
  const head = dataDate ? `**Data of ${dataDate}:** the top 50 Mythic+ players of every spec, world-wide, from Raider.IO.\n\n` : '';
  return { displayName: label, gameVersions, releaseType: 'release', changelog: head + changelog, changelogType: 'markdown' };
}

async function upload({ zip, label, dataDate, token, projectId, toc, changelog, fetchImpl = fetch }) {
  projectId = projectId || tocField(toc, 'X-Curse-Project-ID');
  if (!token || !projectId) throw new Error('CF_API_TOKEN and a project ID (## X-Curse-Project-ID) are needed to upload');
  const headers = { 'x-api-token': token };
  const res = await fetchImpl(`${SITE}/api/game/wow/versions`, { headers });
  if (!res.ok) throw new Error(`CurseForge game versions: HTTP ${res.status}`);
  const interfaceField = tocField(toc, 'Interface');
  if (!interfaceField) throw new Error('No ## Interface in the .toc');
  const meta = metadata({ label, gameVersions: gameVersionIds(await res.json(), interfaceField), changelog, dataDate });

  const form = new FormData();
  form.append('metadata', JSON.stringify(meta));
  form.append('file', new Blob([fs.readFileSync(zip)], { type: 'application/zip' }), path.basename(zip));
  const up = await fetchImpl(`${SITE}/api/projects/${encodeURIComponent(projectId)}/upload-file`, { method: 'POST', headers, body: form });
  const text = await up.text();
  if (!up.ok) throw new Error(`CurseForge upload: HTTP ${up.status} ${text.slice(0, 300)}`);
  return { meta, response: text };
}

async function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--zip', '--label', '--data-date'].includes(argv[i])) throw new Error(`Unknown option ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.zip || !args.label) throw new Error('Usage: upload-curseforge.js --zip <file> --label <name> [--data-date YYYY-MM-DD]');
  const addonDir = path.join(ROOT, 'addon', 'KeystoneLens');
  const { meta, response } = await upload({
    zip: args.zip,
    label: args.label,
    dataDate: args['data-date'],
    token: process.env.CF_API_TOKEN,
    projectId: process.env.CF_PROJECT_ID,
    toc: fs.readFileSync(path.join(addonDir, 'KeystoneLens.toc'), 'utf8'),
    changelog: fs.readFileSync(path.join(addonDir, 'CHANGELOG.md'), 'utf8'),
  });
  console.log(`Uploaded ${meta.displayName} (game versions ${meta.gameVersions.join(', ')}): ${response}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { interfaceToVersion, gameVersionIds, metadata, upload, tocField, RETAIL };

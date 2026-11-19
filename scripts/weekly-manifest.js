'use strict';

// The manifest of the weekly addon data the Addon workflow publishes for the app
// (src/main/weeklyData.js reads it): the data's version, the addon version it goes with, and the
// checksum and size of each file.
//
//   DATA_VERSION=2026.11.18 VERSION=1.2.1 node scripts/weekly-manifest.js build/package/KeystoneLens_DB

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FILES } = require('../src/main/weeklyData');

function weeklyManifest(dir, { version, addon }) {
  const files = {};
  for (const name of FILES) {
    const bytes = fs.readFileSync(path.join(dir, name));
    files[name] = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
  return { version, addon, files };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir || !process.env.DATA_VERSION || !process.env.VERSION) {
    console.error('Usage: DATA_VERSION=YYYY.MM.DD VERSION=<addon version> node scripts/weekly-manifest.js <KeystoneLens_DB folder>');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(weeklyManifest(dir, { version: process.env.DATA_VERSION, addon: process.env.VERSION }), null, 2)}\n`);
}

module.exports = { weeklyManifest };

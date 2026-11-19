'use strict';

// Checks the week's data the way the game addon uses it, before the Addon workflow uploads it:
// loads KeystoneLens_DB/Data.lua and the addon in a Lua 5.1 VM with the stand-in WoW API the
// tests use (test/helpers/wow_stub.lua), reads every spec and dungeon through the addon's own
// functions, and opens the /kl window. Any Lua error or empty spec fails the check.
//
//   node scripts/check-addon-data.js build/addon/KeystoneLens_DB/Data.lua [--min-specs 20]

const fs = require('fs');
const addon = require('../test/helpers/addon');

// Per spec: specID|source|players|builds|talents|dungeons|dungeons with builds
const SUMMARY = `(function()
  local out = {}
  for _, s in ipairs(__ns:AvailableSpecs()) do
    local rec, source = __ns:GetSpecData(s.specID)
    local all = __ns.View(rec, nil)
    local talents = 0
    for _ in pairs(all.talents or {}) do talents = talents + 1 end
    local withBuilds = 0
    local dungeons = __ns.LoadedDungeons(rec)
    for _, d in ipairs(dungeons) do
      if #(__ns.View(rec, d.id).builds or {}) > 0 then withBuilds = withBuilds + 1 end
    end
    out[#out + 1] = table.concat({ s.specID, source, rec.sample or 0, #(all.builds or {}), talents, #dungeons, withBuilds }, "|")
  end
  return table.concat(out, ";")
end)()`;

/** { specs: [{ specId, source, players, builds, talents, dungeons, dungeonsWithBuilds }], problems: [] } */
function checkAddonData(text, { minSpecs = 1 } = {}) {
  const problems = [];
  const L = addon.loadAddon({ before: [text] });
  if (addon.evaluate(L, '__ns:NeedsUpdate()')) problems.push('The data needs a newer addon (schema)');
  const summary = String(addon.evaluate(L, SUMMARY) || '');
  const specs = summary
    ? summary.split(';').map((row) => {
        const [specId, source, players, builds, talents, dungeons, dungeonsWithBuilds] = row.split('|');
        return { specId: +specId, source, players: +players, builds: +builds, talents: +talents, dungeons: +dungeons, dungeonsWithBuilds: +dungeonsWithBuilds };
      })
    : [];
  if (specs.length < minSpecs) problems.push(`Only ${specs.length} specs load in the addon (at least ${minSpecs} expected)`);
  for (const s of specs) {
    const what = [];
    if (s.source !== 'bundle') what.push(`source ${s.source}`);
    if (!s.players) what.push('no players');
    if (!s.builds) what.push('no builds');
    if (!s.talents) what.push('no talents');
    if (!s.dungeonsWithBuilds) what.push('no dungeon builds');
    if (what.length) problems.push(`Spec ${s.specId}: ${what.join(', ')}`);
  }
  // The window with the first spec, as a player of a spec without data would see it.
  addon.run(L, '__ns:TogglePanel(); __runTimers()');
  for (const err of addon.errors(L)) problems.push(`Lua error: ${err}`);
  return { specs, problems };
}

function main() {
  const [file, flag, value] = process.argv.slice(2);
  if (!file || (flag && flag !== '--min-specs')) throw new Error('Usage: check-addon-data.js <Data.lua> [--min-specs N]');
  const { specs, problems } = checkAddonData(fs.readFileSync(file, 'utf8'), { minSpecs: flag ? Number(value) : 1 });
  console.log(`${specs.length} specs load in the addon: ${specs.map((s) => `${s.specId} (${s.players})`).join(', ')}`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('The addon reads every spec and dungeon without errors.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { checkAddonData };

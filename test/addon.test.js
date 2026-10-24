'use strict';

/**
 * The game addon (addon/KeystoneLens) run against a stand-in WoW API: it reads the data file
 * the app writes, and the character it saves can be imported by the app.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const addon = require('./helpers/addon');
const { session } = require('./helpers/session');
const { specRecord, dataFileText } = require('../src/main/addonExport');
const { toLua } = require('../src/main/lua');
const { parseSimc } = require('../src/main/simc');
const wow = require('../src/main/wow');

async function appData(patch = {}) {
  const rec = { ...(await specRecord(session())), ...patch };
  return dataFileText({ [rec.specId]: rec }, { appVersion: '1.2.0' });
}

// Your talents matching the popular build of the synthetic session (buildA + hero tree 40).
const MY_NODES = `
__player.hero = 40
__player.nodes = {
  [1] = { ID = 1, type = 0, maxRanks = 1, ranksPurchased = 1, activeRank = 1, entryIDs = { 10 }, isVisible = true },
  [2] = { ID = 2, type = 2, maxRanks = 1, ranksPurchased = 1, activeRank = 1, entryIDs = { 21, 22 }, activeEntry = { entryID = 21 }, isVisible = true },
  [3] = { ID = 3, type = 0, maxRanks = 2, ranksPurchased = 2, activeRank = 2, entryIDs = { 30 }, isVisible = true },
  [4] = { ID = 4, type = 0, maxRanks = 1, ranksPurchased = 1, activeRank = 1, entryIDs = { 40 }, subTreeID = 40, subTreeActive = true, isVisible = true },
  [5] = { ID = 5, type = 0, maxRanks = 1, ranksPurchased = 1, activeRank = 1, entryIDs = { 50 }, subTreeID = 41, subTreeActive = false, isVisible = true },
  [6] = { ID = 6, type = 0, maxRanks = 1, ranksPurchased = 0, activeRank = 0, entryIDs = { 60 }, isVisible = true },
  [9] = { ID = 9, type = 3, maxRanks = 1, ranksPurchased = 1, activeRank = 1, entryIDs = { 90, 91 }, isVisible = true },
}`;

test('every addon file loads and sets up its saved settings', () => {
  const L = addon.loadAddon();
  assert.equal(addon.evaluate(L, 'KeystoneLensDB.schema'), 1);
  assert.equal(addon.evaluate(L, 'KeystoneLensDB.settings.overlay'), true);
  assert.equal(addon.evaluate(L, 'KeystoneLensDB.settings.popular'), 0.75);
  assert.equal(addon.evaluate(L, 'type(SlashCmdList.KEYSTONELENS)'), 'function');
  assert.equal(addon.evaluate(L, 'type(KeystoneLens_OnAddonCompartmentClick)'), 'function');
  assert.equal(addon.evaluate(L, '__ns.version'), '1.0.0');
});

test("the addon reads the app's data file", async () => {
  const L = addon.loadAddon({ before: [await appData()] });
  assert.equal(addon.evaluate(L, '__ns:GetSpecData(64).spec'), 'Frost');
  assert.equal(addon.evaluate(L, 'select(2, __ns:GetSpecData(64))'), 'app');
  assert.equal(addon.evaluate(L, '#__ns:AvailableSpecs()'), 1);
  assert.equal(addon.evaluate(L, '__ns.View(__ns:GetSpecData(64), nil).sample'), 6);
  assert.equal(addon.evaluate(L, '__ns.View(__ns:GetSpecData(64), 9).sample'), 3);
  assert.equal(addon.evaluate(L, '__ns.View(__ns:GetSpecData(64), 10).sample'), 6, 'a dungeon without data falls back to all keys');
  assert.equal(addon.evaluate(L, '#__ns.LoadedDungeons(__ns:GetSpecData(64))'), 1);

  // The dungeon of your keystone is picked when the data has it.
  addon.run(L, '__player.keystoneMap = 501');
  assert.equal(addon.evaluate(L, '__ns:CurrentDungeon(__ns:GetSpecData(64))'), 9);
  addon.run(L, '__player.keystoneMap = 999');
  assert.equal(addon.evaluate(L, '__ns:CurrentDungeon(__ns:GetSpecData(64))'), null);
  assert.deepEqual(addon.errors(L), []);
});

test('the newest data wins, and data for a newer addon is not misread', async () => {
  const bundled = `KeystoneLensBundledData = { schema = 1, specs = { [64] = { spec = "Bundled", time = 1 }, [63] = { spec = "Fire", class = "Mage", time = 5 } } }`;
  const L = addon.loadAddon({ before: [await appData(), bundled] });
  assert.equal(addon.evaluate(L, '__ns:GetSpecData(64).spec'), 'Frost');
  assert.equal(addon.evaluate(L, 'select(2, __ns:GetSpecData(63))'), 'bundle');
  assert.equal(addon.evaluate(L, '#__ns:AvailableSpecs()'), 2);

  const future = addon.loadAddon({ before: ['KeystoneLensAppData = { schema = 99, specs = { [64] = { spec = "?" } } }'] });
  assert.equal(addon.evaluate(future, '__ns:GetSpecData(64)'), null);
  assert.equal(addon.evaluate(future, '__ns:NeedsUpdate()'), true);
});

test('your talents are compared with the popular builds', async () => {
  const L = addon.loadAddon({ before: [await appData()] });
  addon.run(L, MY_NODES);
  const mine = addon.evaluate(L, '__ns.GetMyPicks()');
  // Nodes 1-4 (a Lua table with keys 1..n comes back as an array): no inactive hero tree,
  // no hero tree selection node, no unpicked nodes.
  assert.deepEqual(mine.picks, [1, 1, 2, 1]);
  assert.deepEqual(mine.choices, { 2: 21 });
  assert.equal(mine.hero, 40);
  assert.deepEqual(addon.evaluate(L, '{ __ns.ClosestBuild(__ns:GetSpecData(64).builds, __ns.GetMyPicks()) }'), [1, 0]);

  // Build 2 differs in the choice, the rank of node 3, node 6 and the hero node.
  assert.equal(addon.evaluate(L, '__ns.BuildDistance(__ns.GetMyPicks(), __ns:GetSpecData(64).builds[2])'), 5);

  const verdict = (node) => addon.evaluate(L, `__ns.NodeVerdict(__ns:GetSpecData(64).talents[${node}], __ns.GetMyPicks(), ${node}, 0.75, 0.25)`);
  assert.equal(verdict(1), null, 'popular and picked');
  addon.run(L, '__player.nodes[1].ranksPurchased = 0');
  assert.equal(verdict(1), 'missing', 'everyone takes it, you skip it');
  addon.run(L, '__player.nodes[2].activeEntry = { entryID = 22 }');
  assert.equal(verdict(2), 'rare', 'the less common side of a choice');
  addon.run(L, '__player.nodes[6].ranksPurchased = 1');
  assert.equal(verdict(6), null, '33% is not rare at a 25% threshold');
});

test('item tooltips say how popular an item is', async () => {
  const L = addon.loadAddon({ before: [await appData()] });
  const tooltip = (id) => {
    addon.run(L, `GameTooltip.lines = {}; __tooltipPostCalls[0](GameTooltip, { id = ${id} })`);
    return addon.evaluate(L, 'GameTooltip.lines[1]');
  };
  assert.equal(tooltip(400), 'Keystone Lens: 100% of the top 6 Frost Mages · most used ring');
  assert.equal(tooltip(401), 'Keystone Lens: 67% of the top 6 Frost Mages · 2nd most used ring');
  assert.equal(tooltip(9001), 'Keystone Lens: the most used gem of the top 6 Frost Mages');
  assert.equal(tooltip(12345), null);
  addon.run(L, '__ns:SetSetting("tooltips", false)');
  assert.equal(tooltip(400), null, 'turned off');
  assert.deepEqual(addon.errors(L), []);
});

test('the saved character is a SimulationCraft export the app can import', async () => {
  const L = addon.loadAddon();
  addon.run(
    L,
    `__player.items[1] = "|cffa335ee|Hitem:212003:7340:213746:0:0:0:0:0:80:64:0:0:3:10390:6652:1540:2:29:36:30:49:1:28:2462|h[Crown of Frost ilvl=639]|h|r"
     __player.items[11] = "|cffa335ee|Hitem:400::::::::80:64::::0:0|h[Plain Ring ilvl=626]|h|r"
     __player.savedLoadouts = { 1001, 2002 }
     __player.importStrings[2002] = "SAVEDSTRING"
     __ns:SaveCharacter()`
  );
  const key = 'Fjäll-tarren-mill-eu';
  const saved = addon.evaluate(L, `KeystoneLensDB.characters["${key}"]`);
  assert.equal(saved.name, 'Fjäll');
  assert.equal(saved.realm, 'Tarren Mill');
  assert.equal(saved.region, 'eu');
  assert.equal(saved.specId, 64);
  assert.equal(saved.itemLevel, 289.4);

  const simc = parseSimc(saved.simc);
  assert.equal(simc.className, 'Mage');
  assert.equal(simc.name, 'Fjäll');
  assert.equal(simc.region, 'eu');
  assert.equal(simc.realmSlug, 'tarren-mill');
  assert.equal(simc.specName, 'Frost');
  assert.equal(simc.level, 90);
  assert.equal(simc.talents, 'ACTIVESTRING');
  assert.deepEqual(simc.loadouts, [
    { name: 'Loadout 1001', talents: 'ACTIVESTRING' },
    { name: 'Loadout 2002', talents: 'SAVEDSTRING' },
  ]);
  const head = simc.items.find((it) => it.slot === 'head');
  assert.deepEqual(
    { id: head.id, enchantId: head.enchantId, gemIds: head.gemIds, bonuses: head.bonuses, craftedStats: head.craftedStats, ilvl: head.ilvl, name: head.name },
    { id: 212003, enchantId: 7340, gemIds: [213746], bonuses: [10390, 6652, 1540], craftedStats: [36, 49], ilvl: 639, name: 'Crown of Frost ilvl=639' }
  );
  const ring = simc.items.find((it) => it.slot === 'finger1');
  assert.deepEqual({ id: ring.id, bonuses: ring.bonuses, enchantId: ring.enchantId, gemIds: ring.gemIds }, { id: 400, bonuses: [], enchantId: null, gemIds: [] });

  // The game writes KeystoneLensDB to SavedVariables; the app reads the character back.
  const retail = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-game-'));
  const svDir = path.join(retail, 'WTF', 'Account', 'ACCOUNT', 'SavedVariables');
  fs.mkdirSync(svDir, { recursive: true });
  fs.writeFileSync(path.join(svDir, 'KeystoneLens.lua'), `KeystoneLensDB = ${toLua(addon.get(L, 'KeystoneLensDB'), { indent: 1 })}\n`);
  const [c] = await wow.readAddonCharacters(retail);
  assert.equal(c.name, 'Fjäll');
  assert.equal(c.specId, 64);
  assert.equal(c.simc, saved.simc);
  assert.deepEqual(addon.errors(L), []);
});

test('no snapshot before the talent data is ready', () => {
  const L = addon.loadAddon();
  addon.run(L, '__player.importStrings[1001] = ""');
  assert.equal(addon.evaluate(L, '__ns:SaveCharacter()'), false);
});

const TALENT_FRAME = `
local function button(nodeID)
  local b = CreateFrame("Button")
  local info = __player.nodes[nodeID] or { ID = nodeID, type = 0, maxRanks = 1, entryIDs = {}, isVisible = true }
  function b:GetNodeID() return nodeID end
  function b:GetNodeInfo() return __player.nodes[nodeID] or info end
  function b:ShouldBeVisible() local i = self:GetNodeInfo(); return i.isVisible and not (i.subTreeID and not i.subTreeActive) end
  function b:SetTooltipInternal() end
  return b
end
PlayerSpellsFrame = CreateFrame("Frame")
local frame = CreateFrame("Frame", nil, PlayerSpellsFrame)
frame.shown = false
__buttons = { button(1), button(2), button(3), button(4), button(5), button(6), button(9) }
function frame:EnumerateAllTalentButtons() local i = 0; return function() i = i + 1; return __buttons[i] end end
function frame:GetConfigID() return 1001 end
function frame:IsInspecting() return false end
function frame:UpdateTreeInfo() end
PlayerSpellsFrame.TalentsFrame = frame
__loadedCallbacks["Blizzard_PlayerSpells"]()
frame:Show()
__runTimers()
function __overlay(i) local o = __buttons[i].children[1]; return o and o.shown and o.text.text or nil end
function __border(i) local o = __buttons[i].children[1]; return o and o.border end
`;

test('the talent window shows pick rates and frames the differences', async () => {
  const L = addon.loadAddon({ before: [await appData()] });
  addon.run(L, MY_NODES);
  addon.run(L, '__player.nodes[1].ranksPurchased = 0; __player.nodes[1].activeRank = 0');
  addon.run(L, TALENT_FRAME);
  assert.equal(addon.evaluate(L, '__overlay(1)'), '100%');
  assert.equal(addon.evaluate(L, '__overlay(2)'), '67/33', 'choice nodes in entry order');
  assert.equal(addon.evaluate(L, '__overlay(3)'), '100%');
  assert.equal(addon.evaluate(L, '__overlay(4)'), '100%', 'hero nodes count their hero tree');
  assert.equal(addon.evaluate(L, '__overlay(5)'), null, 'the inactive hero tree is hidden');
  assert.equal(addon.evaluate(L, '__overlay(6)'), '33%');
  assert.equal(addon.evaluate(L, '__overlay(7)'), null, 'the hero tree selection node gets nothing');
  assert.deepEqual(addon.evaluate(L, '__border(1)'), [1, 0.2, 0.1, 0.95], 'popular talent you skip: red');
  assert.equal(addon.evaluate(L, '__border(2)[4]'), 0, 'nothing to flag');

  // Hovering adds the details to the node's tooltip.
  addon.run(L, 'GameTooltip:SetOwner(__buttons[2]); __buttons[2]:SetTooltipInternal()');
  const lines = addon.evaluate(L, 'GameTooltip.lines');
  assert.ok(lines.includes('Keystone Lens · top 6 Frost Mages · all dungeons'));
  assert.ok(lines.includes('Entry 21 67%'));
  assert.ok(lines.includes('Entry 22 33%'));

  // The dungeon button switches to that dungeon's data; turning the overlay off hides it.
  addon.run(L, 'PlayerSpellsFrame.TalentsFrame.children[1].children[3].scripts.OnClick(nil, "LeftButton")');
  assert.equal(addon.evaluate(L, '__overlay(2)'), '33/67', 'in dungeon 9, two of three players take the right side');
  addon.run(L, '__ns:SetSetting("overlay", false); __runTimers()');
  assert.equal(addon.evaluate(L, '__overlay(1)'), null);
  assert.deepEqual(addon.errors(L), []);
});

test('the window lists builds and gear, or explains where data comes from', async () => {
  const L = addon.loadAddon({ before: [await appData({ stats: { crit: 0.3, haste: 0.4, mastery: 0.2, vers: 0.1 } })] });
  addon.run(L, MY_NODES);
  addon.run(L, '__ns:TogglePanel()');
  let texts = addon.evaluate(L, '__texts');
  assert.ok(texts.includes('Top 6 Frost Mages · World'));
  assert.ok(texts.some((t) => /Your build is Build 1\./.test(t)));
  assert.ok(texts.some((t) => /Build 1 · Alpha · 4 players \(67%\)/.test(t)));
  assert.ok(texts.some((t) => /Build 2 · Beta · 2 players \(33%\)/.test(t)));

  addon.run(L, '__texts = {}; KeystoneLensFrame.tabs.gear.scripts.OnClick()');
  texts = addon.evaluate(L, '__texts');
  assert.ok(texts.includes('Rings'));
  assert.ok(texts.some((t) => /^Their stats: Critical Strike/.test(t)));
  assert.ok(texts.some((t) => /^Yours: Critical Strike 30%/.test(t)));
  assert.ok(texts.some((t) => /Enchant: .*Radiant Crit 67%/.test(t)));

  addon.run(L, '__texts = {}; KeystoneLensFrame.tabs.about.scripts.OnClick()');
  texts = addon.evaluate(L, '__texts');
  assert.ok(texts.some((t) => /desktop app/.test(t)));
  assert.ok(texts.some((t) => /raider\.io/.test(t)), 'credits the data source');

  const empty = addon.loadAddon();
  addon.run(empty, '__ns:TogglePanel()');
  texts = addon.evaluate(empty, '__texts');
  assert.ok(texts.includes('No data yet'));
  assert.ok(texts.some((t) => /Keystone Lens desktop app/.test(t)));
  assert.deepEqual(addon.errors(L), []);
  assert.deepEqual(addon.errors(empty), []);
});

test('the addon is plain Lua 5.1, as WoW runs it', (t) => {
  // Code outside strings and comments must not use Lua 5.2+ syntax.
  for (const file of addon.tocFiles()) {
    const code = fs
      .readFileSync(path.join(addon.ADDON_DIR, file), 'utf8')
      .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '')
      .replace(/--[^\n]*/g, '')
      .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
    assert.doesNotMatch(code, /\bgoto\b|::\w+::|\/\/|<<|>>|[^~=<>]~[^=]|&|\|/, `${file} uses Lua 5.2+ syntax`);
  }
  // With a real Lua 5.1 compiler installed, compile every file with it too.
  let luac = null;
  for (const name of ['luac5.1', 'luac51']) {
    try {
      execFileSync(name, ['-v'], { stdio: 'ignore' });
      luac = name;
      break;
    } catch {
      // not installed
    }
  }
  if (!luac) return t.skip('no Lua 5.1 compiler installed');
  for (const file of addon.tocFiles()) execFileSync(luac, ['-p', path.join(addon.ADDON_DIR, file)]);
});

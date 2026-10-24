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
  addon.run(L, 'PlayerSpellsFrame.TalentsFrame.children[1].children[3].scripts.OnClick(nil, "LeftButton"); __runTimers()');
  assert.equal(addon.evaluate(L, '__overlay(2)'), '33/67', 'in dungeon 9, two of three players take the right side');
  addon.run(L, '__ns:SetSetting("overlay", false); __runTimers()');
  assert.equal(addon.evaluate(L, '__overlay(1)'), null);
  assert.deepEqual(addon.errors(L), []);
});

// Your gear for the window tests: the most used head, the most used ring (enchanted, with the
// most used gem) and nothing in the hands slot.
const MY_GEAR = `
__player.items[1] = "|cffa335ee|Hitem:100::::::::90:64::::0:0|h[Head]|h|r"
__player.items[11] = "|cffa335ee|Hitem:400:7001:9001:::::::90:64::::0:0|h[Ring]|h|r"
__itemStats[100] = { ITEM_MOD_CRIT_RATING_SHORT = 400, ITEM_MOD_HASTE_RATING_SHORT = 200 }
__itemStats[400] = { ITEM_MOD_HASTE_RATING_SHORT = 500 }
__itemStats[9001] = { ITEM_MOD_MASTERY_RATING_SHORT = 50 }`;

async function openWindow(extra = []) {
  const L = addon.loadAddon({ before: [await appData(), ...extra] });
  addon.run(L, MY_NODES);
  addon.run(L, MY_GEAR);
  addon.run(L, '__ns:TogglePanel(); __runTimers()');
  return L;
}

test('the overview shows the top players\' gear as a character pane', async () => {
  const L = await openWindow();
  const slot = (i, field) => addon.evaluate(L, `KeystoneLensFrame.overview.slots[${i}].${field}`);
  assert.equal(addon.evaluate(L, 'KeystoneLensFrame.title'), 'Keystone Lens · Frost Mage');
  assert.equal(addon.evaluate(L, 'KeystoneLensFrame.overview.header.text'), 'Top 6 Frost Mages');

  // Slots 1-8 left (head ... gems, embellished), 9-16 right (hands ... trinkets), 17-18 weapons.
  assert.equal(slot(1, 'itemID'), 100);
  assert.equal(slot(1, 'pct.text'), '67%');
  assert.equal(slot(1, 'tick.shown'), true, 'you wear the most used head');
  assert.equal(slot(1, 'quality'), 4);
  assert.equal(slot(9, 'itemID'), null, 'nobody has hands data');
  assert.equal(slot(9, 'texture'), 'Interface\\PaperDoll\\UI-PaperDoll-Slot-HANDSSLOT', 'empty-slot art');
  assert.equal(slot(13, 'itemID'), 400, 'first ring slot: the most used ring');
  assert.equal(slot(14, 'itemID'), 401, 'second ring slot: the next one');
  assert.equal(slot(14, 'tick.shown'), false);
  assert.equal(slot(7, 'itemID'), 9001, 'gems');
  assert.equal(slot(7, 'pct.text'), '67%', 'of all gem sockets');
  assert.equal(slot(7, 'tick.shown'), true);
  assert.equal(slot(17, 'itemID'), 200, 'main hand');

  // The flyout of a ring slot: every ring, then the enchants; yours marked.
  const lines = addon.evaluate(L, '__ns.FillFlyout(KeystoneLensFrame.overview.slots[13], __ns:GetSpecData(64), __ns.MyGear())');
  assert.deepEqual(
    lines.map((l) => [l.header || l.text, l.right || null, !!l.mine]),
    [
      ['Item 400', '100%', true],
      ['Item 401', '67%', false],
      ['Item 402', '33%', false],
      ['Enchants', null, false],
      ['Radiant Crit', '67%', true],
      ['Radiant Haste', '33%', false],
    ]
  );
  addon.run(L, 'KeystoneLensFrame.overview.slots[13].scripts.OnClick(KeystoneLensFrame.overview.slots[13])');

  // Stat bars: their average rating and yours (gear and gems), with the % that rating gives.
  const rows = addon.evaluate(L, '__ns.StatRows(__ns:GetSpecData(64), __ns.MyGearStats(), true)');
  assert.deepEqual(rows.crit, { theirs: 967, theirsPct: 9.67, yours: 400, yoursPct: 4, share: 0.349 });
  assert.equal(rows.haste.yours, 700);
  assert.equal(rows.mastery.yours, 50, 'gem stats count');
  assert.equal(rows.mastery.yoursPct, 1.25, 'mastery uses your spec\'s coefficient');
  assert.equal(addon.evaluate(L, 'KeystoneLensFrame.overview.stats.rows[1].theirs.text.text'), '967 · 9.7%');
  assert.equal(addon.evaluate(L, 'KeystoneLensFrame.overview.stats.rows[2].yours.text.text'), '700 · 7.0%');
  assert.equal(addon.evaluate(L, 'KeystoneLensFrame.overview.hero.text'), 'Hero talents: Alpha 67% · Beta 33%');
  assert.match(addon.evaluate(L, 'KeystoneLensFrame.overview.build.text.text'), /Your talents are Build 1\./);
  assert.deepEqual(addon.errors(L), []);
});

test('the overview shows the races the top players pick, with their racials', async () => {
  const racials = async () => ({
    nightelf: [{ id: 58984, name: 'Shadowmeld' }, { id: 20582, name: 'Quickness' }, { id: 154748, name: 'Touch of Elune' }],
    dwarf: [{ id: 20594, name: 'Stoneform' }],
  });
  const rec = await specRecord(session(), { racials });
  // More races than the strip shows (5).
  rec.races.push(
    { key: 'human', id: 1, ids: [1], name: 'Human', n: 1, faction: 'alliance' },
    { key: 'gnome', id: 7, ids: [7], name: 'Gnome', n: 1, faction: 'alliance' },
    { key: 'voidelf', id: 29, ids: [29], name: 'Void Elf', n: 1, faction: 'alliance' }
  );
  const L = addon.loadAddon({ before: [dataFileText({ 64: rec }, { appVersion: '1.2.0' })] });
  addon.run(L, '__player.raceID = 4'); // you are a Night Elf
  addon.run(L, MY_NODES);
  addon.run(L, MY_GEAR);
  addon.run(L, '__ns:TogglePanel(); __runTimers()');

  // Names in the game's language when it knows the race; the game's portrait atlas when it has one.
  const rows = addon.evaluate(L, '__ns.RaceRows(__ns:GetSpecData(64))');
  assert.deepEqual(
    rows.map((r) => [r.key, r.name, r.n, Math.round(r.share * 100), r.atlas ?? null, r.mine]),
    [
      ['nightelf', 'Nachtelf', 3, 50, 'raceicon128-nightelf-male', true],
      ['dwarf', 'Zwerg', 1, 17, 'raceicon-dwarf-male', false],
      ['pandaren', 'Pandaren', 1, 17, null, false],
      ['human', 'Mensch', 1, 17, null, false],
      ['gnome', 'Gnome', 1, 17, null, false],
      ['voidelf', 'Void Elf', 1, 17, null, false],
    ]
  );
  assert.equal(rows[2].icon, 'Interface\\Icons\\INV_Misc_QuestionMark', 'no atlas and no racials: a question mark');

  // The strip: five races with their share, yours ticked, the rest behind "+1".
  const strip = 'KeystoneLensFrame.overview.races';
  assert.equal(addon.evaluate(L, `${strip}.shown`), true);
  assert.equal(addon.evaluate(L, `${strip}.empty.shown`), false);
  assert.equal(addon.evaluate(L, `${strip}.buttons[1].icon.atlas`), 'raceicon128-nightelf-male');
  assert.equal(addon.evaluate(L, `${strip}.buttons[1].pct.text`), '50%');
  assert.equal(addon.evaluate(L, `${strip}.buttons[1].tick.shown`), true);
  assert.equal(addon.evaluate(L, `${strip}.buttons[2].tick.shown`), false);
  assert.equal(addon.evaluate(L, `${strip}.buttons[5].race.key`), 'gnome');
  assert.equal(addon.evaluate(L, `${strip}.more.shown`), true);
  assert.equal(addon.evaluate(L, `${strip}.more.text.text`), '+1');
  addon.run(L, `${strip}.more.scripts.OnEnter(${strip}.more)`);
  assert.match(addon.evaluate(L, 'GameTooltip.lines[2]'), /Void Elf.* 17%/);
  addon.run(L, `${strip}.buttons[1].scripts.OnEnter(${strip}.buttons[1])`);
  assert.deepEqual(addon.evaluate(L, 'GameTooltip.lines').slice(1, 4), ['3 of the top 6 (50%)', 'Alliance', 'Your race']);

  // The racials flyout: names, icons and "passive" from the game, the app's name as a fallback.
  const lines = addon.evaluate(L, `__ns.FillRacials(${strip}.buttons[1].race)`);
  assert.deepEqual(lines, [
    { id: 58984, name: 'Horgonblick', icon: 132089, passive: false },
    { id: 20582, name: 'Schnelligkeit', icon: 132150, passive: true },
    { id: 154748, name: 'Touch of Elune', icon: 1000 + 154748, passive: false },
  ]);
  assert.equal(addon.evaluate(L, `#__ns.FillRacials(${strip}.buttons[3].race)`), 0, 'Pandaren: no racials in the data');
  addon.run(L, `${strip}.buttons[1].scripts.OnClick(${strip}.buttons[1])`);
  addon.run(L, `${strip}.buttons[1].scripts.OnClick(${strip}.buttons[1])`);
  addon.run(L, '__ns.HideRacials()');
  assert.deepEqual(addon.errors(L), []);
});

test('data from before races were exported shows a hint instead of the races', async () => {
  const L = addon.loadAddon({ before: [await appData({ races: undefined })] });
  addon.run(L, '__ns:TogglePanel(); __runTimers()');
  const strip = 'KeystoneLensFrame.overview.races';
  assert.equal(addon.evaluate(L, `#__ns.RaceRows(__ns:GetSpecData(64))`), 0);
  assert.equal(addon.evaluate(L, `${strip}.empty.shown`), true);
  assert.equal(addon.evaluate(L, `${strip}.buttons[1].shown`), false);
  assert.equal(addon.evaluate(L, `${strip}.more.shown`), false);
  assert.deepEqual(addon.errors(L), []);
});

test('the build pane lists the builds and what each changes in yours', async () => {
  const L = await openWindow();
  const card = (i, field) => addon.evaluate(L, `KeystoneLensBuildsFrame.cards[${i}].${field}`);
  assert.equal(card(1, 'title.text'), '|TInterface\\RaidFrame\\ReadyCheck-Ready:12|t Build 1 · Alpha');
  assert.equal(card(1, 'sub.text'), '4 players · 67% · |cff40ff40your build|r');
  assert.equal(card(2, 'title.text'), 'Build 2 · Beta');
  assert.equal(card(2, 'sub.text'), '2 players · 33% · 5 talents differ');
  assert.equal(card(1, 'lines[1].text'), '|cff40ff40This is your build.|r', 'your closest build is open');

  // Opening build 2: the other hero tree in one line, then take / other choice / other rank.
  addon.run(L, 'KeystoneLensBuildsFrame.cards[2].scripts.OnClick(KeystoneLensBuildsFrame.cards[2])');
  const lines = [1, 2, 3, 4].map((i) => card(2, `lines[${i}].text`));
  assert.deepEqual(lines, [
    'Hero talents: |cffffd100Beta|r (yours: Alpha)',
    '|cff40ff40+|r Entry 60',
    '|cffffd100~|r Entry 22  |cff999999instead of Entry 21|r',
    '|cffffd100~|r Entry 30  |cff999999rank 1 instead of 2|r',
  ]);
  assert.equal(card(2, 'copy.shown'), true);

  // Show on talents: the talent window frames what build 2 changes, until you stop it.
  addon.run(L, TALENT_FRAME);
  addon.run(L, 'PlayerSpellsFrame.TalentsFrame:Hide(); KeystoneLensBuildsFrame.cards[2].show.scripts.OnClick(); __runTimers()');
  assert.equal(addon.evaluate(L, 'PlayerSpellsFrame.TalentsFrame:IsShown()'), true, 'the talent window opens');
  assert.deepEqual(addon.evaluate(L, '__border(6)'), [0.2, 1, 0.2, 0.95], 'build 2 takes it: green');
  assert.deepEqual(addon.evaluate(L, '__border(2)'), [1, 0.9, 0.1, 0.95], 'other choice: yellow');
  assert.deepEqual(addon.evaluate(L, '__border(3)'), [1, 0.9, 0.1, 0.95], 'other rank: yellow');
  assert.deepEqual(addon.evaluate(L, '__border(4)'), [1, 0.2, 0.1, 0.95], 'your hero tree, which build 2 does not use: red');
  assert.equal(addon.evaluate(L, '__border(1)[4]'), 0, 'the same in both');
  const bar = 'PlayerSpellsFrame.TalentsFrame.children[1].children[4]';
  assert.equal(addon.evaluate(L, `${bar}.shown`), true);
  assert.match(addon.evaluate(L, `${bar}.text`), /Build 2$/);
  addon.run(L, `GameTooltip:SetOwner(__buttons[6]); __buttons[6]:SetTooltipInternal()`);
  assert.ok(addon.evaluate(L, 'GameTooltip.lines').includes('Build 2 takes this.'));

  addon.run(L, `${bar}.scripts.OnClick(); __runTimers()`);
  assert.equal(addon.evaluate(L, `${bar}.shown`), false);
  assert.equal(addon.evaluate(L, '__border(6)[4]'), 0, 'back to pick rates');
  assert.deepEqual(addon.errors(L), []);
});

test('build differences, kind by kind', () => {
  const L = addon.loadAddon();
  const diff = addon.evaluate(
    L,
    `__ns.BuildDiff(
      { picks = { [1] = 1, [2] = 1, [3] = 2, [7] = 1 }, choices = { [2] = 21 } },
      { picks = { [1] = 1, [2] = 1, [3] = 1, [6] = 1, [8] = 1 }, choices = { [2] = 22 } },
      { [8] = 40 })`
  );
  assert.deepEqual(
    diff.map((d) => [d.kind, d.nodeID]),
    [['add', 6], ['choice', 2], ['rank', 3], ['drop', 7]],
    'node 8 is skipped (the other hero tree)'
  );
  assert.equal(addon.evaluate(L, '__ns.BuildDistance({ picks = { [1] = 1 }, choices = {} }, { picks = { [1] = 2, [2] = 1 } })'), 2);
});

test('the dropdowns change the spec and the dungeon, shared with the talent window', async () => {
  const fire = dataFileText({ 63: { ...(await specRecord(session())), specId: 63, spec: 'Fire' } }).replace('KeystoneLensAppData = ', 'KeystoneLensBundledData = ');
  const L = await openWindow([fire]);
  const spec = 'KeystoneLensFrame.specMenu';
  const zone = 'KeystoneLensFrame.zoneMenu';
  assert.equal(addon.evaluate(L, `${spec}.shown`), true, 'two specs: the spec menu shows');
  assert.deepEqual(addon.evaluate(L, `__menu(${spec})`), [{ text: 'Fire Mage', selected: false }, { text: 'Frost Mage', selected: true }]);
  assert.deepEqual(addon.evaluate(L, `__menu(${zone})`), [{ text: 'All dungeons', selected: true }, { text: 'Somewhere', selected: false }]);

  addon.run(L, `__pick(${zone}, 2); __runTimers()`);
  assert.equal(addon.evaluate(L, '__ns.state.zoneID'), 9);
  assert.equal(addon.evaluate(L, 'KeystoneLensBuildsFrame.where.text'), 'Somewhere · top 3');

  addon.run(L, `__pick(${spec}, 1); __runTimers()`);
  assert.equal(addon.evaluate(L, 'KeystoneLensFrame.title'), 'Keystone Lens · Fire Mage');
  assert.equal(addon.evaluate(L, '__ns.state.zoneID'), null, 'a new spec starts on all dungeons');
  assert.equal(addon.evaluate(L, 'KeystoneLensFrame.overview.slots[1].tick.shown'), true, 'your gear is still marked: same class');
  assert.deepEqual(addon.errors(L), []);
});

test('the Info tab says where the data comes from; without data the window explains it', async () => {
  const L = await openWindow();
  // The Info tab's fixed text is written when the window is built.
  const fixed = addon.evaluate(L, '__texts');
  assert.ok(fixed.some((t) => /desktop app/.test(t)));
  assert.ok(fixed.some((t) => /raider\.io/.test(t)), 'credits the data source');
  addon.run(L, '__texts = {}; KeystoneLensFrame.tabs[2].scripts.OnClick()');
  assert.equal(addon.evaluate(L, 'KeystoneLensFrame.selectedTab'), 2);
  assert.equal(addon.evaluate(L, 'KeystoneLensFrame.overview.shown'), false);
  const texts = addon.evaluate(L, '__texts');
  assert.ok(texts.includes('Top 6 Frost Mages · World · MN Season 1 · patch 12.1.0'));
  assert.ok(texts.some((t) => /^From the Keystone Lens app, .*1 of 2 dungeons have their own builds\.$/.test(t)));
  assert.equal(addon.evaluate(L, 'KeystoneLensFrame.info.checks[1].checked'), true);

  const empty = addon.loadAddon();
  addon.run(empty, '__ns:TogglePanel()');
  assert.match(addon.evaluate(empty, 'KeystoneLensFrame.overview.empty.text'), /^No data yet\.[\s\S]*Keystone Lens desktop app/);
  assert.equal(addon.evaluate(empty, 'KeystoneLensFrame.overview.slots[1].shown'), false);
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

-- A small stand-in for the World of Warcraft API, enough to load the Keystone Lens addon and
-- run its logic in tests (with fengari, Lua 5.3: the 5.1 globals WoW has are added here).
-- Widgets remember what is set on them; __texts collects every text shown.

unpack = unpack or table.unpack
__texts = {}
__events = {} -- frames by registered event

local function noop() end

local Widget = {}
Widget.__index = Widget
-- Widget methods that only change how things look: they do nothing here.
for _, name in ipairs({
  "ClearAllPoints", "EnableMouse", "HighlightText", "LockHighlight", "RegisterForClicks", "RegisterForDrag",
  "SetAllPoints", "SetAutoFocus", "SetBackdrop", "SetBackdropColor", "SetFocus", "SetFont", "SetFontObject",
  "SetFrameLevel", "SetFrameStrata", "SetHeight", "SetItemByID", "SetJustifyH", "SetMovable", "SetClampedToScreen",
  "SetPoint", "SetScrollChild", "SetSize", "SetTexture", "SetWidth", "StartMoving", "StopMovingOrSizing", "UnlockHighlight",
  "SetToplevel", "SetStatusBarTexture", "SetStatusBarColor", "SetColorTexture", "SetBackdropColor", "SetJustifyV",
  "SetHighlightTexture",
}) do
  Widget[name] = noop
end

local function newWidget(kind, parent)
  local w = setmetatable({ kind = kind, parent = parent, shown = true, scripts = {}, children = {} }, Widget)
  if parent and parent.children then
    table.insert(parent.children, w)
  end
  return w
end

function Widget:SetAtlas(atlas) self.atlas = atlas end
function Widget:GetParent() return self.parent end
function Widget:SetSpellByID(id) self.spellID = id end

function Widget:SetText(text)
  self.text = text
  if text and text ~= "" then
    table.insert(__texts, text)
  end
end
function Widget:GetText() return self.text end
function Widget:SetFormattedText(fmt, ...) self:SetText(string.format(fmt, ...)) end
function Widget:Show() self.shown = true; local s = self.scripts.OnShow; if s then s(self) end end
function Widget:Hide() self.shown = false end
function Widget:SetShown(v) if v then self:Show() else self:Hide() end end
function Widget:IsShown() return self.shown end
function Widget:SetScript(name, fn) self.scripts[name] = fn end
function Widget:GetScript(name) return self.scripts[name] end
function Widget:HookScript(name, fn)
  local old = self.scripts[name]
  self.scripts[name] = function(...)
    if old then old(...) end
    fn(...)
  end
end
function Widget:RegisterEvent(event)
  __events[event] = __events[event] or {}
  table.insert(__events[event], self)
end
function Widget:CreateFontString() return newWidget("FontString", self) end
function Widget:CreateTexture() return newWidget("Texture", self) end
function Widget:GetFont() return "Fonts\\FRIZQT__.TTF", 10, "" end
function Widget:SetBackdropBorderColor(r, g, b, a) self.border = { r, g, b, a } end
function Widget:SetChecked(v) self.checked = v end
function Widget:GetChecked() return self.checked end
function Widget:GetFrameLevel() return 1 end
function Widget:SetTextColor(r, g, b) self.color = { r, g, b } end
function Widget:SetEnabled(v) self.enabled = v end
function Widget:SetID(id) self.id = id end
function Widget:GetID() return self.id end
function Widget:IsMouseOver() return false end
function Widget:GetHeight() return self.height or 500 end
function Widget:SetMinMaxValues(lo, hi) self.min, self.max = lo, hi end
function Widget:SetValue(v) self.value = v end
-- PortraitFrameMixin (ButtonFrameTemplate)
function Widget:SetTitle(t) self.title = t; table.insert(__texts, t) end
function Widget:SetPortraitToAsset(t) self.portrait = t end
-- DropdownButton: the menu generator is run by GenerateMenu; __menu(dd) lists its radios.
function Widget:SetupMenu(fn) self.generator = fn; self:GenerateMenu() end
function Widget:SetDefaultText(t) self.defaultText = t end
function Widget:GenerateMenu()
  local radios = {}
  local root = {}
  function root:CreateRadio(text, isSelected, setSelected) table.insert(radios, { text = text, isSelected = isSelected, setSelected = setSelected }) end
  if self.generator then self.generator(self, root) end
  self.radios = radios
  for _, r in ipairs(radios) do
    if r.isSelected() then self.text = r.text end
  end
end

function CreateFrame(kind, name, parent, template)
  local w = newWidget(kind, parent)
  w.template = template
  if template == "ButtonFrameTemplate" then
    w.Inset = newWidget("Frame", w)
  elseif template == "PanelTabButtonTemplate" and parent then
    parent.Tabs = parent.Tabs or {} -- parentArray="Tabs"
    table.insert(parent.Tabs, w)
  end
  if kind == "Frame" or kind == "Button" or kind == "CheckButton" then
    w.shown = true
  end
  if name then
    _G[name] = w
  end
  return w
end

--- Send a game event to every frame that registered it.
function __fire(event, ...)
  for _, f in ipairs(__events[event] or {}) do
    local handler = f.scripts.OnEvent
    if handler then
      handler(f, event, ...)
    end
  end
end

-- ---------------------------------------------------------------- globals

UIParent = newWidget("Frame")
GameTooltip = newWidget("GameTooltip")
GameTooltip.lines = {}
function GameTooltip:AddLine(text) table.insert(self.lines, text) end
function GameTooltip:AddDoubleLine(a, b) table.insert(self.lines, a .. " " .. b) end
function GameTooltip:SetOwner(owner) self.owner = owner; self.lines = {} end
function GameTooltip:GetOwner() return self.owner end
ItemRefTooltip = newWidget("GameTooltip")
GameTooltip_Hide = noop
UISpecialFrames = {}
SlashCmdList = {}
tinsert = table.insert
GameFontHighlightSmall, GameFontNormal = {}, {}

function strtrim(s) return (string.gsub(s or "", "^%s*(.-)%s*$", "%1")) end
__errors = {} -- errors the addon reported through the error handler
function geterrorhandler() return function(err) table.insert(__errors, tostring(err)) end end
function hooksecurefunc(t, name, fn)
  if type(t) == "string" then
    t, name, fn = _G, t, name
  end
  local old = t[name]
  t[name] = function(...)
    local r = { old(...) }
    fn(...)
    return unpack(r)
  end
end
function InCombatLockdown() return false end
function time() return __now or 1761300000 end
date = os.date

-- Timers run when the test calls __runTimers().
local timers = {}
C_Timer = { After = function(_, fn) table.insert(timers, fn) end }
function __runTimers()
  for _ = 1, 10 do
    if #timers == 0 then return end
    local run = timers
    timers = {}
    for _, fn in ipairs(run) do fn() end
  end
end

C_AddOns = { GetAddOnMetadata = function(_, field) return field == "Version" and "1.0.0" or nil end }
Enum = { TooltipDataType = { Item = 0 } }
__tooltipPostCalls = {}
TooltipDataProcessor = { AddTooltipPostCall = function(kind, fn) __tooltipPostCalls[kind] = fn end }
__loadedCallbacks = {}
EventUtil = { ContinueOnAddOnLoaded = function(name, fn) __loadedCallbacks[name] = fn end }
Settings = {
  RegisterCanvasLayoutCategory = function() return { GetID = function() return 1 end } end,
  RegisterAddOnCategory = noop,
  OpenToCategory = noop,
}

-- ---------------------------------------------------------------- the player (tests change __player)

__player = {
  name = "Fjäll", realm = "Tarren Mill", region = 3, classFile = "MAGE", classID = 8, race = "Human", raceFile = "Human", raceID = 1, sex = 2,
  level = 90, specID = 64, ilvl = 289.44,
  items = {}, -- [slot] = link
  configID = 1001,
  nodes = {}, -- [nodeID] = node info
  savedLoadouts = {},
  importStrings = { [1001] = "ACTIVESTRING" },
  keystoneMap = nil,
}

function UnitName() return __player.name end
function GetRealmName() return __player.realm end
function GetCurrentRegion() return __player.region end
function UnitClass() return "Mage", __player.classFile, __player.classID end
function UnitRace() return __player.race, __player.raceFile, __player.raceID end
function UnitSex() return __player.sex end
function UnitLevel() return __player.level end
function GetAverageItemLevel() return __player.ilvl, __player.ilvl end
function GetSpecialization() return 1 end
function GetSpecializationInfo() return __player.specID end
function GetSpecializationInfoByID(id) return id, "Spec " .. id end
PlayerUtil = { GetCurrentSpecID = function() return __player.specID end }
function GetInventoryItemLink(_, slot) return __player.items[slot] end
function GetInventoryItemID(_, slot)
  local link = __player.items[slot]
  return link and tonumber(string.match(link, "item:(%d+)")) or nil
end
function GetCombatRating(id) return ({ [9] = 300, [18] = 500, [26] = 150, [29] = 50 })[id] or 0 end

C_Item = {
  GetDetailedItemLevelInfo = function(link) return tonumber(string.match(link, "ilvl=(%d+)")) or 600 end,
  GetItemIconByID = function() return 134400 end,
  GetItemNameByID = function() return nil end,
  RequestLoadItemDataByID = noop,
}
C_ChallengeMode = { GetActiveChallengeMapID = function() return nil end }
C_MythicPlus = { GetOwnedKeystoneChallengeMapID = function() return __player.keystoneMap end }

C_ClassTalents = {
  GetActiveConfigID = function() return __player.configID end,
  GetActiveHeroTalentSpec = function() return __player.hero end,
  GetConfigIDsBySpecID = function() return __player.savedLoadouts end,
}
C_Traits = {
  GenerateImportString = function(id) return __player.importStrings[id] or "" end,
  GetConfigInfo = function(id) return { treeIDs = { 1 }, name = "Loadout " .. id } end,
  GetTreeNodes = function()
    local ids = {}
    for id in pairs(__player.nodes) do table.insert(ids, id) end
    table.sort(ids)
    return ids
  end,
  GetNodeInfo = function(_, nodeID) return __player.nodes[nodeID] end,
  GetEntryInfo = function(_, entryID) return { definitionID = entryID } end,
  GetDefinitionInfo = function(id) return { overrideName = "Entry " .. id } end,
}
C_Spell = {
  GetSpellName = function() return nil end,
  GetSpellTexture = function(id) return 1000 + id end,
  -- Spells the game knows (others return nil, as for spells not loaded yet).
  GetSpellInfo = function(id) return __spells[id] end,
  IsSpellPassive = function(id) return __spells[id] ~= nil and __spells[id].passive == true end,
}
__spells = {
  [58984] = { name = "Horgonblick", iconID = 132089, spellID = 58984 },
  [20582] = { name = "Schnelligkeit", iconID = 132150, spellID = 20582, passive = true },
}
-- Race names in the game's language (German here, to see they are used) and atlases the game has.
C_CreatureInfo = {
  GetRaceInfo = function(id)
    local races = { [1] = { "Mensch", "Human" }, [3] = { "Zwerg", "Dwarf" }, [4] = { "Nachtelf", "NightElf" }, [24] = { "Pandaren", "Pandaren" } }
    local r = races[id]
    return r and { raceName = r[1], clientFileString = r[2], raceID = id } or nil
  end,
}
__atlases = { ["raceicon128-nightelf-male"] = true, ["raceicon-dwarf-male"] = true }
C_Texture = { GetAtlasInfo = function(name) return __atlases[name] and { width = 128, height = 128 } or nil end }

-- ---------------------------------------------------------------- window, items and stats

function PanelTemplates_SetNumTabs(frame, n) frame.numTabs = n end
function PanelTemplates_SetTab(frame, id) frame.selectedTab = id end
function ButtonFrameTemplate_HidePortrait(frame) frame.portraitHidden = true end
function SetItemButtonTexture(button, texture) button.texture = texture end
function SetItemButtonQuality(button, quality) button.quality = quality end
function BreakUpLargeNumbers(n)
  local s = tostring(math.floor(n))
  local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
  return (out:gsub("^,", ""))
end
function GetInventorySlotInfo(name) return 1, "Interface\\PaperDoll\\UI-PaperDoll-Slot-" .. name end
-- 1% per 100 rating, mastery coefficient 2.5.
function GetCombatRatingBonusForCombatRatingValue(_, rating) return rating / 100 end
function GetMasteryEffect() return 20, 2.5 end
GameFontNormalSmall = {}

__itemStats = {} -- [itemID] = { ITEM_MOD_... = value }
C_Item.GetItemStats = function(link)
  local id = tonumber(string.match(link, "item:(%d+)"))
  return __itemStats[id] or {}
end
C_Item.GetItemGemID = function(link, index)
  local fields = {}
  for part in (string.match(link, "item:([%-%d:]+)") .. ":"):gmatch("([^:]*):") do table.insert(fields, part) end
  local gem = tonumber(fields[2 + index])
  return gem and gem > 0 and gem or nil
end
C_Item.GetItemQualityByID = function() return 4 end
C_Item.GetItemQualityColor = function() return 0.64, 0.21, 0.93 end
PlayerSpellsUtil = {
  OpenToClassTalentsTab = function()
    if PlayerSpellsFrame and PlayerSpellsFrame.TalentsFrame then PlayerSpellsFrame.TalentsFrame:Show() end
  end,
}

--- The radios of a dropdown: { text, selected }; __pick(dd, i) chooses one.
function __menu(dd)
  dd:GenerateMenu()
  local out = {}
  for _, r in ipairs(dd.radios) do table.insert(out, { text = r.text, selected = r.isSelected() }) end
  return out
end
function __pick(dd, i) dd:GenerateMenu(); dd.radios[i].setSelected() end

-- Keystone Lens: saves your character for the desktop app.
--
-- On login and when your spec, talents or gear change, the addon writes a SimulationCraft-style
-- text (class, realm, talent strings, equipped items) into KeystoneLensDB.characters. The game
-- saves it to disk when you log out or /reload; the app reads it for "Compare with my character".
local _, ns = ...

local REGIONS = { [1] = "us", [2] = "kr", [3] = "eu", [4] = "tw", [5] = "cn" }

-- Inventory slot ID -> SimulationCraft slot name (shirt and tabard left out).
ns.SIMC_SLOTS = {
  { 1, "head" }, { 2, "neck" }, { 3, "shoulder" }, { 15, "back" }, { 5, "chest" },
  { 9, "wrist" }, { 10, "hands" }, { 6, "waist" }, { 7, "legs" }, { 8, "feet" },
  { 11, "finger1" }, { 12, "finger2" }, { 13, "trinket1" }, { 14, "trinket2" },
  { 16, "main_hand" }, { 17, "off_hand" },
}

-- Item link modifier types (see the ItemLink page on warcraft.wiki.gg).
local MOD_CRAFTING_STAT_1 = 29
local MOD_CRAFTING_STAT_2 = 30
local MOD_REDIRECTED_BASE_STATS = 64

--- "item:1:2::4..." of a link as numbers (empty fields are 0).
function ns.SplitItemString(link)
  local s = type(link) == "string" and string.match(link, "item:([%-%d:]+)")
  if not s then
    return nil
  end
  local out = {}
  local start = 1
  while true do
    local colon = string.find(s, ":", start, true)
    local part = string.sub(s, start, colon and colon - 1 or nil)
    out[#out + 1] = tonumber(part) or 0
    if not colon then
      break
    end
    start = colon + 1
  end
  return out
end

--- One SimulationCraft gear line ("head=,id=...,bonus_id=...") from an item link.
function ns.SimcItemLine(slotName, link)
  local f = ns.SplitItemString(link)
  if not f or (f[1] or 0) == 0 then
    return nil
  end
  local opts = { "id=" .. f[1] }
  if (f[2] or 0) > 0 then
    opts[#opts + 1] = "enchant_id=" .. f[2]
  end
  local gems = {}
  for i = 3, 6 do
    gems[#gems + 1] = f[i] or 0
  end
  while #gems > 0 and gems[#gems] == 0 do
    table.remove(gems)
  end
  if #gems > 0 then
    opts[#opts + 1] = "gem_id=" .. table.concat(gems, "/")
  end
  local numBonus = f[13] or 0
  local bonuses = {}
  for i = 1, numBonus do
    bonuses[#bonuses + 1] = f[13 + i]
  end
  if #bonuses > 0 then
    opts[#opts + 1] = "bonus_id=" .. table.concat(bonuses, "/")
  end
  local at = 13 + numBonus + 1
  local crafted = {}
  for i = 1, f[at] or 0 do
    local kind, value = f[at + 2 * i - 1], f[at + 2 * i]
    if kind == MOD_CRAFTING_STAT_1 or kind == MOD_CRAFTING_STAT_2 then
      crafted[#crafted + 1] = value
    elseif kind == MOD_REDIRECTED_BASE_STATS then
      opts[#opts + 1] = "redirected_base_stats=" .. value
    end
  end
  if #crafted > 0 then
    opts[#opts + 1] = "crafted_stats=" .. table.concat(crafted, "/")
  end
  return slotName .. "=," .. table.concat(opts, ",")
end

--- Realm name as a lower-case slug ("Tarren Mill" -> "tarren-mill"); the app re-slugs it.
function ns.RealmSlug(realm)
  local s = string.lower(realm or "")
  s = string.gsub(s, "'", "")
  s = string.gsub(s, "[%s%p]+", "-")
  s = string.gsub(s, "^%-+", "")
  s = string.gsub(s, "%-+$", "")
  return s
end

local function talentString(configID)
  if not (C_Traits and C_Traits.GenerateImportString and configID) then
    return nil
  end
  local ok, text = pcall(C_Traits.GenerateImportString, configID)
  if ok and type(text) == "string" and text ~= "" then
    return text
  end
  return nil
end

--- Your character as SimulationCraft text, plus the facts the app lists it by. Nil before the
--- talent data is ready.
function ns.CharacterSnapshot()
  local specID = ns.PlayerSpecID()
  local active = C_ClassTalents and C_ClassTalents.GetActiveConfigID and C_ClassTalents.GetActiveConfigID()
  local talents = talentString(active)
  if not specID or not talents then
    return nil
  end
  local name = UnitName("player")
  local realm = GetRealmName()
  local region = REGIONS[GetCurrentRegion and GetCurrentRegion() or 0] or "us"
  local _, classFile, classID = UnitClass("player")
  local _, raceFile = UnitRace("player")
  local _, equipped = GetAverageItemLevel()

  local lines = {
    "# " .. name .. " - Keystone Lens snapshot - " .. date("%Y-%m-%d %H:%M"),
    string.lower(classFile) .. '="' .. name .. '"',
    "level=" .. UnitLevel("player"),
    "race=" .. string.lower(raceFile or ""),
    "region=" .. region,
    "server=" .. ns.RealmSlug(realm),
    "spec=" .. (ns.SPEC_TOKENS[specID] or ""),
    "",
    "talents=" .. talents,
  }

  -- Saved loadouts of this spec (the app can compare them too).
  local ids = C_ClassTalents.GetConfigIDsBySpecID and C_ClassTalents.GetConfigIDsBySpecID(specID) or {}
  for _, configID in ipairs(ids) do
    local text = talentString(configID)
    local info = C_Traits.GetConfigInfo(configID)
    if text and info and info.name then
      lines[#lines + 1] = ""
      lines[#lines + 1] = "# Saved Loadout: " .. string.gsub(info.name, "[\r\n]", " ")
      lines[#lines + 1] = "# talents=" .. text
    end
  end

  lines[#lines + 1] = ""
  for _, slot in ipairs(ns.SIMC_SLOTS) do
    local link = GetInventoryItemLink("player", slot[1])
    local line = link and ns.SimcItemLine(slot[2], link)
    if line then
      local itemName = string.match(link, "%[(.-)%]") or ""
      local ilvl = C_Item and C_Item.GetDetailedItemLevelInfo and C_Item.GetDetailedItemLevelInfo(link)
      lines[#lines + 1] = "# " .. string.gsub(itemName, "|", "") .. " (" .. (ilvl or 0) .. ")"
      lines[#lines + 1] = line
    end
  end

  return {
    name = name,
    realm = realm,
    region = region,
    className = classFile,
    classID = classID,
    specID = specID,
    level = UnitLevel("player"),
    itemLevel = equipped and math.floor(equipped * 10 + 0.5) / 10 or nil,
    time = time(),
    simc = table.concat(lines, "\n") .. "\n",
  }
end

--- Store the snapshot under "Name-realm-region" (the app reads specId, the rest is for display).
function ns:SaveCharacter()
  if not self.db then
    return false
  end
  local snap = ns.CharacterSnapshot()
  if not snap then
    return false
  end
  local key = snap.name .. "-" .. ns.RealmSlug(snap.realm) .. "-" .. snap.region
  self.db.characters[key] = {
    name = snap.name,
    realm = snap.realm,
    region = snap.region,
    className = snap.className,
    specId = snap.specID,
    level = snap.level,
    itemLevel = snap.itemLevel,
    time = snap.time,
    simc = snap.simc,
  }
  return true
end

-- Gear and talent events come in bursts: save once things settle, never in combat.
local pending = false
local dirty = false -- something changed since the last save
local function scheduleSave()
  if pending then
    return
  end
  pending = true
  C_Timer.After(3, function()
    pending = false
    if InCombatLockdown() then
      return -- PLAYER_REGEN_ENABLED schedules it again
    end
    if ns:SaveCharacter() then
      dirty = false
    end
  end)
end
ns.ScheduleCharacterSave = scheduleSave

local function changed()
  dirty = true
  scheduleSave()
end

ns:Listen("LOGIN", changed)
ns:On("TRAIT_CONFIG_LIST_UPDATED", changed)
ns:On("TRAIT_CONFIG_UPDATED", changed)
ns:On("ACTIVE_PLAYER_SPECIALIZATION_CHANGED", changed)
ns:On("PLAYER_EQUIPMENT_CHANGED", changed)
ns:On("PLAYER_REGEN_ENABLED", function()
  if dirty then
    scheduleSave()
  end
end)
-- Last chance before the game writes SavedVariables.
ns:On("PLAYER_LOGOUT", function()
  if not InCombatLockdown() then
    ns:SaveCharacter()
  end
end)

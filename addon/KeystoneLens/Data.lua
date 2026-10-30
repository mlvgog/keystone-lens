-- Keystone Lens: the talent and gear data, your own talents, and comparing the two.
--
-- Data comes from global tables of the same format (see src/main/addonExport.js in the app):
-- KeystoneLensAppData (written by the desktop app into the KeystoneLens_Data addon) and,
-- in a standalone release, KeystoneLensBundledData. Per spec the newest record wins.
local _, ns = ...

ns.SCHEMA = 1

-- SimulationCraft spec tokens (English) by specialization ID.
ns.SPEC_TOKENS = {
  [250] = "blood", [251] = "frost", [252] = "unholy",
  [577] = "havoc", [581] = "vengeance", [1480] = "devourer",
  [102] = "balance", [103] = "feral", [104] = "guardian", [105] = "restoration",
  [1467] = "devastation", [1468] = "preservation", [1473] = "augmentation",
  [253] = "beast_mastery", [254] = "marksmanship", [255] = "survival",
  [62] = "arcane", [63] = "fire", [64] = "frost",
  [268] = "brewmaster", [270] = "mistweaver", [269] = "windwalker",
  [65] = "holy", [66] = "protection", [70] = "retribution",
  [256] = "discipline", [257] = "holy", [258] = "shadow",
  [259] = "assassination", [260] = "outlaw", [261] = "subtlety",
  [262] = "elemental", [263] = "enhancement", [264] = "restoration",
  [265] = "affliction", [266] = "demonology", [267] = "destruction",
  [71] = "arms", [72] = "fury", [73] = "protection",
}

-- Enum.TraitNodeType: Single 0, Tiered 1, Selection 2, SubTreeSelection 3.
local NODE_SELECTION = 2
local NODE_SUBTREE_SELECTION = 3

-- ---------------------------------------------------------------- data sources

--- The loaded data tables: { { data = table, source = "app"|"bundle" }, ... }
function ns:Sources()
  local list = {}
  if type(KeystoneLensAppData) == "table" then
    list[#list + 1] = { data = KeystoneLensAppData, source = "app" }
  end
  if type(KeystoneLensBundledData) == "table" then
    list[#list + 1] = { data = KeystoneLensBundledData, source = "bundle" }
  end
  return list
end

--- True when a data file was written for a newer version of the addon.
function ns:NeedsUpdate()
  for _, s in ipairs(self:Sources()) do
    if (tonumber(s.data.schema) or 0) > ns.SCHEMA then
      return true
    end
  end
  return false
end

--- The record of one spec and where it came from ("app" or "bundle"), newest first.
function ns:GetSpecData(specID)
  local best, bestSource
  for _, s in ipairs(self:Sources()) do
    local d = s.data
    if tonumber(d.schema) == ns.SCHEMA and type(d.specs) == "table" then
      local rec = d.specs[specID]
      if type(rec) == "table" and (not best or (rec.time or 0) > (best.time or 0)) then
        best, bestSource = rec, s.source
      end
    end
  end
  return best, bestSource
end

--- All specs with data, sorted by class and spec name: { { specID, rec, source }, ... }
function ns:AvailableSpecs()
  local seen, list = {}, {}
  for _, s in ipairs(self:Sources()) do
    if tonumber(s.data.schema) == ns.SCHEMA and type(s.data.specs) == "table" then
      for specID in pairs(s.data.specs) do
        if not seen[specID] then
          seen[specID] = true
          local rec, source = self:GetSpecData(specID)
          list[#list + 1] = { specID = specID, rec = rec, source = source }
        end
      end
    end
  end
  table.sort(list, function(a, b)
    local ka = (a.rec.class or "") .. " " .. (a.rec.spec or "")
    local kb = (b.rec.class or "") .. " " .. (b.rec.spec or "")
    return ka < kb
  end)
  return list
end

--- Talents, builds and hero trees for all keys (zoneID nil) or one dungeon.
function ns.View(rec, zoneID)
  if zoneID and rec.dungeons and rec.dungeons[zoneID] and (rec.dungeons[zoneID].sample or 0) > 0 then
    local d = rec.dungeons[zoneID]
    return { talents = d.talents or {}, builds = d.builds or {}, hero = d.hero or {}, sample = d.sample, zoneID = zoneID }
  end
  return { talents = rec.talents or {}, builds = rec.builds or {}, hero = rec.hero or {}, sample = rec.sample or 0 }
end

--- Dungeons of a record that have their own data: { { id, name, short, map }, ... }
function ns.LoadedDungeons(rec)
  local list = {}
  for _, d in ipairs(rec.dungeonList or {}) do
    local dd = rec.dungeons and rec.dungeons[d.id]
    if dd and (dd.sample or 0) > 0 then
      list[#list + 1] = d
    end
  end
  return list
end

function ns.DungeonName(rec, zoneID, short)
  for _, d in ipairs(rec.dungeonList or {}) do
    if d.id == zoneID then
      return short and d.short or d.name
    end
  end
  return nil
end

--- The dungeon you are in or hold a keystone for, when the data has it.
function ns:CurrentDungeon(rec)
  local maps = {}
  if C_ChallengeMode and C_ChallengeMode.GetActiveChallengeMapID then
    maps[#maps + 1] = C_ChallengeMode.GetActiveChallengeMapID()
  end
  if C_MythicPlus and C_MythicPlus.GetOwnedKeystoneChallengeMapID then
    maps[#maps + 1] = C_MythicPlus.GetOwnedKeystoneChallengeMapID()
  end
  for _, mapID in ipairs(maps) do
    if mapID then
      for _, d in ipairs(ns.LoadedDungeons(rec)) do
        if d.map == mapID then
          return d.id
        end
      end
    end
  end
  return nil
end

function ns.HeroName(rec, heroID)
  for _, h in ipairs(rec.hero or {}) do
    if h.id == heroID then
      return h.name
    end
  end
  return nil
end

-- ---------------------------------------------------------------- your talents

function ns.PlayerSpecID()
  if PlayerUtil and PlayerUtil.GetCurrentSpecID then
    return PlayerUtil.GetCurrentSpecID()
  end
  local index = GetSpecialization and GetSpecialization()
  return index and GetSpecializationInfo(index) or nil
end

--- Your talents in a config (default: the active one), as the data stores builds:
--- { picks = { [nodeID] = rank }, choices = { [nodeID] = entryID }, hero = subTreeID,
---   granted = { [nodeID] = true } }.
--- Talents the game grants for free (activeRank without ranksPurchased, e.g. the first node of a
--- tree or of the hero tree) are in `granted`, not in `picks`: builds leave them out too.
--- The inactive hero tree is left out.
function ns.GetMyPicks(configID)
  if not (C_ClassTalents and C_Traits) then
    return nil
  end
  configID = configID or C_ClassTalents.GetActiveConfigID()
  local config = configID and C_Traits.GetConfigInfo(configID)
  if not config or not config.treeIDs then
    return nil
  end
  local picks, choices, granted = {}, {}, {}
  for _, treeID in ipairs(config.treeIDs) do
    for _, nodeID in ipairs(C_Traits.GetTreeNodes(treeID) or {}) do
      local info = C_Traits.GetNodeInfo(configID, nodeID)
      if info and info.ID and info.ID ~= 0 and info.type ~= NODE_SUBTREE_SELECTION and (not info.subTreeID or info.subTreeActive) then
        if (info.ranksPurchased or 0) > 0 then
          picks[nodeID] = info.activeRank or info.ranksPurchased
          if info.type == NODE_SELECTION and info.activeEntry then
            choices[nodeID] = info.activeEntry.entryID
          end
        elseif (info.activeRank or 0) > 0 then
          granted[nodeID] = true
        end
      end
    end
  end
  local hero = C_ClassTalents.GetActiveHeroTalentSpec and C_ClassTalents.GetActiveHeroTalentSpec() or nil
  return { picks = picks, choices = choices, hero = hero, granted = granted }
end

--- Number of talents where two builds differ (missing, other rank or other choice),
--- counted as the app counts them when it groups builds.
function ns.BuildDistance(a, b)
  local d = 0
  local seen = {}
  for nodeID, rank in pairs(a.picks or {}) do
    seen[nodeID] = true
    if b.picks == nil or b.picks[nodeID] ~= rank or (a.choices and a.choices[nodeID]) ~= (b.choices and b.choices[nodeID]) then
      d = d + 1
    end
  end
  for nodeID in pairs(b.picks or {}) do
    if not seen[nodeID] then
      d = d + 1
    end
  end
  return d
end

--- The popular build closest to yours: index, distance.
function ns.ClosestBuild(builds, mine)
  local bestIndex, bestDistance
  for i, b in ipairs(builds or {}) do
    if b.picks then
      local d = ns.BuildDistance(mine, b)
      if not bestDistance or d < bestDistance then
        bestIndex, bestDistance = i, d
      end
    end
  end
  return bestIndex, bestDistance
end

--- How you differ from the top players on one node: "missing" (popular, you skip it),
--- "rare" (you pick it, few do, or you took the less common choice) or nil.
--- A talent you get for free is neither: everyone has it.
function ns.NodeVerdict(stat, mine, nodeID, popular, rare)
  if mine and mine.granted and mine.granted[nodeID] then
    return nil
  end
  local picked = mine and mine.picks[nodeID]
  local p = stat and stat.p or 0
  if picked then
    if p < rare then
      return "rare"
    end
    if stat and stat.e and mine.choices[nodeID] then
      local yours = stat.e[mine.choices[nodeID]] or 0
      for _, share in pairs(stat.e) do
        if share > yours then
          return "rare"
        end
      end
    end
    return nil
  end
  if p >= popular then
    return "missing"
  end
  return nil
end

-- ---------------------------------------------------------------- what is shown

-- Shared by the window and the talent window, so both show the same dungeon and build.
ns.state = {
  zoneID = nil, -- dungeon shown (nil = all dungeons)
  zoneChosen = false, -- picked by hand; otherwise it follows your keystone
  compare = nil, -- { specID, zoneID, index }: build framed on the talent window
}

--- The dungeon to show for a record: the one picked by hand, else your keystone's.
function ns:ResolveZone(rec)
  if not self.state.zoneChosen then
    self.state.zoneID = rec and self:CurrentDungeon(rec) or nil
  end
  return self.state.zoneID
end

--- Pick a dungeon by hand (nil = all dungeons). A compared build belongs to one dungeon's list,
--- so it is cleared.
function ns:SetZone(zoneID)
  self.state.zoneID, self.state.zoneChosen = zoneID, true
  self.state.compare = nil
  self:Fire("STATE_CHANGED")
end

--- Frame the differences to one build on the talent window (nil = back to pick rates).
function ns:SetCompare(compare)
  self.state.compare = compare
  if compare then
    self.state.zoneID, self.state.zoneChosen = compare.zoneID, true
  end
  self:Fire("STATE_CHANGED")
end

function ns:ResetState()
  self.state.zoneID, self.state.zoneChosen, self.state.compare = nil, false, nil
  self:Fire("STATE_CHANGED")
end

--- The build being compared, if it belongs to this spec: build, index.
function ns:CompareBuild(specID, rec)
  local c = self.state.compare
  if not c or c.specID ~= specID or not rec then
    return nil
  end
  local build = ns.View(rec, c.zoneID).builds[c.index]
  return build, c.index
end

-- ---------------------------------------------------------------- build differences

local DIFF_ORDER = { add = 1, choice = 2, rank = 3, drop = 4 }

--- How a build differs from yours, node by node:
--- { { kind = "add"|"drop"|"choice"|"rank", nodeID, entryID, fromEntryID, rank, fromRank }, ... }
--- add = the build takes it and you don't, drop = you take it and the build doesn't.
--- With `skip` (a set of node IDs), those nodes are left out (the other hero tree's nodes).
function ns.BuildDiff(mine, build, skip)
  local list = {}
  local picks = build.picks or {}
  local choices = build.choices or {}
  for nodeID, rank in pairs(picks) do
    if not (skip and skip[nodeID]) then
      local myRank = mine.picks[nodeID]
      if not myRank then
        list[#list + 1] = { kind = "add", nodeID = nodeID, entryID = choices[nodeID], rank = rank }
      elseif choices[nodeID] ~= mine.choices[nodeID] then
        list[#list + 1] = { kind = "choice", nodeID = nodeID, entryID = choices[nodeID], fromEntryID = mine.choices[nodeID] }
      elseif myRank ~= rank then
        list[#list + 1] = { kind = "rank", nodeID = nodeID, rank = rank, fromRank = myRank }
      end
    end
  end
  for nodeID, myRank in pairs(mine.picks) do
    if picks[nodeID] == nil and not (skip and skip[nodeID]) then
      list[#list + 1] = { kind = "drop", nodeID = nodeID, entryID = mine.choices[nodeID], rank = myRank }
    end
  end
  table.sort(list, function(a, b)
    if a.kind ~= b.kind then
      return DIFF_ORDER[a.kind] < DIFF_ORDER[b.kind]
    end
    return a.nodeID < b.nodeID
  end)
  return list
end

--- The hero-tree nodes of your talent config: { [nodeID] = subTreeID }.
function ns.HeroNodes(configID)
  local out = {}
  if not (C_Traits and C_ClassTalents) then
    return out
  end
  configID = configID or C_ClassTalents.GetActiveConfigID()
  local config = configID and C_Traits.GetConfigInfo(configID)
  for _, treeID in ipairs(config and config.treeIDs or {}) do
    for _, nodeID in ipairs(C_Traits.GetTreeNodes(treeID) or {}) do
      local info = C_Traits.GetNodeInfo(configID, nodeID)
      if info and info.subTreeID then
        out[nodeID] = info.subTreeID
      end
    end
  end
  return out
end

--- Name and icon of a talent (its first entry, or `entryID` on a choice node) in your config.
function ns.TalentEntryInfo(configID, nodeID, entryID)
  local ok, name, icon = pcall(function()
    configID = configID or C_ClassTalents.GetActiveConfigID()
    if not entryID then
      local info = C_Traits.GetNodeInfo(configID, nodeID)
      entryID = info and info.entryIDs and info.entryIDs[1]
    end
    local entry = entryID and C_Traits.GetEntryInfo(configID, entryID)
    local def = entry and entry.definitionID and C_Traits.GetDefinitionInfo(entry.definitionID)
    if not def then
      return nil
    end
    local spellID = def.overriddenSpellID or def.spellID
    local n = (def.overrideName and def.overrideName ~= "" and def.overrideName) or (spellID and C_Spell.GetSpellName(spellID))
    local i = def.overrideIcon or (spellID and C_Spell.GetSpellTexture and C_Spell.GetSpellTexture(spellID))
    return n, i
  end)
  if ok then
    return name, icon
  end
  return nil
end

-- ---------------------------------------------------------------- stats

ns.STATS = {
  { key = "crit", label = "Critical Strike", item = "ITEM_MOD_CRIT_RATING_SHORT", rating = "CR_CRIT_MELEE", id = 9 },
  { key = "haste", label = "Haste", item = "ITEM_MOD_HASTE_RATING_SHORT", rating = "CR_HASTE_MELEE", id = 18 },
  { key = "mastery", label = "Mastery", item = "ITEM_MOD_MASTERY_RATING_SHORT", rating = "CR_MASTERY", id = 26 },
  { key = "vers", label = "Versatility", item = "ITEM_MOD_VERSATILITY", rating = "CR_VERSATILITY_DAMAGE_DONE", id = 29 },
}

local function itemStats(link)
  local get = (C_Item and C_Item.GetItemStats) or GetItemStats
  local ok, stats = pcall(get, link)
  return ok and stats or nil
end

--- Your secondary stat ratings from gear and gems, enchants not counted (as the app counts the
--- top players'): { crit, haste, mastery, vers }, or nil when they can't be read (in combat).
function ns.MyGearStats()
  if InCombatLockdown() or not ((C_Item and C_Item.GetItemStats) or GetItemStats) then
    return nil
  end
  local total = { crit = 0, haste = 0, mastery = 0, vers = 0 }
  for _, slot in ipairs(ns.SIMC_SLOTS) do
    local link = GetInventoryItemLink("player", slot[1])
    if link then
      local sources = { itemStats(link) }
      for i = 1, 4 do
        local gemID = C_Item and C_Item.GetItemGemID and C_Item.GetItemGemID(link, i)
        if gemID then
          sources[#sources + 1] = itemStats("item:" .. gemID)
        end
      end
      for _, stats in pairs(sources) do
        for _, s in ipairs(ns.STATS) do
          local v = stats[s.item] or 0
          if issecretvalue and issecretvalue(v) then
            return nil
          end
          total[s.key] = total[s.key] + v
        end
      end
    end
  end
  return total
end

--- The stat % a rating gives at your level (mastery only for your own spec), or nil.
function ns.StatPercent(key, rating, ownSpec)
  if not GetCombatRatingBonusForCombatRatingValue or not rating then
    return nil
  end
  for _, s in ipairs(ns.STATS) do
    if s.key == key then
      local ok, pct = pcall(GetCombatRatingBonusForCombatRatingValue, _G[s.rating] or s.id, rating)
      if not ok or type(pct) ~= "number" then
        return nil
      end
      if key == "mastery" then
        if not ownSpec then
          return nil
        end
        local _, coefficient = GetMasteryEffect()
        pct = pct * (coefficient or 1)
      end
      return pct
    end
  end
  return nil
end

ns:On("ACTIVE_PLAYER_SPECIALIZATION_CHANGED", function()
  ns:ResetState()
end)

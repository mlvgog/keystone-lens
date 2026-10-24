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
--- { picks = { [nodeID] = rank }, choices = { [nodeID] = entryID }, hero = subTreeID }.
--- Free (granted) nodes and the inactive hero tree are left out.
function ns.GetMyPicks(configID)
  if not (C_ClassTalents and C_Traits) then
    return nil
  end
  configID = configID or C_ClassTalents.GetActiveConfigID()
  local config = configID and C_Traits.GetConfigInfo(configID)
  if not config or not config.treeIDs then
    return nil
  end
  local picks, choices = {}, {}
  for _, treeID in ipairs(config.treeIDs) do
    for _, nodeID in ipairs(C_Traits.GetTreeNodes(treeID) or {}) do
      local info = C_Traits.GetNodeInfo(configID, nodeID)
      if info and info.ID and info.ID ~= 0 and info.type ~= NODE_SUBTREE_SELECTION and (info.ranksPurchased or 0) > 0 then
        if not info.subTreeID or info.subTreeActive then
          picks[nodeID] = info.activeRank or info.ranksPurchased
          if info.type == NODE_SELECTION and info.activeEntry then
            choices[nodeID] = info.activeEntry.entryID
          end
        end
      end
    end
  end
  local hero = C_ClassTalents.GetActiveHeroTalentSpec and C_ClassTalents.GetActiveHeroTalentSpec() or nil
  return { picks = picks, choices = choices, hero = hero }
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
function ns.NodeVerdict(stat, mine, nodeID, popular, rare)
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

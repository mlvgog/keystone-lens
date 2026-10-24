-- Keystone Lens: pick rates of the top players on Blizzard's talent window.
--
-- Every visible talent node gets its pick rate underneath ("73%", or "60/40" for a choice node).
-- A red frame marks a talent most top players take and you skip; an orange frame a talent you
-- take that few of them do. Hovering a node adds the details to its tooltip. A small bar in the
-- window's title row picks the dungeon (it starts on the dungeon of your keystone).
local _, ns = ...

local NODE_SUBTREE_SELECTION = 3 -- Enum.TraitNodeType.SubTreeSelection

local overlays = setmetatable({}, { __mode = "k" }) -- talent button -> our overlay frame
local hooked = setmetatable({}, { __mode = "k" }) -- talent buttons whose tooltip we extend
local state = { zoneID = nil, chosen = false } -- dungeon shown; chosen = picked by hand
local bar -- the bar in the talent window's title row
local hookedFrame -- the talent frame we hooked (nothing is written into Blizzard's frames)

local function talentsFrame()
  return PlayerSpellsFrame and PlayerSpellsFrame.TalentsFrame
end

--- The text under a node: "73%", or "60/40" for a choice node (in the node's entry order).
function ns.NodeText(stat, entryIDs)
  if stat and stat.e and entryIDs and #entryIDs >= 2 then
    local a = math.floor((stat.e[entryIDs[1]] or 0) * 100 + 0.5)
    local b = math.floor((stat.e[entryIDs[2]] or 0) * 100 + 0.5)
    return a .. "/" .. b
  end
  return ns.Pct(stat and stat.p or 0)
end

local function textColor(p)
  if p >= 0.75 then
    return 1, 0.82, 0
  elseif p >= 0.25 then
    return 1, 1, 1
  end
  return 0.6, 0.6, 0.6
end

local function overlayFor(button)
  local o = overlays[button]
  if o then
    return o
  end
  o = CreateFrame("Frame", nil, button, "BackdropTemplate")
  o:SetPoint("TOPLEFT", button, "TOPLEFT", -2, 2)
  o:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT", 2, -2)
  o:SetFrameLevel(button:GetFrameLevel() + 10)
  o:EnableMouse(false)
  o:SetBackdrop({ edgeFile = "Interface\\Buttons\\WHITE8X8", edgeSize = 2 })
  o.text = o:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  local font, size = o.text:GetFont()
  if font then
    o.text:SetFont(font, size or 10, "OUTLINE")
  end
  o.text:SetPoint("TOP", o, "BOTTOM", 0, 1)
  overlays[button] = o
  return o
end

local function entryName(configID, entryID)
  local ok, name = pcall(function()
    local entry = C_Traits.GetEntryInfo(configID, entryID)
    local def = entry and entry.definitionID and C_Traits.GetDefinitionInfo(entry.definitionID)
    if not def then
      return nil
    end
    if def.overrideName and def.overrideName ~= "" then
      return def.overrideName
    end
    return def.spellID and C_Spell and C_Spell.GetSpellName and C_Spell.GetSpellName(def.spellID)
  end)
  return ok and name or nil
end

local function addTooltip(button)
  local o = overlays[button]
  if not o or not o:IsShown() or not o.view or GameTooltip:GetOwner() ~= button then
    return
  end
  local rec, view, stat, info = o.rec, o.view, o.stat, o.info
  GameTooltip:AddLine(" ")
  local where = view.zoneID and (ns.DungeonName(rec, view.zoneID) or "one dungeon") or "all dungeons"
  GameTooltip:AddLine(string.format("Keystone Lens · top %d %s %ss · %s", view.sample, rec.spec or "", rec.class or "", where), 1, 0.82, 0, true)
  if stat and stat.e and info and info.entryIDs and #info.entryIDs >= 2 then
    local configID = talentsFrame() and talentsFrame():GetConfigID()
    for i = 1, 2 do
      local id = info.entryIDs[i]
      GameTooltip:AddDoubleLine(entryName(configID, id) or (i == 1 and "Left" or "Right"), ns.Pct(stat.e[id] or 0), 1, 1, 1, 1, 1, 1)
    end
  else
    GameTooltip:AddLine("Picked by " .. ns.Pct(stat and stat.p or 0), 1, 1, 1)
  end
  if stat and stat.r and info and (info.maxRanks or 1) > 1 then
    GameTooltip:AddLine(string.format("Most common rank: %d/%d", stat.r, info.maxRanks), 1, 1, 1)
  end
  if o.verdict == "missing" then
    GameTooltip:AddLine("Most top players take this and you don't.", 1, 0.35, 0.25, true)
  elseif o.verdict == "rare" then
    GameTooltip:AddLine("Few top players take this.", 1, 0.6, 0.1, true)
  end
  GameTooltip:Show()
end

local function hookTooltip(button)
  if hooked[button] or not button.SetTooltipInternal then
    return
  end
  hooked[button] = true
  hooksecurefunc(button, "SetTooltipInternal", function(b)
    ns.SafeCall(addTooltip, b)
  end)
end

local function decorate(button, rec, view, mine)
  local nodeID = button.GetNodeID and button:GetNodeID()
  local info = button.GetNodeInfo and button:GetNodeInfo()
  local visible = button.ShouldBeVisible == nil or button:ShouldBeVisible()
  if not view or not nodeID or not visible or (info and info.type == NODE_SUBTREE_SELECTION) then
    if overlays[button] then
      overlays[button]:Hide()
    end
    return
  end
  local o = overlayFor(button)
  local stat = view.talents[nodeID]
  o.text:SetText(ns.NodeText(stat, info and info.entryIDs))
  o.text:SetTextColor(textColor(stat and stat.p or 0))
  o.verdict = mine and ns.NodeVerdict(stat, mine, nodeID, ns:Setting("popular"), ns:Setting("rare")) or nil
  if o.verdict == "missing" then
    o:SetBackdropBorderColor(1, 0.2, 0.1, 0.95)
  elseif o.verdict == "rare" then
    o:SetBackdropBorderColor(1, 0.55, 0, 0.95)
  else
    o:SetBackdropBorderColor(0, 0, 0, 0)
  end
  o.rec, o.view, o.stat, o.info = rec, view, stat, info
  o:Show()
  hookTooltip(button)
end

local function hideAll()
  for _, o in pairs(overlays) do
    o:Hide()
  end
end

local function currentRecord(frame)
  if frame.IsInspecting and frame:IsInspecting() then
    return nil -- someone else's talents
  end
  local specID = ns.PlayerSpecID()
  return specID and ns:GetSpecData(specID) or nil, specID
end

local function updateBar(rec, specID)
  if not bar then
    return
  end
  if not ns:Setting("overlay") then
    bar.info = "Pick rates are off."
    bar.dungeon:Hide()
  elseif not rec then
    local name = specID and select(2, GetSpecializationInfoByID(specID)) or nil
    bar.info = "No data for " .. (name or "this spec") .. " yet. Look at it in the Keystone Lens app, then /reload."
    bar.dungeon:Hide()
  else
    local where = state.zoneID and ns.DungeonName(rec, state.zoneID) or "All dungeons"
    bar.dungeon:SetText(where)
    bar.dungeon:SetShown(#ns.LoadedDungeons(rec) > 0)
    local region = rec.region == "world" and "World" or string.upper(rec.region or "")
    bar.info = string.format("Top %d %s %ss · %s · %s", ns.View(rec, state.zoneID).sample, rec.spec or "", rec.class or "", region, ns.Ago(rec.time))
  end
  bar.title:SetTextColor(rec and ns:Setting("overlay") and 1 or 0.6, rec and ns:Setting("overlay") and 0.82 or 0.6, rec and ns:Setting("overlay") and 0 or 0.6)
  bar.toggle:SetChecked(ns:Setting("overlay"))
end

function ns:RefreshTalents()
  local frame = talentsFrame()
  if not frame or not frame:IsShown() then
    return
  end
  local rec, specID = currentRecord(frame)
  if not self:Setting("overlay") or not rec then
    hideAll()
    updateBar(rec, specID)
    return
  end
  if not state.chosen then
    state.zoneID = self:CurrentDungeon(rec)
  end
  local view = ns.View(rec, state.zoneID)
  local mine = ns.GetMyPicks(frame.GetConfigID and frame:GetConfigID() or nil)
  for button in frame:EnumerateAllTalentButtons() do
    ns.SafeCall(decorate, button, rec, view, mine)
  end
  updateBar(rec, specID)
end

local queued = false
local function refreshSoon()
  if queued then
    return
  end
  queued = true
  C_Timer.After(0.05, function()
    queued = false
    ns:RefreshTalents()
  end)
end
ns.RefreshTalentsSoon = refreshSoon

--- Next (or previous) dungeon on the bar: All dungeons, then each dungeon with data.
local function cycleDungeon(step)
  local frame = talentsFrame()
  local rec = frame and currentRecord(frame)
  if not rec then
    return
  end
  local list = ns.LoadedDungeons(rec)
  local index = 0
  for i, d in ipairs(list) do
    if d.id == state.zoneID then
      index = i
    end
  end
  index = (index + step) % (#list + 1)
  state.zoneID = index > 0 and list[index].id or nil
  state.chosen = true
  ns:RefreshTalents()
end

-- The bar sits in the title row of the talent window, left of its close and maximize buttons,
-- so it stays on screen and clear of the centred title.
local function createBar(frame)
  bar = CreateFrame("Frame", nil, frame)
  bar:SetSize(310, 22)
  bar:SetPoint("TOPRIGHT", PlayerSpellsFrame, "TOPRIGHT", -64, -1)

  bar.label = CreateFrame("Button", nil, bar)
  bar.label:SetSize(96, 22)
  bar.title = bar.label:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  bar.title:SetPoint("RIGHT", bar.label, "RIGHT", 0, 0)
  bar.title:SetText("Keystone Lens")
  bar.label:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:AddLine("Keystone Lens")
    GameTooltip:AddLine(bar.info or "", 1, 1, 1, true)
    GameTooltip:Show()
  end)
  bar.label:SetScript("OnLeave", GameTooltip_Hide)

  bar.toggle = CreateFrame("CheckButton", nil, bar, "UICheckButtonTemplate")
  bar.toggle:SetSize(22, 22)
  bar.toggle:SetScript("OnClick", function(self)
    ns:SetSetting("overlay", self:GetChecked() and true or false)
  end)
  bar.toggle:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:AddLine("Show the top players' pick rates")
    GameTooltip:AddLine(bar.info or "", 1, 1, 1, true)
    GameTooltip:Show()
  end)
  bar.toggle:SetScript("OnLeave", GameTooltip_Hide)

  bar.dungeon = CreateFrame("Button", nil, bar, "UIPanelButtonTemplate")
  bar.dungeon:SetSize(170, 20)
  bar.dungeon:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  bar.dungeon:SetScript("OnClick", function(_, mouse)
    cycleDungeon(mouse == "RightButton" and -1 or 1)
  end)
  bar.dungeon:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    GameTooltip:AddLine("Dungeon")
    GameTooltip:AddLine("Click for the next dungeon, right-click for the previous one.", 1, 1, 1, true)
    GameTooltip:AddLine(bar.info or "", 0.8, 0.8, 0.8, true)
    GameTooltip:Show()
  end)
  bar.dungeon:SetScript("OnLeave", GameTooltip_Hide)

  -- Right to left: dungeon button, checkbox, label.
  bar.dungeon:SetPoint("RIGHT", bar, "RIGHT", 0, 0)
  bar.toggle:SetPoint("RIGHT", bar.dungeon, "LEFT", -4, 0)
  bar.label:SetPoint("RIGHT", bar.toggle, "LEFT", -2, 0)
end

local function setup()
  local frame = talentsFrame()
  if not frame or hookedFrame == frame then
    return
  end
  hookedFrame = frame
  createBar(frame)
  frame:HookScript("OnShow", function()
    if not state.chosen then
      state.zoneID = nil
    end
    refreshSoon()
  end)
  if frame.UpdateTreeInfo then
    hooksecurefunc(frame, "UpdateTreeInfo", refreshSoon)
  end
  refreshSoon()
end

if EventUtil and EventUtil.ContinueOnAddOnLoaded then
  EventUtil.ContinueOnAddOnLoaded("Blizzard_PlayerSpells", setup)
else
  ns:On("ADDON_LOADED", function(_, name)
    if name == "Blizzard_PlayerSpells" then
      setup()
    end
  end)
end

ns:On("TRAIT_CONFIG_UPDATED", refreshSoon)
ns:On("ACTIVE_PLAYER_SPECIALIZATION_CHANGED", function()
  state.zoneID, state.chosen = nil, false
  refreshSoon()
end)
ns:Listen("SETTING_CHANGED", refreshSoon)

-- Keystone Lens: the side pane with the popular builds. Each build is a card; selecting one lists
-- the talents it changes compared with yours, with buttons to copy its string or show the
-- changes on the talent window.
local _, ns = ...

local WIDTH = 280
local CARD_WIDTH = 236
local LINE = 18
local MAX_DIFF_LINES = 14
local TICK = "|TInterface\\RaidFrame\\ReadyCheck-Ready:12|t "

local pane
local selected = {} -- [specID .. ":" .. zone] = selected build index

local function selectionKey(specID)
  return tostring(specID) .. ":" .. tostring(ns.state.zoneID or "all")
end

local function talentText(entry, configID)
  local name, icon = ns.TalentEntryInfo(configID, entry.nodeID, entry.entryID)
  local label = (icon and ("|T" .. icon .. ":14|t ") or "") .. (name or ("Talent " .. entry.nodeID))
  if entry.kind == "add" then
    return "|cff40ff40+|r " .. label .. ((entry.rank or 1) > 1 and (" (rank " .. entry.rank .. ")") or "")
  elseif entry.kind == "drop" then
    return "|cffff4040-|r " .. label
  elseif entry.kind == "choice" then
    local from = ns.TalentEntryInfo(configID, entry.nodeID, entry.fromEntryID)
    return "|cffffd100~|r " .. label .. (from and ("  |cff999999instead of " .. from .. "|r") or "")
  end
  return "|cffffd100~|r " .. label .. string.format("  |cff999999rank %d instead of %d|r", entry.rank or 0, entry.fromRank or 0)
end

--- What a card shows when it is selected: lines of text (talent changes, hero tree).
function ns.BuildDetailLines(build, mine, rec, configID, heroNodes)
  local lines = {}
  if not mine then
    return lines
  end
  local skip
  if build.hero and mine.hero and build.hero ~= mine.hero then
    lines[#lines + 1] = string.format("Hero talents: |cffffd100%s|r (yours: %s)", ns.HeroName(rec, build.hero) or "?", ns.HeroName(rec, mine.hero) or "?")
    skip = heroNodes
  end
  local diff = ns.BuildDiff(mine, build, skip)
  if #diff == 0 and #lines == 0 then
    lines[#lines + 1] = "|cff40ff40This is your build.|r"
  end
  for i, entry in ipairs(diff) do
    if i > MAX_DIFF_LINES then
      lines[#lines + 1] = string.format("|cff999999and %d more|r", #diff - MAX_DIFF_LINES)
      break
    end
    lines[#lines + 1] = talentText(entry, configID)
  end
  return lines, diff
end

-- ---------------------------------------------------------------- cards

local function createCard(parent)
  local card = CreateFrame("Button", nil, parent, "BackdropTemplate")
  card:SetWidth(CARD_WIDTH)
  card:SetBackdrop({
    bgFile = "Interface\\Buttons\\WHITE8X8",
    edgeFile = "Interface\\Buttons\\WHITE8X8",
    edgeSize = 1,
  })
  card.title = card:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  card.title:SetPoint("TOPLEFT", 8, -7)
  card.title:SetPoint("RIGHT", card, "RIGHT", -8, 0)
  card.title:SetJustifyH("LEFT")
  card.sub = card:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  card.sub:SetPoint("TOPLEFT", card.title, "BOTTOMLEFT", 0, -3)
  card.sub:SetPoint("RIGHT", card, "RIGHT", -8, 0)
  card.sub:SetJustifyH("LEFT")
  card.lines = {}
  card.copy = CreateFrame("Button", nil, card, "UIPanelButtonTemplate")
  card.copy:SetSize(104, 20)
  card.copy:SetText("Copy string")
  card.show = CreateFrame("Button", nil, card, "UIPanelButtonTemplate")
  card.show:SetSize(104, 20)
  card:SetScript("OnClick", function(self)
    selected[selectionKey(pane.specID)] = (selected[selectionKey(pane.specID)] == self.index) and 0 or self.index
    ns:RenderBuilds()
  end)
  return card
end

local function cardLine(card, i)
  local fs = card.lines[i]
  if not fs then
    fs = card:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    fs:SetJustifyH("LEFT")
    fs:SetPoint("LEFT", card, "LEFT", 12, 0)
    fs:SetPoint("RIGHT", card, "RIGHT", -8, 0)
    card.lines[i] = fs
  end
  return fs
end

local function fillCard(card, i, build, ctx)
  card.index = i
  local hero = build.hero and ns.HeroName(ctx.rec, build.hero)
  card.title:SetText((i == ctx.closest and TICK or "") .. "Build " .. i .. (hero and (" · " .. hero) or ""))
  local sub = string.format("%d players · %s", build.n or 0, ns.Pct(build.p or 0))
  if ctx.mine then
    local d = ns.BuildDistance(ctx.mine, build)
    sub = sub .. (d == 0 and " · |cff40ff40your build|r" or string.format(" · %d talent%s differ", d, d == 1 and "" or "s"))
  end
  card.sub:SetText(sub)

  local open = ctx.selected == i
  local comparing = ns.state.compare and ns.state.compare.specID == ctx.specID and ns.state.compare.index == i and ns.state.compare.zoneID == ctx.zoneID
  card:SetBackdropColor(open and 0.18 or 0.08, open and 0.15 or 0.08, open and 0.08 or 0.1, 0.9)
  if comparing then
    card:SetBackdropBorderColor(0.25, 1, 0.25, 0.9)
  else
    card:SetBackdropBorderColor(open and 0.9 or 0.35, open and 0.7 or 0.3, open and 0.3 or 0.25, 0.9)
  end

  for _, fs in ipairs(card.lines) do
    fs:Hide()
  end
  local height = 44
  card.copy:SetShown(open and build.str ~= nil)
  card.show:SetShown(open and ctx.mine ~= nil)
  if open then
    local lines = ns.BuildDetailLines(build, ctx.mine, ctx.rec, ctx.configID, ctx.heroNodes)
    for n, text in ipairs(lines) do
      local fs = cardLine(card, n)
      fs:SetPoint("TOP", card, "TOP", 0, -height)
      fs:SetText(text)
      fs:Show()
      height = height + LINE
    end
    card.copy:ClearAllPoints()
    card.copy:SetPoint("TOPLEFT", card, "TOPLEFT", 8, -height - 4)
    card.copy:SetScript("OnClick", function()
      ns.ShowCopyBox(build.str, string.format("Build %d%s: talent loadout string", i, hero and (" · " .. hero) or ""))
    end)
    card.show:ClearAllPoints()
    card.show:SetPoint("LEFT", card.copy, "RIGHT", 8, 0)
    card.show:SetText(comparing and "Stop showing" or "Show on talents")
    card.show:SetScript("OnClick", function()
      if comparing then
        ns:SetCompare(nil)
        return
      end
      ns:SetCompare({ specID = ctx.specID, zoneID = ctx.zoneID, index = i })
      if not ns.OpenTalents() then
        ns.Print("open your talent window (N) to see what to change for Build " .. i .. ".")
      end
    end)
    height = height + 32
  end
  card:SetHeight(height)
  card:Show()
  return height
end

-- ---------------------------------------------------------------- pane

local function createPane(panel)
  pane = CreateFrame("Frame", "KeystoneLensBuildsFrame", panel, "ButtonFrameTemplate")
  pane:SetSize(WIDTH, panel:GetHeight())
  pane:SetPoint("TOPLEFT", panel, "TOPRIGHT", -2, 0)
  if ButtonFrameTemplate_HidePortrait then
    ButtonFrameTemplate_HidePortrait(pane)
  end
  if pane.SetTitle then
    pane:SetTitle("Popular builds")
  end
  local inset = pane.Inset
  if inset then
    inset:ClearAllPoints()
    inset:SetPoint("TOPLEFT", pane, "TOPLEFT", 4, -50)
    inset:SetPoint("BOTTOMRIGHT", pane, "BOTTOMRIGHT", -6, 6)
  end

  pane.where = pane:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  pane.where:SetPoint("TOPLEFT", pane, "TOPLEFT", 12, -30)
  pane.where:SetPoint("RIGHT", pane, "RIGHT", -12, 0)
  pane.where:SetJustifyH("LEFT")

  local scroll = CreateFrame("ScrollFrame", nil, inset or pane, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", 6, -6)
  scroll:SetPoint("BOTTOMRIGHT", -26, 6)
  pane.content = CreateFrame("Frame", nil, scroll)
  pane.content:SetSize(CARD_WIDTH, 1)
  scroll:SetScrollChild(pane.content)
  pane.cards = {}

  pane.empty = pane.content:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  pane.empty:SetPoint("TOPLEFT", 4, -4)
  pane.empty:SetWidth(CARD_WIDTH - 8)
  pane.empty:SetJustifyH("LEFT")

  -- Closing the pane by hand is remembered; closing the window doesn't count.
  pane:SetScript("OnHide", function()
    if ns.db and panel:IsShown() then
      ns.db.settings.buildsHidden = true
    end
  end)
  pane:SetScript("OnShow", function()
    if ns.db then
      ns.db.settings.buildsHidden = false
    end
    ns:RenderBuilds()
  end)
  return pane
end

--- Create the pane next to the window (shown unless you closed it last time).
function ns.CreateBuildPane(panel)
  createPane(panel)
  if ns.db and ns.db.settings.buildsHidden then
    pane:Hide()
  end
  return pane
end

function ns:ToggleBuildPane(show)
  if not pane then
    return
  end
  if show == nil then
    show = not pane:IsShown()
  end
  pane:SetShown(show)
end

--- Fill the pane for the spec and dungeon the window shows.
function ns:RenderBuilds(specID, rec)
  if not pane then
    return
  end
  if specID ~= nil or rec ~= nil then
    pane.specID, pane.rec = specID, rec
  end
  specID, rec = pane.specID, pane.rec
  if not pane:IsShown() then
    return
  end
  for _, card in ipairs(pane.cards) do
    card:Hide()
  end
  if not rec then
    pane.where:SetText("")
    pane.empty:SetText("No data for this spec yet.")
    pane.empty:Show()
    pane.content:SetHeight(40)
    return
  end
  local v = ns.View(rec, ns.state.zoneID)
  pane.where:SetText(string.format("%s · top %d", v.zoneID and ns.DungeonName(rec, v.zoneID) or "All dungeons", v.sample or 0))
  local ownSpec = specID == ns.PlayerSpecID()
  local mine = ownSpec and ns.GetMyPicks() or nil
  if mine and not next(mine.picks) then
    mine = nil
  end
  local ctx = {
    rec = rec,
    specID = specID,
    zoneID = v.zoneID,
    mine = mine,
    configID = ownSpec and C_ClassTalents and C_ClassTalents.GetActiveConfigID() or nil,
    heroNodes = mine and ns.HeroNodes() or nil,
  }
  if mine then
    ctx.closest = ns.ClosestBuild(v.builds, mine)
  end
  local key = selectionKey(specID)
  if selected[key] == nil then
    selected[key] = ctx.closest or 1 -- open the build closest to yours
  end
  ctx.selected = selected[key]

  pane.empty:SetShown(#v.builds == 0)
  pane.empty:SetText("No build is shared by two or more of these players.")
  local y = 0
  for i, build in ipairs(v.builds) do
    local card = pane.cards[i] or createCard(pane.content)
    pane.cards[i] = card
    card:ClearAllPoints()
    card:SetPoint("TOPLEFT", pane.content, "TOPLEFT", 0, -y)
    y = y + fillCard(card, i, build, ctx) + 6
  end
  pane.content:SetHeight(math.max(1, y))
end

ns:Listen("SHOW_BUILDS", function()
  ns:ToggleBuildPane(true)
end)

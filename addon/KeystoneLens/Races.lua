-- Keystone Lens: the races the top players of a spec pick (a strip at the bottom of the Overview)
-- and a flyout with a race's racial abilities for the spec's class.
local _, ns = ...

local ICON = 28
local SHOWN = 5 -- race buttons in the strip; the rest are listed in the "+N" tooltip
local FLYOUT_WIDTH = 270
local ROW = 22
local TICK = "Interface\\RaidFrame\\ReadyCheck-Ready"
local QUESTION = "Interface\\Icons\\INV_Misc_QuestionMark"

local FACTION = { alliance = "Alliance", horde = "Horde", both = "Alliance or Horde" }
local FACTION_COLOR = { alliance = "ff80b3ff", horde = "ffff806e", both = "ffe8e2cf" }

local function colored(r)
  return string.format("|c%s%s|r", FACTION_COLOR[r.faction] or "ffffffff", r.name)
end

local function spellTexture(id)
  return C_Spell and C_Spell.GetSpellTexture and C_Spell.GetSpellTexture(id) or nil
end

--- The game's portrait atlas of a race, when the game has one (e.g. "raceicon128-nightelf-male").
local function raceAtlas(clientFile)
  if not (clientFile and C_Texture and C_Texture.GetAtlasInfo) then
    return nil
  end
  local gender = UnitSex and UnitSex("player") == 3 and "female" or "male"
  for _, fmt in ipairs({ "raceicon128-%s-%s", "raceicon-%s-%s" }) do
    local name = string.format(fmt, string.lower(clientFile), gender)
    if C_Texture.GetAtlasInfo(name) then
      return name
    end
  end
  return nil
end

local function isMine(r, raceID)
  for _, id in ipairs(r.ids or { r.id }) do
    if id == raceID then
      return true
    end
  end
  return false
end

--- Races of a spec record, most played first: { key, id, name (in the game's language), n, share,
--- faction, atlas, icon, mine, spells }. Empty for data written before the app had races.
function ns.RaceRows(rec)
  local rows = {}
  if not rec or type(rec.races) ~= "table" then
    return rows
  end
  local sample = math.max(1, rec.sample or 0)
  local _, _, myRace = UnitRace("player")
  for _, r in ipairs(rec.races) do
    local info = C_CreatureInfo and C_CreatureInfo.GetRaceInfo and r.id and C_CreatureInfo.GetRaceInfo(r.id)
    local spells = type(r.spells) == "table" and r.spells or {}
    rows[#rows + 1] = {
      key = r.key,
      id = r.id,
      name = info and info.raceName or r.name or "?",
      n = r.n or 0,
      share = (r.n or 0) / sample,
      faction = r.faction,
      atlas = raceAtlas(info and info.clientFileString),
      icon = spells[1] and spellTexture(spells[1].id) or QUESTION,
      mine = myRace ~= nil and isMine(r, myRace),
      spells = spells,
    }
  end
  return rows
end

--- A race's racial abilities: { id, name (in the game's language), icon, passive }.
function ns.RacialRows(race)
  local out = {}
  for _, s in ipairs(race and race.spells or {}) do
    local info = C_Spell and C_Spell.GetSpellInfo and C_Spell.GetSpellInfo(s.id)
    local passive = C_Spell and C_Spell.IsSpellPassive and C_Spell.IsSpellPassive(s.id)
    out[#out + 1] = {
      id = s.id,
      name = info and info.name or s.name or ("Spell " .. s.id),
      icon = info and info.iconID or spellTexture(s.id) or QUESTION,
      passive = passive == true,
    }
  end
  return out
end

-- ---------------------------------------------------------------- racials flyout

local flyout

local function flyoutRow(i)
  local row = flyout.rows[i]
  if row then
    return row
  end
  row = CreateFrame("Button", nil, flyout)
  row:SetHeight(ROW)
  row:SetPoint("LEFT", flyout, "LEFT", 10, 0)
  row:SetPoint("RIGHT", flyout, "RIGHT", -10, 0)
  row.icon = row:CreateTexture(nil, "ARTWORK")
  row.icon:SetSize(18, 18)
  row.icon:SetPoint("LEFT", 0, 0)
  row.text = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  row.text:SetJustifyH("LEFT")
  row.text:SetPoint("LEFT", row.icon, "RIGHT", 6, 0)
  row.right = row:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  row.right:SetPoint("RIGHT", 0, 0)
  row.text:SetPoint("RIGHT", row.right, "LEFT", -4, 0)
  row:SetScript("OnEnter", function(self)
    if self.spellID then
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:SetSpellByID(self.spellID)
      GameTooltip:Show()
    end
  end)
  row:SetScript("OnLeave", GameTooltip_Hide)
  flyout.rows[i] = row
  return row
end

local function createFlyout(parent)
  flyout = CreateFrame("Frame", nil, parent, "BackdropTemplate")
  flyout:SetWidth(FLYOUT_WIDTH)
  flyout:SetFrameStrata("DIALOG")
  flyout:EnableMouse(true)
  flyout:SetBackdrop({
    bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    tile = true, tileSize = 16, edgeSize = 16,
    insets = { left = 4, right = 4, top = 4, bottom = 4 },
  })
  flyout:SetBackdropColor(0.04, 0.04, 0.06, 0.97)
  flyout:SetBackdropBorderColor(0.8, 0.65, 0.3, 1)
  flyout.title = flyout:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  flyout.title:SetPoint("TOPLEFT", 10, -10)
  flyout.faction = flyout:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  flyout.faction:SetPoint("TOPRIGHT", -10, -11)
  flyout.rows = {}
  flyout:Hide()
end

--- Fill the flyout with a race's racials; returns the lines shown.
function ns.FillRacials(race)
  local lines = ns.RacialRows(race)
  flyout.title:SetText(colored(race))
  flyout.faction:SetText(FACTION[race.faction] or "")
  for _, row in ipairs(flyout.rows) do
    row:Hide()
  end
  local y = -30
  for i, l in ipairs(lines) do
    local row = flyoutRow(i)
    row:SetPoint("TOP", flyout, "TOP", 0, y)
    row.spellID = l.id
    row.icon:Show()
    row.icon:SetTexture(l.icon)
    row.text:SetText(l.name)
    row.right:SetText(l.passive and "Passive" or "")
    row:Show()
    y = y - ROW
  end
  if #lines == 0 then
    local row = flyoutRow(1)
    row:SetPoint("TOP", flyout, "TOP", 0, y)
    row.spellID = nil
    row.icon:Hide()
    row.text:SetText("Look at this spec again in the app to see racials.")
    row.right:SetText("")
    row:Show()
    y = y - ROW
  end
  flyout:SetHeight(-y + 10)
  return lines
end

function ns.ToggleRacials(button)
  if not flyout or not button.race then
    return
  end
  if flyout:IsShown() and flyout.owner == button then
    flyout:Hide()
    return
  end
  ns.FillRacials(button.race)
  flyout.owner = button
  flyout:ClearAllPoints()
  flyout:SetPoint("BOTTOMLEFT", button, "TOPLEFT", 0, 6)
  flyout:Show()
end

function ns.HideRacials()
  if flyout then
    flyout:Hide()
  end
end

-- A click anywhere else closes the flyout.
ns:On("GLOBAL_MOUSE_DOWN", function()
  if flyout and flyout:IsShown() and not flyout:IsMouseOver() and not (flyout.owner and flyout.owner:IsMouseOver()) then
    flyout:Hide()
  end
end)

-- ---------------------------------------------------------------- the strip

local function raceTooltip(self)
  local r = self.race
  if not r then
    return
  end
  GameTooltip:SetOwner(self, "ANCHOR_TOP")
  GameTooltip:AddLine(colored(r))
  GameTooltip:AddLine(string.format("%d of the top %d (%s)", r.n, self:GetParent().sample or 0, ns.Pct(r.share)), 1, 1, 1)
  GameTooltip:AddLine(FACTION[r.faction] or "", 0.7, 0.7, 0.7)
  if r.mine then
    GameTooltip:AddLine("Your race", 0.25, 1, 0.25)
  end
  GameTooltip:AddLine("Click for its racial abilities.", 0.6, 0.6, 0.6)
  GameTooltip:Show()
end

local function moreTooltip(self)
  local strip = self:GetParent()
  GameTooltip:SetOwner(self, "ANCHOR_TOP")
  GameTooltip:AddLine("More races")
  for i = SHOWN + 1, #(strip.rows or {}) do
    local r = strip.rows[i]
    GameTooltip:AddDoubleLine(colored(r), ns.Pct(r.share), 1, 1, 1, 1, 1, 1)
  end
  GameTooltip:Show()
end

--- The "Popular races" strip for the Overview.
function ns.CreateRaceStrip(parent)
  local strip = CreateFrame("Frame", nil, parent)
  strip:SetHeight(ICON + 4)
  strip.title = strip:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  strip.title:SetPoint("LEFT", 0, 0)
  strip.title:SetText("Popular races")
  strip.empty = strip:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  strip.empty:SetPoint("LEFT", strip.title, "RIGHT", 12, 0)
  strip.empty:SetText("Look at this spec again in the app to see the races.")
  strip.buttons = {}
  for i = 1, SHOWN do
    local b = CreateFrame("Button", nil, strip)
    b:SetSize(ICON, ICON)
    if i == 1 then
      b:SetPoint("LEFT", strip.title, "RIGHT", 12, 0)
    else
      b:SetPoint("LEFT", strip.buttons[i - 1].pct, "RIGHT", 14, 0)
    end
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetAllPoints()
    b.tick = b:CreateTexture(nil, "OVERLAY")
    b.tick:SetSize(14, 14)
    b.tick:SetPoint("BOTTOMRIGHT", 4, -4)
    b.tick:SetTexture(TICK)
    b:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
    b.pct = strip:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    b.pct:SetPoint("LEFT", b, "RIGHT", 5, 0)
    b:SetScript("OnEnter", raceTooltip)
    b:SetScript("OnLeave", GameTooltip_Hide)
    b:SetScript("OnClick", ns.ToggleRacials)
    strip.buttons[i] = b
  end
  strip.more = CreateFrame("Button", nil, strip)
  strip.more:SetSize(36, ICON)
  strip.more:SetPoint("LEFT", strip.buttons[SHOWN].pct, "RIGHT", 10, 0)
  strip.more.text = strip.more:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  strip.more.text:SetPoint("LEFT", 0, 0)
  strip.more:SetScript("OnEnter", moreTooltip)
  strip.more:SetScript("OnLeave", GameTooltip_Hide)
  createFlyout(parent)
  return strip
end

--- Fill the strip for a spec record.
function ns.RenderRaces(strip, rec)
  ns.HideRacials()
  local rows = ns.RaceRows(rec)
  strip.rows = rows
  strip.sample = rec and rec.sample or 0
  strip.empty:SetShown(#rows == 0)
  for i, b in ipairs(strip.buttons) do
    local r = rows[i]
    b.race = r
    b:SetShown(r ~= nil)
    b.pct:SetShown(r ~= nil)
    if r then
      if r.atlas then
        b.icon:SetAtlas(r.atlas)
      else
        b.icon:SetTexture(r.icon)
      end
      b.pct:SetText(ns.Pct(r.share))
      b.tick:SetShown(r.mine)
    end
  end
  local rest = #rows - SHOWN
  strip.more:SetShown(rest > 0)
  strip.more.text:SetText(rest > 0 and ("+" .. rest) or "")
  return rows
end

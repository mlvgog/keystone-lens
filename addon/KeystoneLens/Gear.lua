-- Keystone Lens: the Overview tab's character pane: the top players' gear slot by slot, a flyout
-- with every option per slot, and their secondary stats next to yours.
local _, ns = ...

local SLOT = 37 -- slot button size
local GAP = 7
local TICK = "Interface\\RaidFrame\\ReadyCheck-Ready"
local EMPTY = "Interface\\PaperDoll\\UI-Backpack-EmptySlot"

-- { data group, label, inventory slots that count as "yours", empty-slot art, nth item of the group }
local LEFT = {
  { "head", "Head", { 1 }, "HEADSLOT" },
  { "neck", "Neck", { 2 }, "NECKSLOT" },
  { "shoulder", "Shoulder", { 3 }, "SHOULDERSLOT" },
  { "back", "Back", { 15 }, "BACKSLOT" },
  { "chest", "Chest", { 5 }, "CHESTSLOT" },
  { "wrist", "Wrist", { 9 }, "WRISTSLOT" },
  { "gems", "Gems" },
  { "embellishments", "Embellished" },
}
local RIGHT = {
  { "hands", "Hands", { 10 }, "HANDSSLOT" },
  { "waist", "Waist", { 6 }, "WAISTSLOT" },
  { "legs", "Legs", { 7 }, "LEGSSLOT" },
  { "feet", "Feet", { 8 }, "FEETSLOT" },
  { "rings", "Ring", { 11, 12 }, "FINGER0SLOT", 1 },
  { "rings", "Ring", { 11, 12 }, "FINGER1SLOT", 2 },
  { "trinkets", "Trinket", { 13, 14 }, "TRINKET0SLOT", 1 },
  { "trinkets", "Trinket", { 13, 14 }, "TRINKET1SLOT", 2 },
}
local BOTTOM = {
  { "mainhand", "Main Hand", { 16 }, "MAINHANDSLOT" },
  { "offhand", "Off Hand", { 17 }, "SECONDARYHANDSLOT" },
}
ns.GEAR_LAYOUT = { left = LEFT, right = RIGHT, bottom = BOTTOM }

local function number(n)
  n = math.floor((n or 0) + 0.5)
  return BreakUpLargeNumbers and BreakUpLargeNumbers(n) or tostring(n)
end

local function emptyArt(slotName)
  if slotName and GetInventorySlotInfo then
    local ok, _, texture = pcall(GetInventorySlotInfo, slotName)
    if ok and texture then
      return texture
    end
  end
  return EMPTY
end

local function itemIcon(itemID)
  return C_Item and C_Item.GetItemIconByID and C_Item.GetItemIconByID(itemID) or nil
end

local function itemQuality(itemID)
  return C_Item and C_Item.GetItemQualityByID and C_Item.GetItemQualityByID(itemID) or nil
end

local function itemName(itemID, fallback)
  local name = C_Item and C_Item.GetItemNameByID and C_Item.GetItemNameByID(itemID)
  if not name and C_Item and C_Item.RequestLoadItemDataByID then
    C_Item.RequestLoadItemDataByID(itemID)
  end
  return name or fallback or ("Item " .. itemID)
end

local function qualityColor(quality)
  if quality and C_Item and C_Item.GetItemQualityColor then
    local r, g, b = C_Item.GetItemQualityColor(quality)
    if r then
      return r, g, b
    end
  end
  return 1, 1, 1
end

-- ---------------------------------------------------------------- your gear

--- What you wear: { items = { [itemID] = true }, enchants = { [group] = { [enchantID] = true } },
--- gems = { [gemID] = true } }.
function ns.MyGear()
  local mine = { items = {}, enchants = {}, gems = {} }
  local groupOf = {}
  for _, list in pairs(ns.GEAR_LAYOUT) do
    for _, def in ipairs(list) do
      for _, slot in ipairs(def[3] or {}) do
        groupOf[slot] = def[1]
      end
    end
  end
  for slot, group in pairs(groupOf) do
    local id = GetInventoryItemID("player", slot)
    if id then
      mine.items[id] = true
    end
    local link = GetInventoryItemLink("player", slot)
    local f = link and ns.SplitItemString(link)
    if f and (f[2] or 0) > 0 then
      mine.enchants[group] = mine.enchants[group] or {}
      mine.enchants[group][f[2]] = true
    end
    for i = 1, 4 do
      local gem = link and C_Item and C_Item.GetItemGemID and C_Item.GetItemGemID(link, i)
      if gem then
        mine.gems[gem] = true
      end
    end
  end
  return mine
end

--- The entries a slot shows and their shares: list, share(entry), the entry on the slot.
local function slotEntries(rec, def)
  local key, nth = def[1], def[5] or 1
  if key == "gems" then
    local list = rec.gems or {}
    local total = rec.gemSockets
    if not total then
      total = 0
      for _, g in ipairs(list) do
        total = total + g.n
      end
    end
    return list, function(e)
      return total > 0 and e.n / total or 0
    end, list[1]
  end
  local sample = math.max(1, rec.sample or 0)
  local list = key == "embellishments" and (rec.embellishments or {}) or (rec.gear and rec.gear[key] or {})
  return list, function(e)
    return e.n / sample
  end, list[nth]
end

local function isMine(def, entry, mine)
  if not entry or not mine then
    return false
  end
  if def[1] == "gems" then
    return mine.gems[entry.id] == true
  end
  return mine.items[entry.id] == true
end

-- ---------------------------------------------------------------- flyout

local flyout
local FLYOUT_WIDTH = 300
local ROW = 20

local function flyoutRow(i)
  local row = flyout.rows[i]
  if row then
    return row
  end
  row = CreateFrame("Button", nil, flyout)
  row:SetHeight(ROW)
  row:SetPoint("LEFT", flyout, "LEFT", 10, 0)
  row:SetPoint("RIGHT", flyout, "RIGHT", -10, 0)
  row.mark = row:CreateTexture(nil, "BACKGROUND")
  row.mark:SetAllPoints()
  row.mark:SetColorTexture(0.2, 1, 0.2, 0.12)
  row.icon = row:CreateTexture(nil, "ARTWORK")
  row.icon:SetSize(16, 16)
  row.icon:SetPoint("LEFT", 0, 0)
  row.text = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  row.text:SetJustifyH("LEFT")
  row.right = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  row.right:SetPoint("RIGHT", 0, 0)
  row.tick = row:CreateTexture(nil, "OVERLAY")
  row.tick:SetSize(12, 12)
  row.tick:SetTexture(TICK)
  row.tick:SetPoint("RIGHT", row.right, "LEFT", -4, 0)
  row:SetScript("OnEnter", function(self)
    if self.itemID then
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:SetItemByID(self.itemID)
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
  flyout.rows = {}
  flyout:Hide()
end

--- Fill the flyout for a slot: every option with its share, then the enchants of the slot.
function ns.FillFlyout(slot, rec, mine)
  local def = slot.def
  local list, share = slotEntries(rec, def)
  local lines = {}
  for _, e in ipairs(list) do
    lines[#lines + 1] = {
      itemID = e.id,
      icon = itemIcon(e.id),
      text = itemName(e.id, e.name),
      quality = itemQuality(e.id),
      right = def[1] == "gems" and (ns.Pct(share(e)) .. " of sockets") or ns.Pct(share(e)),
      mine = isMine(def, e, mine),
    }
  end
  local enchants = rec.enchants and rec.enchants[def[1]]
  if enchants and #enchants > 0 then
    lines[#lines + 1] = { header = "Enchants" }
    local sample = math.max(1, rec.sample or 0)
    for _, e in ipairs(enchants) do
      lines[#lines + 1] = {
        text = e.name or ("Enchant " .. e.id),
        right = ns.Pct(e.n / sample),
        mine = mine and mine.enchants[def[1]] and mine.enchants[def[1]][e.id] == true,
      }
    end
  end
  flyout.title:SetText(string.format("%s · top %d", def[2] == "Ring" and "Rings" or def[2] == "Trinket" and "Trinkets" or def[2], rec.sample or 0))
  for _, row in ipairs(flyout.rows) do
    row:Hide()
  end
  local y = -30
  for i, l in ipairs(lines) do
    local row = flyoutRow(i)
    row:SetPoint("TOP", flyout, "TOP", 0, y)
    row.itemID = l.itemID
    row.icon:SetShown(l.icon ~= nil)
    row.icon:SetTexture(l.icon)
    row.text:ClearAllPoints()
    row.text:SetPoint("LEFT", l.icon and row.icon or row, l.icon and "RIGHT" or "LEFT", l.icon and 6 or (l.header and 0 or 22), 0)
    row.text:SetPoint("RIGHT", row.tick, "LEFT", -4, 0)
    if l.header then
      row.text:SetFontObject(GameFontNormalSmall)
      row.text:SetText(l.header)
      row.right:SetText("")
    else
      row.text:SetFontObject(GameFontHighlightSmall)
      row.text:SetText(l.text)
      row.text:SetTextColor(qualityColor(l.quality))
      row.right:SetText(l.right)
    end
    row.mark:SetShown(l.mine == true)
    row.tick:SetShown(l.mine == true)
    row:Show()
    y = y - ROW
  end
  if #lines == 0 then
    local row = flyoutRow(1)
    row:SetPoint("TOP", flyout, "TOP", 0, y)
    row.itemID = nil
    row.icon:Hide()
    row.text:SetText("The top players have nothing here.")
    row.right:SetText("")
    row.mark:Hide()
    row.tick:Hide()
    row:Show()
    y = y - ROW
  end
  flyout:SetHeight(-y + 10)
  return lines
end

function ns.ToggleFlyout(slot)
  if not flyout then
    return
  end
  if flyout:IsShown() and flyout.owner == slot then
    flyout:Hide()
    return
  end
  local rec = slot.rec
  if not rec then
    return
  end
  ns.FillFlyout(slot, rec, slot.mine)
  flyout.owner = slot
  flyout:ClearAllPoints()
  if slot.side == "left" then
    flyout:SetPoint("TOPLEFT", slot, "TOPRIGHT", 6, 0)
  elseif slot.side == "right" then
    flyout:SetPoint("TOPRIGHT", slot, "TOPLEFT", -6, 0)
  else
    flyout:SetPoint("BOTTOM", slot, "TOP", 0, 6)
  end
  flyout:Show()
end

function ns.HideFlyout()
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

-- ---------------------------------------------------------------- slots

local function createSlot(parent, def, side)
  local b = CreateFrame("ItemButton", nil, parent)
  b:SetSize(SLOT, SLOT)
  b.def, b.side = def, side
  b.tick = b:CreateTexture(nil, "OVERLAY")
  b.tick:SetSize(16, 16)
  b.tick:SetTexture(TICK)
  b.tick:SetPoint("BOTTOMRIGHT", b, "BOTTOMRIGHT", 4, -4)
  b.pct = b:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  b.name = b:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  if side == "left" then
    b.pct:SetPoint("TOPLEFT", b, "TOPRIGHT", 6, -4)
    b.name:SetPoint("TOPLEFT", b.pct, "BOTTOMLEFT", 0, -2)
  elseif side == "right" then
    b.pct:SetPoint("TOPRIGHT", b, "TOPLEFT", -6, -4)
    b.name:SetPoint("TOPRIGHT", b.pct, "BOTTOMRIGHT", 0, -2)
  elseif def[1] == "mainhand" then
    b.pct:SetPoint("TOPRIGHT", b, "TOPLEFT", -6, -4)
    b.name:SetPoint("TOPRIGHT", b.pct, "BOTTOMRIGHT", 0, -2)
  else
    b.pct:SetPoint("TOPLEFT", b, "TOPRIGHT", 6, -4)
    b.name:SetPoint("TOPLEFT", b.pct, "BOTTOMLEFT", 0, -2)
  end
  b.name:SetText(def[2])
  b:RegisterForClicks("LeftButtonUp")
  b:SetScript("OnClick", function(self)
    ns.ToggleFlyout(self)
  end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, side == "right" and "ANCHOR_LEFT" or "ANCHOR_RIGHT")
    if self.itemID then
      GameTooltip:SetItemByID(self.itemID)
    else
      GameTooltip:AddLine(def[2])
    end
    GameTooltip:AddLine("Click for every option the top players use.", 0.5, 1, 0.5, true)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", GameTooltip_Hide)
  return b
end

local function setSlot(b, rec, mine)
  local list, share, entry = slotEntries(rec, b.def)
  b.rec, b.mine = rec, mine
  b.itemID = entry and entry.id or nil
  local icon = entry and itemIcon(entry.id) or emptyArt(b.def[4])
  if SetItemButtonTexture then
    SetItemButtonTexture(b, icon)
  elseif b.icon then
    b.icon:SetTexture(icon)
  end
  if SetItemButtonQuality then
    SetItemButtonQuality(b, entry and itemQuality(entry.id) or nil, entry and entry.id or nil)
  end
  b.pct:SetText(entry and ns.Pct(share(entry)) or "")
  b.tick:SetShown(isMine(b.def, entry, mine))
  b.count = #list
end

-- ---------------------------------------------------------------- stat bars

local BAR_HEIGHT = 11

local function createBar(parent, r, g, b)
  local bar = CreateFrame("StatusBar", nil, parent)
  bar:SetHeight(BAR_HEIGHT)
  bar:SetStatusBarTexture("Interface\\TargetingFrame\\UI-StatusBar")
  bar:SetStatusBarColor(r, g, b)
  bar.bg = bar:CreateTexture(nil, "BACKGROUND")
  bar.bg:SetAllPoints()
  bar.bg:SetColorTexture(0, 0, 0, 0.5)
  bar.text = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  bar.text:SetPoint("RIGHT", bar, "RIGHT", -3, 0)
  return bar
end

local function createStats(parent, width)
  local block = CreateFrame("Frame", nil, parent)
  block:SetSize(width, 220)
  block.title = block:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  block.title:SetPoint("TOPLEFT", 0, 0)
  block.title:SetText("Secondary stats")
  block.legend = block:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  block.legend:SetPoint("TOPRIGHT", 0, -1)
  -- Colour swatches as texture escapes (the game fonts may not have a square glyph).
  local swatch = "|TInterface\\Buttons\\WHITE8X8:8:8:0:0:8:8:0:8:0:8:%d:%d:%d|t"
  block.legend:SetText(string.format(swatch, 255, 209, 0) .. " Top players   " .. string.format(swatch, 64, 255, 64) .. " You")
  block.rows = {}
  local y = -20
  for i, s in ipairs(ns.STATS) do
    local row = CreateFrame("Frame", nil, block)
    row:SetPoint("TOPLEFT", 0, y)
    row:SetSize(width, 42)
    row.label = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    row.label:SetPoint("TOPLEFT", 0, 0)
    row.label:SetText(s.label)
    row.share = row:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    row.share:SetPoint("TOPRIGHT", 0, 0)
    row.theirs = createBar(row, 1, 0.82, 0)
    row.theirs:SetPoint("TOPLEFT", 0, -14)
    row.theirs:SetPoint("TOPRIGHT", 0, -14)
    row.yours = createBar(row, 0.25, 1, 0.25)
    row.yours:SetPoint("TOPLEFT", row.theirs, "BOTTOMLEFT", 0, -2)
    row.yours:SetPoint("TOPRIGHT", row.theirs, "BOTTOMRIGHT", 0, -2)
    row:EnableMouse(true)
    row:SetScript("OnEnter", function(self)
      if not self.tip then
        return
      end
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(s.label)
      for _, line in ipairs(self.tip) do
        GameTooltip:AddLine(line, 1, 1, 1, true)
      end
      GameTooltip:Show()
    end)
    row:SetScript("OnLeave", GameTooltip_Hide)
    block.rows[i] = row
    y = y - 46
  end
  block.note = block:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  block.note:SetPoint("TOPLEFT", 0, y + 2)
  block.note:SetText("From gear and gems; enchants are not counted.")
  return block
end

local function barText(rating, pct)
  if not rating then
    return ""
  end
  return pct and string.format("%s · %.1f%%", number(rating), pct) or number(rating)
end

--- The stat values shown: { [key] = { theirs, theirsPct, yours, yoursPct, share } }.
function ns.StatRows(rec, yours, ownSpec)
  local out = {}
  for _, s in ipairs(ns.STATS) do
    local theirs = rec.statRatings and rec.statRatings[s.key]
    local mine = yours and yours[s.key]
    out[s.key] = {
      theirs = theirs,
      theirsPct = theirs and ns.StatPercent(s.key, theirs, ownSpec),
      yours = mine,
      yoursPct = mine and ns.StatPercent(s.key, mine, ownSpec),
      share = rec.stats and rec.stats[s.key],
    }
  end
  return out
end

local function setStats(block, rec, yours, ownSpec)
  local rows = ns.StatRows(rec, yours, ownSpec)
  local max = 0
  for _, r in pairs(rows) do
    max = math.max(max, r.theirs or (r.share or 0) * 100, r.yours or 0)
  end
  for i, s in ipairs(ns.STATS) do
    local r, row = rows[s.key], block.rows[i]
    row.share:SetText(r.share and (ns.Pct(r.share) .. " of their stats") or "")
    row.theirs:SetMinMaxValues(0, math.max(1, max))
    row.yours:SetMinMaxValues(0, math.max(1, max))
    if r.theirs then
      row.theirs:SetValue(r.theirs)
      row.theirs.text:SetText(barText(r.theirs, r.theirsPct))
    else
      -- Data from an older app version: only the shares are known.
      row.theirs:SetValue((r.share or 0) * 100)
      row.theirs.text:SetText(r.share and ns.Pct(r.share) or "")
    end
    row.yours:SetShown(r.yours ~= nil and rec.statRatings ~= nil)
    row.yours:SetValue(r.yours or 0)
    row.yours.text:SetText(barText(r.yours, r.yoursPct))
    row.tip = {
      string.format("Top players: %s", r.theirs and barText(r.theirs, r.theirsPct) or "?"),
      r.yours and string.format("You: %s", barText(r.yours, r.yoursPct)) or "Your stats show for your own class, out of combat.",
      r.share and string.format("%s of the top players' secondary stats.", ns.Pct(r.share)) or nil,
      "Rating from gear and gems (enchants not counted), and the % that rating gives at your level.",
    }
  end
end

-- ---------------------------------------------------------------- the view

--- Build the Overview tab in `parent` (the window's inset).
function ns.CreateGearView(parent)
  local view = CreateFrame("Frame", nil, parent)
  view:SetAllPoints(parent)
  view.slots = {}
  for i, def in ipairs(LEFT) do
    local b = createSlot(view, def, "left")
    b:SetPoint("TOPLEFT", view, "TOPLEFT", 10, -10 - (i - 1) * (SLOT + GAP))
    view.slots[#view.slots + 1] = b
  end
  for i, def in ipairs(RIGHT) do
    local b = createSlot(view, def, "right")
    b:SetPoint("TOPRIGHT", view, "TOPRIGHT", -10, -10 - (i - 1) * (SLOT + GAP))
    view.slots[#view.slots + 1] = b
  end
  local bottomY = -10 - #RIGHT * (SLOT + GAP) - 4
  for i, def in ipairs(BOTTOM) do
    local b = createSlot(view, def, "bottom")
    b:SetPoint("TOP", view, "TOP", i == 1 and -(SLOT / 2 + 4) or (SLOT / 2 + 4), bottomY)
    view.slots[#view.slots + 1] = b
  end

  local centreWidth = 290
  view.header = view:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  view.header:SetPoint("TOP", view, "TOP", 0, -12)
  view.sub = view:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  view.sub:SetPoint("TOP", view.header, "BOTTOM", 0, -4)
  view.hero = view:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  view.hero:SetPoint("TOP", view.sub, "BOTTOM", 0, -10)
  view.hero:SetWidth(centreWidth)
  view.build = CreateFrame("Button", nil, view)
  view.build:SetSize(centreWidth, 16)
  view.build:SetPoint("TOP", view.hero, "BOTTOM", 0, -4)
  view.build.text = view.build:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  view.build.text:SetAllPoints()
  view.build:SetScript("OnClick", function()
    ns:Fire("SHOW_BUILDS")
  end)
  view.stats = createStats(view, centreWidth)
  view.stats:SetPoint("TOP", view.build, "BOTTOM", 0, -14)

  view.empty = view:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  view.empty:SetPoint("CENTER", view, "CENTER", 0, 20)
  view.empty:SetWidth(380)

  createFlyout(view)
  return view
end

--- Fill the Overview for a spec record (nil = no data).
function ns.RenderGear(view, rec, specID)
  ns.HideFlyout()
  local ownSpec = specID ~= nil and specID == ns.PlayerSpecID()
  local _, playerClass = UnitClass("player")
  local ownClass = rec and playerClass and string.upper(rec.class or ""):gsub(" ", "") == playerClass
  local show = rec ~= nil
  for _, b in ipairs(view.slots) do
    b:SetShown(show)
  end
  for _, region in ipairs({ view.header, view.sub, view.hero, view.build, view.stats }) do
    region:SetShown(show)
  end
  view.empty:SetShown(not show)
  if not rec then
    return
  end
  local mine = ownClass and ns.MyGear() or nil
  for _, b in ipairs(view.slots) do
    setSlot(b, rec, mine)
  end

  local region = rec.region == "world" and "World" or string.upper(rec.region or "")
  view.header:SetText(string.format("Top %d %s %ss", rec.sample or 0, rec.spec or "", rec.class or ""))
  view.sub:SetText(string.format("%s · item level %.1f%s", region, rec.ilvl or 0, rec.season and (" · " .. rec.season) or ""))

  local v = ns.View(rec, ns.state.zoneID)
  local heroes = {}
  for _, h in ipairs(v.hero or {}) do
    heroes[#heroes + 1] = (h.name or "?") .. " " .. ns.Pct(h.n / math.max(1, v.sample))
  end
  view.hero:SetText(#heroes > 0 and ("Hero talents: " .. table.concat(heroes, " · ")) or "")
  local picks = ownSpec and ns.GetMyPicks() or nil
  local index, distance
  if picks and next(picks.picks) then
    index, distance = ns.ClosestBuild(v.builds, picks)
  end
  if index then
    view.build.text:SetText(distance == 0 and string.format("|cff40ff40Your talents are Build %d.|r", index)
      or string.format("|cff40ff40Your talents are closest to Build %d (%d differ).|r", index, distance))
  else
    view.build.text:SetText(string.format("|cffffd100%d popular builds|r", #v.builds))
  end
  setStats(view.stats, rec, ownClass and ns.MyGearStats() or nil, ownSpec)
end

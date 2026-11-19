-- Keystone Lens: the flasks, food and augment runes the top players use, on the Overview tab, and
-- whether you carry them. The data comes from the buffs Raider.IO records at the boss pulls of runs
-- logged with its client (potions and weapon oils are not recorded there).
local _, ns = ...

local ICON = 24
local QUESTION = 134400 -- INV_Misc_QuestionMark
local TICK = "Interface\\RaidFrame\\ReadyCheck-Ready"
local KINDS = {
  { key = "flask", label = "Flask" },
  { key = "food", label = "Food" },
  { key = "rune", label = "Augment rune" },
}
ns.CONSUMABLE_KINDS = KINDS

local function itemCount(itemID)
  if C_Item and C_Item.GetItemCount then
    return C_Item.GetItemCount(itemID) or 0
  end
  return 0
end

--- How many of an option's items are in your bags (any quality rank), or nil when it is no item.
local function carried(items)
  if type(items) ~= "table" or #items == 0 then
    return nil
  end
  local n = 0
  for _, id in ipairs(items) do
    n = n + itemCount(id)
  end
  return n
end

--- The item's name in the game's language when the game knows it.
local function localName(o)
  local id = type(o.items) == "table" and o.items[1]
  local name = id and C_Item and C_Item.GetItemNameByID and C_Item.GetItemNameByID(id)
  return name or o.name or "?"
end

local function iconOf(o)
  if type(o.icon) == "string" and o.icon ~= "" then
    return "Interface\\Icons\\" .. o.icon
  end
  local id = type(o.items) == "table" and o.items[1]
  return id and C_Item and C_Item.GetItemIconByID and C_Item.GetItemIconByID(id) or QUESTION
end

--- The consumables of a spec record, per kind: { { key, label, used, players, options = { { id,
--- name, icon, items, n, share, have } } } }. Empty for data without them (older app versions, or
--- when none of the players' runs were logged).
function ns.ConsumableRows(rec)
  local out = {}
  local c = rec and type(rec.consumables) == "table" and rec.consumables or nil
  if not c or not c.n or c.n <= 0 then
    return out
  end
  for _, k in ipairs(KINDS) do
    local options = {}
    for _, o in ipairs(type(c[k.key]) == "table" and c[k.key] or {}) do
      options[#options + 1] = {
        id = o.id,
        name = localName(o),
        icon = iconOf(o),
        items = o.items,
        n = o.n or 0,
        share = (o.n or 0) / c.n,
        have = carried(o.items),
      }
    end
    out[#out + 1] = {
      key = k.key,
      label = k.label,
      used = type(c.used) == "table" and c.used[k.key] or 0,
      players = c.n,
      options = options,
    }
  end
  return out
end

local function consumableTooltip(self)
  local row = self.row
  if not row then
    return
  end
  GameTooltip:SetOwner(self, "ANCHOR_TOP")
  GameTooltip:AddLine(row.label)
  for _, o in ipairs(row.options) do
    local mark = o.have and o.have > 0 and " |T" .. TICK .. ":0|t" or ""
    GameTooltip:AddDoubleLine(o.name .. mark, ns.Pct(o.share), 1, 1, 1, 1, 1, 1)
  end
  local without = row.players - row.used
  if without > 0 then
    GameTooltip:AddDoubleLine("None", ns.Pct(without / row.players), 0.6, 0.6, 0.6, 0.6, 0.6, 0.6)
  end
  local top = row.options[1]
  if top and top.have ~= nil then
    if top.have > 0 then
      GameTooltip:AddLine(string.format("You carry %d %s.", top.have, top.name), 0.25, 1, 0.25, true)
    else
      GameTooltip:AddLine(string.format("You carry no %s.", top.name), 1, 0.4, 0.4, true)
    end
  end
  GameTooltip:AddLine(
    string.format("From the boss pulls of %d top players' runs logged with the Raider.IO client.", row.players),
    0.6, 0.6, 0.6, true
  )
  GameTooltip:Show()
end

--- The "Consumables" row for the Overview: the most used flask, food and augment rune.
function ns.CreateConsumableStrip(parent)
  local strip = CreateFrame("Frame", nil, parent)
  strip:SetHeight(ICON + 4)
  strip.title = strip:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  strip.title:SetPoint("LEFT", 0, 0)
  strip.title:SetText("Consumables")
  strip.buttons = {}
  for i = 1, #KINDS do
    local b = CreateFrame("Button", nil, strip)
    b:SetSize(ICON, ICON)
    if i == 1 then
      b:SetPoint("LEFT", strip.title, "RIGHT", 10, 0)
    else
      b:SetPoint("LEFT", strip.buttons[i - 1].pct, "RIGHT", 10, 0)
    end
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetAllPoints()
    b.tick = b:CreateTexture(nil, "OVERLAY")
    b.tick:SetSize(12, 12)
    b.tick:SetPoint("BOTTOMRIGHT", 3, -3)
    b.tick:SetTexture(TICK)
    b:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
    b.pct = strip:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    b.pct:SetPoint("LEFT", b, "RIGHT", 4, 0)
    b:SetScript("OnEnter", consumableTooltip)
    b:SetScript("OnLeave", GameTooltip_Hide)
    strip.buttons[i] = b
  end
  return strip
end

--- Fill the row for a spec record; hidden when the record has no consumables.
function ns.RenderConsumables(strip, rec)
  local rows = ns.ConsumableRows(rec)
  strip.rows = rows
  strip:SetShown(#rows > 0)
  for i, b in ipairs(strip.buttons) do
    local row = rows[i]
    local top = row and row.options[1]
    b.row = row
    b:SetShown(row ~= nil)
    b.pct:SetShown(row ~= nil)
    if row then
      b.icon:SetTexture(top and top.icon or QUESTION)
      b.icon:SetDesaturated(top == nil)
      b.pct:SetText(top and ns.Pct(top.share) or "-")
      b.tick:SetShown(top ~= nil and top.have ~= nil and top.have > 0)
    end
  end
  return rows
end

-- Keystone Lens: the main window (/kl): popular builds, gear, and where the data comes from.
local _, ns = ...

local WIDTH, HEIGHT = 470, 560
local ROW_HEIGHT = 20

-- Gear slot groups in the data, with the inventory slots of your own items.
local GEAR_GROUPS = {
  { "head", "Head", { 1 } }, { "neck", "Neck", { 2 } }, { "shoulder", "Shoulder", { 3 } },
  { "back", "Back", { 15 } }, { "chest", "Chest", { 5 } }, { "wrist", "Wrist", { 9 } },
  { "hands", "Hands", { 10 } }, { "waist", "Waist", { 6 } }, { "legs", "Legs", { 7 } },
  { "feet", "Feet", { 8 } }, { "rings", "Rings", { 11, 12 } }, { "trinkets", "Trinkets", { 13, 14 } },
  { "mainhand", "Main Hand", { 16 } }, { "offhand", "Off Hand", { 17 } },
}
local STATS = {
  { "crit", "Critical Strike", "CR_CRIT_MELEE", 9 },
  { "haste", "Haste", "CR_HASTE_MELEE", 18 },
  { "mastery", "Mastery", "CR_MASTERY", 26 },
  { "vers", "Versatility", "CR_VERSATILITY_DAMAGE_DONE", 29 },
}

local CHECK = "|TInterface\\RaidFrame\\ReadyCheck-Ready:12|t "

local panel -- the window
local view = { tab = "builds", specID = nil, zoneID = nil, chosenZone = false }

-- ---------------------------------------------------------------- copy box

local copyBox
function ns.ShowCopyBox(text, title)
  if not copyBox then
    copyBox = CreateFrame("Frame", "KeystoneLensCopyBox", UIParent, "BackdropTemplate")
    copyBox:SetSize(420, 92)
    copyBox:SetPoint("CENTER", 0, 120)
    copyBox:SetFrameStrata("DIALOG")
    copyBox:SetBackdrop({
      bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
      edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 16,
      insets = { left = 4, right = 4, top = 4, bottom = 4 },
    })
    copyBox:SetBackdropColor(0.05, 0.05, 0.07, 0.97)
    copyBox.title = copyBox:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    copyBox.title:SetPoint("TOPLEFT", 14, -12)
    copyBox.hint = copyBox:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    copyBox.hint:SetPoint("BOTTOMLEFT", 14, 12)
    copyBox.hint:SetText("Press Ctrl+C to copy, then Escape to close.")
    copyBox.edit = CreateFrame("EditBox", nil, copyBox, "InputBoxTemplate")
    copyBox.edit:SetSize(380, 22)
    copyBox.edit:SetPoint("TOPLEFT", 20, -32)
    copyBox.edit:SetAutoFocus(true)
    copyBox.edit:SetScript("OnEscapePressed", function()
      copyBox:Hide()
    end)
    copyBox.edit:SetScript("OnEnterPressed", function()
      copyBox:Hide()
    end)
    copyBox.edit:SetScript("OnTextChanged", function(self, user)
      if user then
        self:SetText(copyBox.value) -- read-only
        self:HighlightText()
      end
    end)
    local close = CreateFrame("Button", nil, copyBox, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -2, -2)
  end
  copyBox.value = text
  copyBox.title:SetText(title or "Copy")
  copyBox.edit:SetText(text)
  copyBox:Show()
  copyBox.edit:SetFocus()
  copyBox.edit:HighlightText()
end

-- ---------------------------------------------------------------- rows

local rows = {}
local used = 0

local function acquireRow(content)
  used = used + 1
  local row = rows[used]
  if not row then
    row = CreateFrame("Button", nil, content)
    row:SetHeight(ROW_HEIGHT)
    row.icon = row:CreateTexture(nil, "ARTWORK")
    row.icon:SetSize(16, 16)
    row.icon:SetPoint("LEFT", 0, 0)
    row.text = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    row.text:SetJustifyH("LEFT")
    row.right = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    row.right:SetPoint("RIGHT", -4, 0)
    row.right:SetJustifyH("RIGHT")
    row.button = CreateFrame("Button", nil, row, "UIPanelButtonTemplate")
    row.button:SetSize(64, 18)
    row.button:SetPoint("RIGHT", -2, 0)
    row:SetScript("OnEnter", function(self)
      if self.itemID then
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:SetItemByID(self.itemID)
        GameTooltip:Show()
      elseif self.tip then
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:AddLine(self.tip, 1, 1, 1, true)
        GameTooltip:Show()
      end
    end)
    row:SetScript("OnLeave", GameTooltip_Hide)
    rows[used] = row
  end
  row:SetPoint("TOPLEFT", content, "TOPLEFT", 0, -(used - 1) * ROW_HEIGHT)
  row:SetPoint("RIGHT", content, "RIGHT", 0, 0)
  row.itemID, row.tip = nil, nil
  row.icon:Hide()
  row.button:Hide()
  row.text:ClearAllPoints()
  row.text:SetPoint("LEFT", 0, 0)
  row.text:SetPoint("RIGHT", row.right, "LEFT", -6, 0)
  row.text:SetFontObject(GameFontHighlightSmall)
  row.text:SetTextColor(1, 1, 1)
  row.right:SetText("")
  row:Show()
  return row
end

local function header(content, text)
  if used > 0 then
    acquireRow(content).text:SetText("") -- spacer
  end
  local row = acquireRow(content)
  row.text:SetFontObject(GameFontNormal)
  row.text:SetText(text)
  return row
end

local function line(content, text, r, g, b, tip)
  local row = acquireRow(content)
  row.text:SetText(text)
  if r then
    row.text:SetTextColor(r, g, b)
  end
  row.tip = tip
  return row
end

local function itemRow(content, itemID, fallbackName, right, mark)
  local row = acquireRow(content)
  local icon = C_Item and C_Item.GetItemIconByID and C_Item.GetItemIconByID(itemID)
  row.icon:SetTexture(icon or 134400)
  row.icon:Show()
  row.text:ClearAllPoints()
  row.text:SetPoint("LEFT", row.icon, "RIGHT", 6, 0)
  row.text:SetPoint("RIGHT", row.right, "LEFT", -6, 0)
  local name = C_Item and C_Item.GetItemNameByID and C_Item.GetItemNameByID(itemID)
  if not name and C_Item and C_Item.RequestLoadItemDataByID then
    C_Item.RequestLoadItemDataByID(itemID)
  end
  row.text:SetText((mark and CHECK or "") .. (name or fallbackName or ("Item " .. itemID)))
  row.right:SetText(right or "")
  row.itemID = itemID
  return row
end

local function buttonRow(content, text, label, onClick, tip)
  local row = acquireRow(content)
  row.text:SetText(text)
  row.text:SetPoint("RIGHT", row.button, "LEFT", -6, 0)
  row.button:SetText(label)
  row.button:SetScript("OnClick", onClick)
  row.button:Show()
  row.tip = tip
  return row
end

-- ---------------------------------------------------------------- tabs

local function sampleText(rec, v)
  local region = rec.region == "world" and "World" or string.upper(rec.region or "")
  return string.format("Top %d %s %ss · %s", v.sample, rec.spec or "", rec.class or "", region)
end

local function renderBuilds(content, rec)
  local v = ns.View(rec, view.zoneID)
  header(content, sampleText(rec, v))
  local heroes = {}
  for _, h in ipairs(v.hero or {}) do
    heroes[#heroes + 1] = (h.name or "?") .. " " .. ns.Pct(h.n / math.max(1, v.sample))
  end
  if #heroes > 0 then
    line(content, "Hero talents: " .. table.concat(heroes, " · "))
  end

  local mine = view.specID == ns.PlayerSpecID() and ns.GetMyPicks() or nil
  local closest, distance
  if mine and next(mine.picks) then
    closest, distance = ns.ClosestBuild(v.builds, mine)
    if closest then
      local text = distance == 0 and string.format("Your build is Build %d.", closest)
        or string.format("Your build is closest to Build %d (%d talent%s differ).", closest, distance, distance == 1 and "" or "s")
      line(content, text, 0.5, 1, 0.5)
    end
  end

  header(content, "Popular builds")
  if #v.builds == 0 then
    line(content, "No build is shared by two or more of these players.", 0.7, 0.7, 0.7)
  end
  for i, b in ipairs(v.builds) do
    local hero = b.hero and ns.HeroName(rec, b.hero)
    local text = string.format("%sBuild %d%s · %d players (%s)", i == closest and CHECK or "", i, hero and (" · " .. hero) or "", b.n or 0, ns.Pct(b.p or 0))
    if b.str then
      buttonRow(content, text, "Copy", function()
        ns.ShowCopyBox(b.str, string.format("Build %d%s: talent loadout string", i, hero and (" · " .. hero) or ""))
      end, "Copy the import string, then in the talent window open the loadout menu and choose Import.")
    else
      line(content, text)
    end
  end
end

local function myItems(slots)
  local ids = {}
  for _, slot in ipairs(slots) do
    local id = GetInventoryItemID("player", slot)
    if id then
      ids[id] = slot
    end
  end
  return ids
end

local function myEnchants(slots)
  local ids = {}
  for _, slot in ipairs(slots) do
    local f = ns.SplitItemString(GetInventoryItemLink("player", slot))
    if f and (f[2] or 0) > 0 then
      ids[f[2]] = true
    end
  end
  return ids
end

local function renderGear(content, rec)
  local sample = math.max(1, rec.sample or 0)
  local yours = view.specID == ns.PlayerSpecID()
  header(content, string.format("Top %d %s %ss · item level %.1f", rec.sample or 0, rec.spec or "", rec.class or "", rec.ilvl or 0))

  if rec.stats then
    local parts = {}
    local mineParts = {}
    local total = 0
    local ratings = {}
    -- Your ratings, out of combat only (in combat the game may hide them from addons).
    local readable = yours and GetCombatRating and not InCombatLockdown()
    for _, s in ipairs(STATS) do
      local rating = readable and GetCombatRating(_G[s[3]] or s[4]) or 0
      if issecretvalue and issecretvalue(rating) then
        rating, readable = 0, false
      end
      ratings[s[1]] = rating
      total = total + rating
    end
    if not readable then
      total = 0
    end
    for _, s in ipairs(STATS) do
      parts[#parts + 1] = s[2] .. " " .. ns.Pct(rec.stats[s[1]] or 0)
      if total > 0 then
        mineParts[#mineParts + 1] = s[2] .. " " .. ns.Pct(ratings[s[1]] / total)
      end
    end
    line(content, "Their stats: " .. table.concat(parts, " · "), nil, nil, nil, "Share of each secondary stat on their gear (enchants not counted).")
    if yours and #mineParts > 0 then
      line(content, "Yours: " .. table.concat(mineParts, " · "), 0.5, 1, 0.5, "Your current ratings, including enchants and buffs.")
    end
  end

  for _, g in ipairs(GEAR_GROUPS) do
    local items = rec.gear and rec.gear[g[1]]
    if items and #items > 0 then
      header(content, g[2])
      local equipped = yours and myItems(g[3]) or {}
      for i = 1, math.min(#items, 6) do
        local it = items[i]
        itemRow(content, it.id, it.name, ns.Pct(it.n / sample), equipped[it.id] ~= nil)
      end
      local enchants = rec.enchants and rec.enchants[g[1]]
      if enchants and #enchants > 0 then
        local mineE = yours and myEnchants(g[3]) or {}
        local e = enchants[1]
        line(content, string.format("   Enchant: %s%s %s", mineE[e.id] and CHECK or "", e.name or ("#" .. e.id), ns.Pct(e.n / sample)), 0.8, 0.8, 0.8)
      end
    end
  end

  if rec.gems and #rec.gems > 0 then
    header(content, "Gems")
    for _, gem in ipairs(rec.gems) do
      itemRow(content, gem.id, gem.name, gem.n .. " sockets")
    end
  end
  if rec.embellishments and #rec.embellishments > 0 then
    header(content, "Embellishments")
    for _, e in ipairs(rec.embellishments) do
      itemRow(content, e.id, e.name, ns.Pct(e.n / sample))
    end
  end
end

local function renderAbout(content, rec, source)
  header(content, ns.title .. " " .. ns.version)
  line(content, "What the top Mythic+ players of your spec run, in game.")
  if rec then
    header(content, "This data")
    line(content, sampleText(rec, ns.View(rec, nil)))
    if rec.season then
      line(content, rec.season .. (rec.patch and (" · patch " .. rec.patch) or ""))
    end
    line(content, (source == "app" and "From the Keystone Lens app, " or "Bundled with the addon, ") .. ns.Ago(rec.time) .. ".")
    line(content, string.format("%d of %d dungeons have their own builds.", #ns.LoadedDungeons(rec), #(rec.dungeonList or {})))
  end
  header(content, "Fresh data for your specs")
  line(content, "The free Keystone Lens desktop app (Windows) finds the top players")
  line(content, "and writes their data for this addon. It keeps your characters'")
  line(content, "specs up to date and has more: filters, inspecting players, damage.")
  buttonRow(content, "github.com/mlvgog/keystone-lens", "Link", function()
    ns.ShowCopyBox(ns.APP_URL, "Keystone Lens app")
  end)
  header(content, "Commands")
  line(content, "/kl: this window · /kl talents · /kl tooltips · /kl options")
  header(content, "Sources")
  line(content, "Players, keys, talents and gear: raider.io (via the app).", 0.8, 0.8, 0.8)
  line(content, "Not affiliated with Blizzard Entertainment or raider.io.", 0.6, 0.6, 0.6)
end

local function renderEmpty(content)
  header(content, "No data yet")
  if ns:NeedsUpdate() then
    line(content, "The data was written for a newer version of this addon.", 1, 0.5, 0.4)
    line(content, "Update Keystone Lens (CurseForge, or Settings in the app).")
    return
  end
  local name = select(2, GetSpecializationInfoByID(view.specID or ns.PlayerSpecID() or 0))
  line(content, "There is no data for " .. (name or "your spec") .. " yet.")
  line(content, "This addon shows data from the free Keystone Lens desktop app:")
  line(content, "look at your spec in the app (or let it keep your characters'")
  line(content, "specs fresh), then /reload here.")
  buttonRow(content, "github.com/mlvgog/keystone-lens", "Link", function()
    ns.ShowCopyBox(ns.APP_URL, "Keystone Lens app")
  end)
end

-- ---------------------------------------------------------------- window

local function available()
  return ns:AvailableSpecs()
end

local function pickSpec()
  local list = available()
  local current = view.specID
  for _, s in ipairs(list) do
    if s.specID == current then
      return s
    end
  end
  local mine = ns.PlayerSpecID()
  for _, s in ipairs(list) do
    if s.specID == mine then
      view.specID = mine
      return s
    end
  end
  if list[1] then
    view.specID = list[1].specID
  end
  return list[1]
end

function ns:RenderPanel()
  if not panel or not panel:IsShown() then
    return
  end
  for i = 1, #rows do
    rows[i]:Hide()
  end
  used = 0
  local content = panel.content
  local spec = pickSpec()
  local rec = spec and spec.rec

  if rec and not view.chosenZone then
    view.zoneID = ns:CurrentDungeon(rec)
  end
  panel.specButton:SetText(rec and ((rec.spec or "?") .. " " .. (rec.class or "")) or "No data")
  panel.specButton:SetEnabled(#available() > 1)
  local dungeons = rec and ns.LoadedDungeons(rec) or {}
  panel.zoneButton:SetText(view.zoneID and rec and ns.DungeonName(rec, view.zoneID) or "All dungeons")
  panel.zoneButton:SetShown(view.tab == "builds" and #dungeons > 0)
  for key, tab in pairs(panel.tabs) do
    if key == view.tab then
      tab:LockHighlight()
    else
      tab:UnlockHighlight()
    end
  end

  if view.tab == "about" then
    renderAbout(content, rec, spec and spec.source)
  elseif not rec then
    renderEmpty(content)
  elseif view.tab == "gear" then
    renderGear(content, rec)
  else
    renderBuilds(content, rec)
  end
  content:SetHeight(math.max(1, used * ROW_HEIGHT))
  if rec then
    panel.footer:SetText((spec.source == "app" and "From the Keystone Lens app · " or "Bundled data · ") .. ns.Ago(rec.time) .. " · /reload loads new data")
  else
    panel.footer:SetText("")
  end
end

local function cycle(list, current, step, key)
  local index = 0
  for i, x in ipairs(list) do
    if x[key] == current then
      index = i
    end
  end
  return index, (#list > 0) and ((index - 1 + step) % #list) + 1 or nil
end

local function createPanel()
  panel = CreateFrame("Frame", "KeystoneLensFrame", UIParent, "BackdropTemplate")
  panel:SetSize(WIDTH, HEIGHT)
  panel:SetPoint("CENTER")
  panel:SetFrameStrata("HIGH")
  panel:SetMovable(true)
  panel:SetClampedToScreen(true)
  panel:EnableMouse(true)
  panel:RegisterForDrag("LeftButton")
  panel:SetScript("OnDragStart", panel.StartMoving)
  panel:SetScript("OnDragStop", panel.StopMovingOrSizing)
  panel:SetBackdrop({
    bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    tile = true, tileSize = 16, edgeSize = 16,
    insets = { left = 4, right = 4, top = 4, bottom = 4 },
  })
  panel:SetBackdropColor(0.04, 0.04, 0.06, 0.96)
  panel:Hide()
  tinsert(UISpecialFrames, "KeystoneLensFrame") -- Escape closes it

  panel.title = panel:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  panel.title:SetPoint("TOPLEFT", 14, -12)
  panel.title:SetText(ns.title)
  local close = CreateFrame("Button", nil, panel, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", -2, -2)

  panel.specButton = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
  panel.specButton:SetSize(190, 22)
  panel.specButton:SetPoint("TOPLEFT", 12, -38)
  panel.specButton:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  panel.specButton:SetScript("OnClick", function(_, mouse)
    local list = available()
    local _, nextIndex = cycle(list, view.specID, mouse == "RightButton" and -1 or 1, "specID")
    if nextIndex then
      view.specID = list[nextIndex].specID
      view.zoneID, view.chosenZone = nil, false
      ns:RenderPanel()
    end
  end)

  panel.zoneButton = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
  panel.zoneButton:SetSize(190, 22)
  panel.zoneButton:SetPoint("LEFT", panel.specButton, "RIGHT", 8, 0)
  panel.zoneButton:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  panel.zoneButton:SetScript("OnClick", function(_, mouse)
    local rec = ns:GetSpecData(view.specID or 0)
    if not rec then
      return
    end
    local list = { { id = false } }
    for _, d in ipairs(ns.LoadedDungeons(rec)) do
      list[#list + 1] = d
    end
    local _, nextIndex = cycle(list, view.zoneID or false, mouse == "RightButton" and -1 or 1, "id")
    view.zoneID = list[nextIndex].id or nil
    view.chosenZone = true
    ns:RenderPanel()
  end)

  panel.tabs = {}
  local previous
  for _, t in ipairs({ { "builds", "Builds" }, { "gear", "Gear" }, { "about", "About" } }) do
    local tab = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    tab:SetSize(80, 22)
    if previous then
      tab:SetPoint("LEFT", previous, "RIGHT", 4, 0)
    else
      tab:SetPoint("TOPLEFT", 12, -64)
    end
    tab:SetText(t[2])
    tab:SetScript("OnClick", function()
      view.tab = t[1]
      ns:RenderPanel()
    end)
    panel.tabs[t[1]] = tab
    previous = tab
  end

  local scroll = CreateFrame("ScrollFrame", nil, panel, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", 14, -94)
  scroll:SetPoint("BOTTOMRIGHT", -32, 30)
  panel.content = CreateFrame("Frame", nil, scroll)
  panel.content:SetSize(WIDTH - 50, 1)
  scroll:SetScrollChild(panel.content)

  panel.footer = panel:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  panel.footer:SetPoint("BOTTOMLEFT", 14, 12)
  panel.footer:SetPoint("BOTTOMRIGHT", -14, 12)
  panel.footer:SetJustifyH("LEFT")

  panel:SetScript("OnShow", function()
    view.specID = ns.PlayerSpecID()
    view.zoneID, view.chosenZone = nil, false
    ns:RenderPanel()
  end)
end

function ns:TogglePanel()
  if not panel then
    createPanel()
  end
  panel:SetShown(not panel:IsShown())
end

ns:Listen("TOGGLE_PANEL", function()
  ns:TogglePanel()
end)

-- Item names arrive from the server a moment later: redraw once they have.
local redrawQueued = false
ns:On("GET_ITEM_INFO_RECEIVED", function()
  if redrawQueued or not panel or not panel:IsShown() or view.tab == "builds" then
    return
  end
  redrawQueued = true
  C_Timer.After(0.2, function()
    redrawQueued = false
    ns:RenderPanel()
  end)
end)
ns:On("PLAYER_EQUIPMENT_CHANGED", function()
  ns:RenderPanel()
end)
ns:On("TRAIT_CONFIG_UPDATED", function()
  ns:RenderPanel()
end)

ns:Listen("PRINT_STATUS", function()
  local specs = ns:AvailableSpecs()
  if #specs == 0 then
    ns.Print("no data loaded. Get it from the Keystone Lens app (" .. ns.APP_URL .. ").")
    return
  end
  for _, s in ipairs(specs) do
    ns.Print(string.format("%s %s: top %d, %s, %s", s.rec.spec or "?", s.rec.class or "?", s.rec.sample or 0, s.source, ns.Ago(s.rec.time)))
  end
end)

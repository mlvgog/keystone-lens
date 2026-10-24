-- Keystone Lens: the main window (/kl). Overview: the top players' gear as a character pane with
-- their stats next to yours (Gear.lua) and the popular builds in a side pane (Builds.lua).
-- Info: where the data comes from, settings and commands.
local _, ns = ...

local WIDTH, HEIGHT = 580, 545

local panel -- the window
local view = { tab = 1, specID = nil } -- tab 1 = Overview, 2 = Info

-- ---------------------------------------------------------------- copy box

local copyBox
function ns.ShowCopyBox(text, title)
  if not copyBox then
    copyBox = CreateFrame("Frame", "KeystoneLensCopyBox", UIParent, "BackdropTemplate")
    copyBox:SetSize(420, 92)
    copyBox:SetPoint("CENTER", 0, 120)
    copyBox:SetFrameStrata("FULLSCREEN_DIALOG")
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

-- ---------------------------------------------------------------- info tab

--- A simple vertical stack of text and widgets.
local function stack(parent, width)
  local s = { parent = parent, last = nil, width = width }
  function s:add(region, gap)
    region:ClearAllPoints()
    if self.last then
      region:SetPoint("TOPLEFT", self.last, "BOTTOMLEFT", 0, -(gap or 6))
    else
      region:SetPoint("TOPLEFT", self.parent, "TOPLEFT", 16, -14)
    end
    self.last = region
    return region
  end
  function s:text(font, gap)
    local fs = self.parent:CreateFontString(nil, "OVERLAY", font or "GameFontHighlightSmall")
    fs:SetWidth(self.width)
    fs:SetJustifyH("LEFT")
    return self:add(fs, gap)
  end
  return s
end

local function checkbox(parent, key, label)
  local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
  cb:SetSize(24, 24)
  cb.label = cb:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  cb.label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
  cb.label:SetText(label)
  cb.key = key
  cb:SetScript("OnClick", function(self)
    ns:SetSetting(key, self:GetChecked() and true or false)
  end)
  return cb
end

local function createInfo(parent)
  local info = CreateFrame("Frame", nil, parent)
  info:SetAllPoints(parent)
  local s = stack(info, WIDTH - 60)
  s:text("GameFontNormal"):SetText("This data")
  info.data = s:text(nil, 4)
  info.data2 = s:text(nil, 2)
  s:text("GameFontNormal", 16):SetText("Fresh data for your specs")
  s:text(nil, 4):SetText(
    "The free Keystone Lens desktop app for Windows finds the top Mythic+ players of each spec and writes their talents and gear for this addon. It keeps your characters' specs up to date, and has more: filters, inspecting players, damage and raid data. New data loads when you log in or /reload."
  )
  local link = CreateFrame("Button", nil, info, "UIPanelButtonTemplate")
  link:SetSize(220, 22)
  link:SetText("github.com/mlvgog/keystone-lens")
  link:SetScript("OnClick", function()
    ns.ShowCopyBox(ns.APP_URL, "Keystone Lens app")
  end)
  s:add(link, 6)
  s:text("GameFontNormal", 16):SetText("Settings")
  info.checks = {
    checkbox(info, "overlay", "Pick rates on the talent window"),
    checkbox(info, "tooltips", "Popularity on item tooltips"),
  }
  for _, cb in ipairs(info.checks) do
    s:add(cb, 2)
  end
  s:text("GameFontNormal", 12):SetText("Commands")
  s:text(nil, 4):SetText("/kl: this window · /kl talents · /kl tooltips · /kl status · /kl options")
  s:text("GameFontNormal", 16):SetText("Sources")
  s:text("GameFontDisableSmall", 4):SetText("Players, keys, talents, gear and races: raider.io (via the app). Racial abilities: the game's data via SimulationCraft. Not affiliated with Blizzard Entertainment or raider.io.")
  return info
end

local function renderInfo(info, rec, source)
  for _, cb in ipairs(info.checks) do
    cb:SetChecked(ns:Setting(cb.key))
  end
  if not rec then
    info.data:SetText(ns:NeedsUpdate() and "The data was written for a newer version of this addon. Update Keystone Lens." or "No data for this spec yet.")
    info.data2:SetText("")
    return
  end
  local region = rec.region == "world" and "World" or string.upper(rec.region or "")
  info.data:SetText(string.format("Top %d %s %ss · %s%s%s", rec.sample or 0, rec.spec or "", rec.class or "", region,
    rec.season and (" · " .. rec.season) or "", rec.patch and (" · patch " .. rec.patch) or ""))
  info.data2:SetText(string.format("%s %s. %d of %d dungeons have their own builds.",
    source == "app" and "From the Keystone Lens app," or "Bundled with the addon,", ns.Ago(rec.time),
    #ns.LoadedDungeons(rec), #(rec.dungeonList or {})))
end

-- ---------------------------------------------------------------- window

local function available()
  return ns:AvailableSpecs()
end

local function pickSpec()
  local list = available()
  for _, s in ipairs(list) do
    if s.specID == view.specID then
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
  view.specID = list[1] and list[1].specID or mine
  return list[1]
end

local function specIcon(specID)
  local icon = specID and select(4, GetSpecializationInfoByID(specID))
  return icon or "Interface\\Icons\\inv_relics_hourglass"
end

function ns:RenderPanel()
  if not panel or not panel:IsShown() then
    return
  end
  local spec = pickSpec()
  local rec = spec and spec.rec
  if rec then
    self:ResolveZone(rec)
  end
  if panel.SetTitle then
    panel:SetTitle(rec and string.format("Keystone Lens · %s %s", rec.spec or "", rec.class or "") or "Keystone Lens")
  end
  if panel.SetPortraitToAsset then
    panel:SetPortraitToAsset(specIcon(view.specID))
  end

  local specs = available()
  panel.specMenu:SetShown(#specs > 1)
  panel.zoneMenu:ClearAllPoints()
  if #specs > 1 then
    panel.zoneMenu:SetPoint("LEFT", panel.specMenu, "RIGHT", 12, 0)
  else
    panel.zoneMenu:SetPoint("TOPLEFT", panel, "TOPLEFT", 66, -30)
  end
  panel.zoneMenu:SetShown(rec ~= nil and #ns.LoadedDungeons(rec) > 0)
  for _, dd in ipairs({ panel.specMenu, panel.zoneMenu }) do
    if dd.GenerateMenu then
      dd:GenerateMenu()
    end
  end

  if PanelTemplates_SetTab then
    PanelTemplates_SetTab(panel, view.tab)
  end
  panel.overview:SetShown(view.tab == 1)
  panel.info:SetShown(view.tab == 2)
  if view.tab == 1 then
    ns.RenderGear(panel.overview, rec, view.specID)
    if not rec then
      panel.overview.empty:SetText(ns:NeedsUpdate() and "The data was written for a newer version of this addon. Update Keystone Lens."
        or "No data yet.\n\nThis addon shows data from the free Keystone Lens desktop app: look at your spec in the app (or let it keep your characters' specs fresh), then /reload. See the Info tab.")
    end
  else
    renderInfo(panel.info, rec, spec and spec.source)
  end
  self:RenderBuilds(view.specID, rec)

  if rec then
    panel.footer:SetText((spec.source == "app" and "From the Keystone Lens app · " or "Bundled data · ") .. ns.Ago(rec.time) .. " · /reload loads new data")
  else
    panel.footer:SetText("")
  end
end

local function createDropdown(parent, width)
  local dd = CreateFrame("DropdownButton", nil, parent, "WowStyle1DropdownTemplate")
  dd:SetWidth(width)
  return dd
end

local function createPanel()
  panel = CreateFrame("Frame", "KeystoneLensFrame", UIParent, "ButtonFrameTemplate")
  panel:SetSize(WIDTH, HEIGHT)
  panel:SetPoint("CENTER", -140, 20)
  panel:SetFrameStrata("HIGH")
  panel:SetToplevel(true)
  panel:SetMovable(true)
  panel:SetClampedToScreen(true)
  panel:EnableMouse(true)
  panel:RegisterForDrag("LeftButton")
  panel:SetScript("OnDragStart", panel.StartMoving)
  panel:SetScript("OnDragStop", panel.StopMovingOrSizing)
  panel:Hide()
  tinsert(UISpecialFrames, "KeystoneLensFrame") -- Escape closes it

  -- Spec and dungeon pickers in the title area, right of the portrait.
  panel.specMenu = createDropdown(panel, 190)
  panel.specMenu:SetPoint("TOPLEFT", panel, "TOPLEFT", 66, -30)
  panel.specMenu:SetupMenu(function(_, root)
    for _, s in ipairs(available()) do
      root:CreateRadio(string.format("%s %s", s.rec.spec or "?", s.rec.class or "?"), function()
        return view.specID == s.specID
      end, function()
        view.specID = s.specID
        ns:ResetState()
      end)
    end
  end)

  panel.zoneMenu = createDropdown(panel, 200)
  if panel.zoneMenu.SetDefaultText then
    panel.zoneMenu:SetDefaultText("All dungeons")
  end
  panel.zoneMenu:SetupMenu(function(_, root)
    local spec = pickSpec()
    if not spec then
      return
    end
    root:CreateRadio("All dungeons", function()
      return ns.state.zoneID == nil
    end, function()
      ns:SetZone(nil)
    end)
    for _, d in ipairs(ns.LoadedDungeons(spec.rec)) do
      root:CreateRadio(d.name, function()
        return ns.state.zoneID == d.id
      end, function()
        ns:SetZone(d.id)
      end)
    end
  end)

  panel.buildsButton = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
  panel.buildsButton:SetSize(90, 22)
  panel.buildsButton:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -12, -31)
  panel.buildsButton:SetText("Builds")
  panel.buildsButton:SetScript("OnClick", function()
    ns:ToggleBuildPane()
  end)

  local inset = panel.Inset or panel
  panel.overview = ns.CreateGearView(inset)
  panel.info = createInfo(inset)

  panel.footer = panel:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  panel.footer:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", 14, 8)
  panel.footer:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -14, 8)
  panel.footer:SetJustifyH("LEFT")

  -- Tabs under the window, like the character frame's.
  for i, label in ipairs({ "Overview", "Info" }) do
    local tab = CreateFrame("Button", nil, panel, "PanelTabButtonTemplate")
    tab:SetID(i)
    tab:SetText(label)
    tab:SetScript("OnClick", function()
      view.tab = i
      ns:RenderPanel()
    end)
    if i == 1 then
      tab:SetPoint("TOPLEFT", panel, "BOTTOMLEFT", 12, 2)
    end
    panel.tabs = panel.tabs or {}
    panel.tabs[i] = tab
  end
  if PanelTemplates_SetNumTabs then
    PanelTemplates_SetNumTabs(panel, 2)
  end

  ns.CreateBuildPane(panel)

  panel:SetScript("OnShow", function()
    view.specID = ns.PlayerSpecID()
    ns:RenderPanel()
  end)
  panel:SetScript("OnHide", function()
    ns.HideFlyout()
    ns.HideRacials()
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

-- Redraw after the current click is handled (a dropdown is not rebuilt inside its own menu).
local renderQueued = false
local function renderSoon()
  if renderQueued then
    return
  end
  renderQueued = true
  C_Timer.After(0, function()
    renderQueued = false
    ns:RenderPanel()
  end)
end
ns:Listen("STATE_CHANGED", renderSoon)
ns:Listen("SETTING_CHANGED", renderSoon)

-- Item names, icons and qualities arrive from the server a moment later: redraw once they have.
local redrawQueued = false
ns:On("GET_ITEM_INFO_RECEIVED", function()
  if redrawQueued or not panel or not panel:IsShown() then
    return
  end
  redrawQueued = true
  C_Timer.After(0.3, function()
    redrawQueued = false
    ns:RenderPanel()
  end)
end)
ns:On("PLAYER_EQUIPMENT_CHANGED", renderSoon)
ns:On("TRAIT_CONFIG_UPDATED", renderSoon)

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

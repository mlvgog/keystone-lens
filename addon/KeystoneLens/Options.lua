-- Keystone Lens: the page in the game's Settings (Options > AddOns > Keystone Lens).
local _, ns = ...

local options = CreateFrame("Frame")
options.name = ns.title
options:Hide()

local function checkbox(key, label, description, y)
  local cb = CreateFrame("CheckButton", nil, options, "UICheckButtonTemplate")
  cb:SetPoint("TOPLEFT", 16, y)
  local text = options:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  text:SetPoint("LEFT", cb, "RIGHT", 4, 1)
  text:SetText(label)
  local desc = options:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  desc:SetPoint("TOPLEFT", text, "BOTTOMLEFT", 0, -2)
  desc:SetWidth(520)
  desc:SetJustifyH("LEFT")
  desc:SetTextColor(0.7, 0.7, 0.7)
  desc:SetText(description)
  cb:SetScript("OnClick", function(self)
    ns:SetSetting(key, self:GetChecked() and true or false)
  end)
  cb.key = key
  return cb
end

local boxes = {}

local function build()
  local title = options:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 16, -16)
  title:SetText(ns.title .. " " .. ns.version)
  local sub = options:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  sub:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -6)
  sub:SetText("What the top Mythic+ players of your spec run. Type /kl for the window.")

  boxes[#boxes + 1] = checkbox("overlay", "Pick rates on the talent window", "Shows how many top players take each talent, and frames the popular talents you skip (red) and the rare ones you take (orange).", -70)
  boxes[#boxes + 1] = checkbox("tooltips", "Popularity on item tooltips", "Adds a line to item tooltips when the top players of your spec use the item.", -130)

  local data = options:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  data:SetPoint("TOPLEFT", 16, -200)
  data:SetText("Data")
  options.dataText = options:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  options.dataText:SetPoint("TOPLEFT", data, "BOTTOMLEFT", 0, -6)
  options.dataText:SetWidth(540)
  options.dataText:SetJustifyH("LEFT")

  local app = options:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  app:SetPoint("TOPLEFT", options.dataText, "BOTTOMLEFT", 0, -14)
  app:SetWidth(540)
  app:SetJustifyH("LEFT")
  app:SetText("The data comes from the free Keystone Lens desktop app for Windows (" .. ns.APP_URL .. "). It writes the data for this addon and keeps your characters' specs up to date. New data loads when you log in or /reload.")
end

options:SetScript("OnShow", function()
  if not options.built then
    options.built = true
    build()
  end
  for _, cb in ipairs(boxes) do
    cb:SetChecked(ns:Setting(cb.key))
  end
  local specs = ns:AvailableSpecs()
  local parts = {}
  for _, s in ipairs(specs) do
    parts[#parts + 1] = string.format("%s %s (%s)", s.rec.spec or "?", s.rec.class or "?", ns.Ago(s.rec.time))
  end
  options.dataText:SetText(#parts > 0 and table.concat(parts, ", ") or "No data loaded yet.")
end)

if Settings and Settings.RegisterCanvasLayoutCategory then
  local category = Settings.RegisterCanvasLayoutCategory(options, ns.title)
  Settings.RegisterAddOnCategory(category)
  ns.optionsCategory = category
end

ns:Listen("OPEN_OPTIONS", function()
  if ns.optionsCategory and Settings and Settings.OpenToCategory then
    Settings.OpenToCategory(ns.optionsCategory:GetID())
  end
end)

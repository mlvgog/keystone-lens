-- Keystone Lens: namespace, saved settings, events and slash commands.
local addonName, ns = ...

ns.name = addonName
ns.title = "Keystone Lens"
ns.APP_URL = "https://github.com/mlvgog/keystone-lens"
ns.version = (C_AddOns and C_AddOns.GetAddOnMetadata and C_AddOns.GetAddOnMetadata(addonName, "Version")) or "?"

local DEFAULTS = {
  overlay = true, -- pick rates on the talent window
  tooltips = true, -- popularity line on item tooltips
  popular = 0.75, -- a talent this popular that you skip gets a red frame
  rare = 0.25, -- a talent you pick that is this rare gets an orange frame
}

-- ---------------------------------------------------------------- saved variables

function ns:InitDB()
  if type(KeystoneLensDB) ~= "table" then
    KeystoneLensDB = {}
  end
  local db = KeystoneLensDB
  db.schema = 1
  if type(db.settings) ~= "table" then
    db.settings = {}
  end
  for k, v in pairs(DEFAULTS) do
    if db.settings[k] == nil then
      db.settings[k] = v
    end
  end
  if type(db.characters) ~= "table" then
    db.characters = {}
  end
  self.db = db
end

function ns:Setting(key)
  local s = self.db and self.db.settings
  if s and s[key] ~= nil then
    return s[key]
  end
  return DEFAULTS[key]
end

function ns:SetSetting(key, value)
  self.db.settings[key] = value
  self:Fire("SETTING_CHANGED", key, value)
end

-- ---------------------------------------------------------------- events

local frame = CreateFrame("Frame")
local handlers = {} -- game events
local callbacks = {} -- the addon's own messages

local function report(err)
  local handler = geterrorhandler and geterrorhandler()
  if handler then
    handler(err)
  else
    print(err)
  end
end

-- Runs fn; an error is reported without stopping the other handlers.
function ns.SafeCall(fn, ...)
  local n = select("#", ...)
  local args = { ... }
  return xpcall(function()
    return fn(unpack(args, 1, n))
  end, report)
end

function ns:On(event, fn)
  if not handlers[event] then
    handlers[event] = {}
    frame:RegisterEvent(event)
  end
  table.insert(handlers[event], fn)
end

function ns:Listen(message, fn)
  callbacks[message] = callbacks[message] or {}
  table.insert(callbacks[message], fn)
end

function ns:Fire(message, ...)
  for _, fn in ipairs(callbacks[message] or {}) do
    ns.SafeCall(fn, ...)
  end
end

frame:SetScript("OnEvent", function(_, event, ...)
  for _, fn in ipairs(handlers[event] or {}) do
    ns.SafeCall(fn, event, ...)
  end
end)

ns:On("ADDON_LOADED", function(_, name)
  if name == addonName then
    ns:InitDB()
    ns:Fire("DB_READY")
  end
end)

ns:On("PLAYER_LOGIN", function()
  ns:Fire("LOGIN")
end)

-- ---------------------------------------------------------------- helpers

function ns.Print(...)
  print("|cffffd100Keystone Lens|r:", ...)
end

--- 0.734 -> "73%"
function ns.Pct(x)
  return string.format("%d%%", math.floor((x or 0) * 100 + 0.5))
end

--- Seconds since an epoch time as "3 hours ago".
function ns.Ago(t, now)
  if not t or t == 0 then
    return "unknown"
  end
  local mins = math.floor(((now or time()) - t) / 60 + 0.5)
  if mins < 2 then
    return "just now"
  elseif mins < 90 then
    return mins .. " minutes ago"
  end
  local hours = math.floor(mins / 60 + 0.5)
  if hours < 36 then
    return hours .. " hours ago"
  end
  return math.floor(hours / 24 + 0.5) .. " days ago"
end

-- ---------------------------------------------------------------- slash commands and the addon compartment

SLASH_KEYSTONELENS1 = "/kl"
SLASH_KEYSTONELENS2 = "/keystonelens"
SlashCmdList.KEYSTONELENS = function(msg)
  local cmd = string.lower(strtrim and strtrim(msg or "") or (msg or ""))
  if cmd == "" or cmd == "show" then
    ns:Fire("TOGGLE_PANEL")
  elseif cmd == "talents" then
    ns:SetSetting("overlay", not ns:Setting("overlay"))
    ns.Print("talent pick rates", ns:Setting("overlay") and "on" or "off")
  elseif cmd == "tooltips" then
    ns:SetSetting("tooltips", not ns:Setting("tooltips"))
    ns.Print("item tooltips", ns:Setting("tooltips") and "on" or "off")
  elseif cmd == "options" or cmd == "config" then
    ns:Fire("OPEN_OPTIONS")
  elseif cmd == "status" then
    ns:Fire("PRINT_STATUS")
  else
    ns.Print("/kl: open the window · /kl talents, /kl tooltips: turn them on or off · /kl options · /kl status")
  end
end

function KeystoneLens_OnAddonCompartmentClick()
  ns:Fire("TOGGLE_PANEL")
end

function KeystoneLens_OnAddonCompartmentEnter(_, button)
  GameTooltip:SetOwner(button or UIParent, "ANCHOR_LEFT")
  GameTooltip:AddLine(ns.title)
  GameTooltip:AddLine("Click to see what the top Mythic+ players of your spec run.", 1, 1, 1, true)
  GameTooltip:Show()
end

function KeystoneLens_OnAddonCompartmentLeave()
  GameTooltip:Hide()
end

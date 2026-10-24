-- Keystone Lens: a line on item tooltips saying how popular the item is with the top players
-- of your spec.
local _, ns = ...

local GROUP_NAMES = {
  head = "head item", neck = "neck", shoulder = "shoulder item", back = "cloak", chest = "chest item",
  wrist = "wrist item", hands = "hands item", waist = "belt", legs = "legs item", feet = "boots",
  rings = "ring", trinkets = "trinket", mainhand = "main hand", offhand = "off hand",
}

local function ordinal(n)
  local tens = n % 100
  if tens >= 11 and tens <= 13 then
    return n .. "th"
  end
  local last = n % 10
  return n .. (last == 1 and "st" or last == 2 and "nd" or last == 3 and "rd" or "th")
end

--- Where an item is in the data: slot group, entry, rank in that group.
function ns.ItemUsage(rec, itemID)
  for group, items in pairs(rec.gear or {}) do
    for rank, it in ipairs(items) do
      if it.id == itemID then
        return group, it, rank
      end
    end
  end
  return nil
end

local function plural(rec)
  return (rec.spec or "") .. " " .. (rec.class or "") .. "s"
end

--- The tooltip text for an item, or nil when the top players don't use it.
function ns.ItemTooltipLine(rec, itemID)
  local sample = rec.sample or 0
  if sample == 0 then
    return nil
  end
  local group, it, rank = ns.ItemUsage(rec, itemID)
  if it then
    local text = string.format("Keystone Lens: %s of the top %d %s", ns.Pct(it.n / sample), sample, plural(rec))
    if rank == 1 then
      return text .. " · most used " .. (GROUP_NAMES[group] or group)
    end
    return text .. " · " .. ordinal(rank) .. " most used " .. (GROUP_NAMES[group] or group)
  end
  for i, gem in ipairs(rec.gems or {}) do
    if gem.id == itemID then
      return string.format("Keystone Lens: %s most used gem of the top %d %s", i == 1 and "the" or ordinal(i), sample, plural(rec))
    end
  end
  return nil
end

local function onItemTooltip(tooltip, data)
  if not ns.db or not ns:Setting("tooltips") then
    return
  end
  if tooltip ~= GameTooltip and tooltip ~= ItemRefTooltip then
    return
  end
  local itemID = data and data.id
  if not itemID or (issecretvalue and issecretvalue(itemID)) then
    return
  end
  local rec = ns:GetSpecData(ns.PlayerSpecID() or 0)
  local line = rec and ns.ItemTooltipLine(rec, itemID)
  if line then
    tooltip:AddLine(line, 1, 0.82, 0, true)
  end
end

if TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall and Enum and Enum.TooltipDataType then
  TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Item, function(tooltip, data)
    ns.SafeCall(onItemTooltip, tooltip, data)
  end)
end

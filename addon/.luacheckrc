-- luacheck configuration for the Keystone Lens addon (WoW runs Lua 5.1).
std = "lua51"
max_line_length = false
unused_args = false

-- Globals the addon defines.
globals = {
  "KeystoneLensDB",
  "SLASH_KEYSTONELENS1",
  "SLASH_KEYSTONELENS2",
  "SlashCmdList",
  "KeystoneLens_OnAddonCompartmentClick",
  "KeystoneLens_OnAddonCompartmentEnter",
  "KeystoneLens_OnAddonCompartmentLeave",
}

-- Game API and Blizzard UI the addon reads.
read_globals = {
  "C_AddOns", "C_ChallengeMode", "C_ClassTalents", "C_CreatureInfo", "C_Item", "C_MythicPlus", "C_Spell", "C_Texture",
  "C_Timer", "C_Traits", "UnitSex",
  "CreateFrame", "Enum", "EventUtil", "GameTooltip", "GameTooltip_Hide", "GetAverageItemLevel", "GetCombatRating",
  "GetCurrentRegion", "GetInventoryItemID", "GetInventoryItemLink", "GetRealmName", "GetSpecialization",
  "GetSpecializationInfo", "GetSpecializationInfoByID", "InCombatLockdown", "ItemRefTooltip", "PlayerSpellsFrame",
  "PlayerUtil", "Settings", "TooltipDataProcessor", "UIParent", "UISpecialFrames", "UnitClass", "UnitLevel",
  "UnitName", "UnitRace", "date", "geterrorhandler", "hooksecurefunc", "issecretvalue", "strtrim", "time",
  "tinsert", "GameFontHighlightSmall", "GameFontNormal", "GameFontNormalSmall",
  "BreakUpLargeNumbers", "ButtonFrameTemplate_HidePortrait", "GetCombatRatingBonusForCombatRatingValue",
  "GetInventorySlotInfo", "GetItemStats", "GetMasteryEffect", "PanelTemplates_SetNumTabs", "PanelTemplates_SetTab",
  "PlayerSpellsUtil", "SetItemButtonQuality", "SetItemButtonTexture",
  "KeystoneLensAppData", "KeystoneLensBundledData",
}

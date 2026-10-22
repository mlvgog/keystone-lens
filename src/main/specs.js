'use strict';

const CLASS_INFO = {
  'Death Knight': { color: '#C41E3A', icon: 'classicon_deathknight' },
  'Demon Hunter': { color: '#A330C9', icon: 'classicon_demonhunter' },
  Druid: { color: '#FF7C0A', icon: 'classicon_druid' },
  Evoker: { color: '#33937F', icon: 'classicon_evoker' },
  Hunter: { color: '#AAD372', icon: 'classicon_hunter' },
  Mage: { color: '#3FC7EB', icon: 'classicon_mage' },
  Monk: { color: '#00FF98', icon: 'classicon_monk' },
  Paladin: { color: '#F48CBA', icon: 'classicon_paladin' },
  Priest: { color: '#FFFFFF', icon: 'classicon_priest' },
  Rogue: { color: '#FFF468', icon: 'classicon_rogue' },
  Shaman: { color: '#0070DD', icon: 'classicon_shaman' },
  Warlock: { color: '#8788EE', icon: 'classicon_warlock' },
  Warrior: { color: '#C69B6D', icon: 'classicon_warrior' },
};

// specId -> [icon, role]
const SPEC_INFO = {
  250: ['spell_deathknight_bloodpresence', 'tank'],
  251: ['spell_deathknight_frostpresence', 'dps'],
  252: ['spell_deathknight_unholypresence', 'dps'],
  577: ['ability_demonhunter_specdps', 'dps'],
  581: ['ability_demonhunter_spectank', 'tank'],
  1480: ['classicon_demonhunter_void', 'dps'],
  102: ['spell_nature_starfall', 'dps'],
  103: ['ability_druid_catform', 'dps'],
  104: ['ability_racial_bearform', 'tank'],
  105: ['spell_nature_healingtouch', 'healer'],
  1467: ['classicon_evoker_devastation', 'dps'],
  1468: ['classicon_evoker_preservation', 'healer'],
  1473: ['classicon_evoker_augmentation', 'dps'],
  253: ['ability_hunter_bestialdiscipline', 'dps'],
  254: ['ability_hunter_focusedaim', 'dps'],
  255: ['ability_hunter_camouflage', 'dps'],
  62: ['spell_holy_magicalsentry', 'dps'],
  63: ['spell_fire_firebolt02', 'dps'],
  64: ['spell_frost_frostbolt02', 'dps'],
  268: ['spell_monk_brewmaster_spec', 'tank'],
  270: ['spell_monk_mistweaver_spec', 'healer'],
  269: ['spell_monk_windwalker_spec', 'dps'],
  65: ['spell_holy_holybolt', 'healer'],
  66: ['ability_paladin_shieldofthetemplar', 'tank'],
  70: ['spell_holy_auraoflight', 'dps'],
  256: ['spell_holy_powerwordshield', 'healer'],
  257: ['spell_holy_guardianspirit', 'healer'],
  258: ['spell_shadow_shadowwordpain', 'dps'],
  259: ['ability_rogue_deadlybrew', 'dps'],
  260: ['ability_rogue_waylay', 'dps'],
  261: ['ability_stealth', 'dps'],
  262: ['spell_nature_lightning', 'dps'],
  263: ['spell_shaman_improvedstormstrike', 'dps'],
  264: ['spell_nature_magicimmunity', 'healer'],
  265: ['spell_shadow_deathcoil', 'dps'],
  266: ['spell_shadow_metamorphosis', 'dps'],
  267: ['spell_shadow_rainoffire', 'dps'],
  71: ['ability_warrior_savageblow', 'dps'],
  72: ['ability_warrior_innerrage', 'dps'],
  73: ['ability_warrior_defensivestance', 'tank'],
};

/** "Beast Mastery" -> "beast-mastery" (raider.io slug format). */
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Class list with specs, derived from the talent tree data so new specs show up automatically. */
function buildClassList(talentData) {
  const classes = new Map();
  for (const tree of talentData) {
    if (!classes.has(tree.className)) {
      const info = CLASS_INFO[tree.className] || { color: '#FFFFFF', icon: 'inv_misc_questionmark' };
      classes.set(tree.className, {
        classId: tree.classId,
        className: tree.className,
        classSlug: slugify(tree.className),
        color: info.color,
        icon: info.icon,
        specs: [],
      });
    }
    const [icon, role] = SPEC_INFO[tree.specId] || [];
    const fallbackIcon = tree.specNodes?.find((n) => n.entryNode)?.entries?.[0]?.icon || 'inv_misc_questionmark';
    classes.get(tree.className).specs.push({
      specId: tree.specId,
      specName: tree.specName,
      specSlug: slugify(tree.specName),
      icon: icon || fallbackIcon,
      role: role || 'dps',
    });
  }
  return [...classes.values()].sort((a, b) => a.className.localeCompare(b.className));
}

module.exports = { buildClassList, slugify, CLASS_INFO };

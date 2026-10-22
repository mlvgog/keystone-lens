'use strict';

/**
 * Item facts for the gear views: where an item comes from and its type, from Wowhead's
 * documented item XML, plus raider.io gem names. Stats come from the game tables (sources/itemData).
 */

const GEM_STAT = { crit: 'crit', haste: 'haste', mast: 'mastery', mastery: 'mastery', vers: 'vers', versatility: 'vers' };
const PROFESSIONS = {
  164: 'Blacksmithing',
  165: 'Leatherworking',
  171: 'Alchemy',
  197: 'Tailoring',
  202: 'Engineering',
  333: 'Enchanting',
  755: 'Jewelcrafting',
  773: 'Inscription',
};
const OTHER_SOURCES = { 3: 'PvP', 4: 'Quest', 5: 'Vendor', 11: 'World event', 12: 'Achievement', 24: 'Shop' };
// Inventory types that occupy both hands (two-hand, ranged, ranged right).
const TWO_HAND_SLOTS = new Set([17, 15, 26]);

function emptyStats() {
  return { crit: 0, haste: 0, mastery: 0, vers: 0 };
}

/** Secondary stats from a raider.io gem name such as "16 Mast & 7 Crit". */
function gemStats(name) {
  const out = emptyStats();
  for (const m of String(name || '').matchAll(/(\d+)\s*(Crit|Haste|Mastery|Mast|Versatility|Vers)\b/gi)) {
    out[GEM_STAT[m[2].toLowerCase()]] += Number(m[1]);
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(text) {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (m, e) => {
    if (ENTITIES[e.toLowerCase()] !== undefined) return ENTITIES[e.toLowerCase()];
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return m;
  });
}

/** Markup -> text lines. */
function htmlLines(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(tr|div|table|p|li)>/gi, '\n')
      .replace(/<\/(td|th)>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Wowhead's documented item XML (www.wowhead.com/item=ID&xml, English):
 * { source: [codes], more: [...], slot, slotType, droppedBy, name, quality, icon, itemSet }.
 */
function parseItemXml(xml) {
  const text = String(xml || '');
  const out = { source: [], more: [], slot: null, slotType: null, droppedBy: null, name: null, quality: null, icon: null, itemSet: null };
  out.name = /<name><!\[CDATA\[([\s\S]*?)\]\]><\/name>/.exec(text)?.[1] ?? null;
  const quality = /<quality id="(\d+)"/.exec(text);
  out.quality = quality ? Number(quality[1]) : null;
  out.icon = /<icon[^>]*>([^<]+)<\/icon>/.exec(text)?.[1].trim().toLowerCase() || null;
  const itemSet = /<jsonEquip><!\[CDATA\[[\s\S]*?"itemset":(\d+)/.exec(text);
  out.itemSet = itemSet ? Number(itemSet[1]) : null;
  const json = /<json><!\[CDATA\[([\s\S]*?)\]\]><\/json>/.exec(text);
  if (json) {
    try {
      const data = JSON.parse(`{${json[1]}}`);
      out.source = data.source || [];
      out.more = data.sourcemore || [];
      out.slot = data.slot ?? null;
    } catch {
      // keep the empty source
    }
  }
  const tooltip = /<htmlTooltip><!\[CDATA\[([\s\S]*?)\]\]><\/htmlTooltip>/.exec(text)?.[1] || '';
  // "Head | Leather", or just "Back" for cloaks, necks and rings.
  const slotRow = /<table width="100%"><tr><td>([\s\S]*?)<\/td>(?:<th>([\s\S]*?)<\/th>)?/.exec(tooltip);
  if (slotRow) out.slotType = htmlLines(`${slotRow[1]} ${slotRow[2] || ''}`).join(' ') || null;
  const boss = /Dropped by:\s*([^<]+)</i.exec(tooltip);
  out.droppedBy = boss ? decodeEntities(boss[1]).trim() : null;
  return out;
}

/**
 * Where an item comes from, as a short tag:
 * { kind: 'tier'|'crafted'|'mplus'|'raid'|'dungeon'|'drop'|<other>|'other', label, detail }.
 * `seasonDungeons` / `raids` map zone ids (wowhead "z" == raider.io dungeon / raid id).
 */
function classifySource({ tier = false, src = {}, boss = null, seasonDungeons = [], raids = [] }) {
  if (tier) return { kind: 'tier', label: 'Tier set', detail: null };
  const codes = src.source || [];
  const more = src.more || [];
  if (codes.includes(1)) {
    const skill = more.find((x) => x.s)?.s;
    return { kind: 'crafted', label: 'Crafted', detail: PROFESSIONS[skill] || null };
  }
  // Bosses are NPC entries (t: 1) in the item XML; the tooltip's "Dropped by" is the fallback.
  boss = more.find((x) => x.t === 1 && x.n)?.n || boss;
  const zones = more.map((x) => x.z).filter(Boolean);
  for (const z of zones) {
    const dungeon = seasonDungeons.find((d) => d.id === z);
    if (dungeon) return { kind: 'mplus', label: 'M+', detail: dungeon.name, boss };
    const raid = raids.find((r) => r.zoneId === z);
    if (raid) return { kind: 'raid', label: 'Raid', detail: raid.name, boss };
  }
  if (boss) {
    const raid = raids.find((r) => r.encounters.includes(boss));
    if (raid) return { kind: 'raid', label: 'Raid', detail: raid.name, boss };
  }
  if (codes.includes(2) || boss) return { kind: 'drop', label: 'Drop', detail: boss };
  const other = codes.map((c) => OTHER_SOURCES[c]).find(Boolean);
  if (other) return { kind: 'other', label: other, detail: null };
  return { kind: 'other', label: 'Other', detail: null };
}

function isTwoHandSlot(slot) {
  return TWO_HAND_SLOTS.has(slot);
}

module.exports = { gemStats, parseItemXml, classifySource, isTwoHandSlot, emptyStats };

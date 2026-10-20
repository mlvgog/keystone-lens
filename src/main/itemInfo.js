'use strict';

/**
 * Parsing of wowhead item data (English tooltips + item XML) into the facts the gear
 * summary needs: secondary stats, embellishments and where an item comes from.
 */

// <!--rtgNN--> markers in wowhead tooltips: rating ids of the secondary stats.
const RATING = { 32: 'crit', 36: 'haste', 49: 'mastery', 40: 'vers' };
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

/** Secondary stat ratings of an item tooltip. */
function parseStats(html) {
  const out = emptyStats();
  for (const m of String(html || '').matchAll(/<!--rtg(\d+)-->([\d,]+)/g)) {
    const key = RATING[m[1]];
    if (key) out[key] += Number(m[2].replace(/,/g, ''));
  }
  return out;
}

/** Secondary stats from a raider.io gem name such as "16 Mast & 7 Crit". */
function gemStats(name) {
  const out = emptyStats();
  for (const m of String(name || '').matchAll(/(\d+)\s*(Crit|Haste|Mastery|Mast|Versatility|Vers)\b/gi)) {
    out[GEM_STAT[m[2].toLowerCase()]] += Number(m[1]);
  }
  return out;
}

function isEmbellished(html) {
  return /Embellished/i.test(String(html || ''));
}

/** Boss name from the tooltip's "Dropped by: X" line. */
function droppedBy(html) {
  const m = /Dropped by:\s*([^<]+)</i.exec(String(html || ''));
  return m ? m[1].trim() : null;
}

/** `{ source: [codes], more: [...], slot }` from wowhead's item XML. */
function parseSourceXml(xml) {
  const m = /<json><!\[CDATA\[([\s\S]*?)\]\]><\/json>/.exec(String(xml || ''));
  if (!m) return { source: [], more: [], slot: null };
  try {
    const data = JSON.parse(`{${m[1]}}`);
    return { source: data.source || [], more: data.sourcemore || [], slot: data.slot ?? null };
  } catch {
    return { source: [], more: [], slot: null };
  }
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

module.exports = { parseStats, gemStats, isEmbellished, droppedBy, parseSourceXml, classifySource, isTwoHandSlot, emptyStats };

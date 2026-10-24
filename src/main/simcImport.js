'use strict';

const { parseSimc } = require('./simc');
const { decodeLoadout, loadoutSpecId } = require('./loadout');
const { isTwoHandSlot } = require('./itemInfo');
const talentTrees = require('./sources/talentTrees');
const itemData = require('./sources/itemData');
const wowhead = require('./sources/wowhead');
const raiderio = require('./sources/raiderio');
const { raceOf } = require('./races');
const { characterStatProfile } = require('./gearSummary');
const { gemLabel } = require('./raid');

const EQUIPPED = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'finger1', 'finger2', 'trinket1', 'trinket2', 'mainhand', 'offhand'];

function importError(message) {
  const err = new Error(message);
  err.code = 'BAD_SIMC';
  return err;
}

/** "tarren-mill" -> "Tarren Mill" via the region's realm list (or a best guess). */
async function realmName(region, slug, { signal } = {}) {
  try {
    const realms = await raiderio.getRealms(region, { signal });
    const hit = realms.find((r) => raiderio.slugifyRealm(r.name) === slug);
    if (hit) return hit.name;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
  }
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Equipped item level as the game shows it: 16 slots, a two-hander counting for both hands. */
function averageItemLevel(items) {
  const main = items.mainhand;
  const twoHander = main && !items.offhand && main.twoHand;
  const levels = EQUIPPED.map((slot) => (slot === 'offhand' && twoHander ? main.ilvl : items[slot]?.ilvl || 0));
  const sum = levels.reduce((s, v) => s + v, 0);
  return sum ? sum / EQUIPPED.length : null;
}

/**
 * Your character from a SimulationCraft export, in the shape raiderio.getCharacter returns
 * (plus source: 'simc', loadouts and the chosen loadout). `loadout` picks the talents: 0 = the
 * active ones, 1.. = the saved loadouts listed in the export.
 */
async function importSimcCharacter(text, { loadout = 0, signal } = {}) {
  const simc = parseSimc(text);
  const loadouts = [{ name: 'Active talents', talents: simc.talents }, ...simc.loadouts];
  const chosen = loadouts[loadout] ? loadout : 0;
  const talentText = loadouts[chosen].talents;

  const trees = await talentTrees.getTalentData({ signal });
  let specId;
  try {
    specId = loadoutSpecId(talentText);
  } catch (err) {
    throw importError(`The talent string in the export could not be read: ${err.message}`);
  }
  const tree = trees.find((t) => t.specId === specId);
  if (!tree) throw importError('The export is for a spec this app does not know yet.');
  if (tree.className !== simc.className) throw importError(`The talents are for ${tree.specName} ${tree.className}, but the character is a ${simc.className}.`);
  const decoded = decodeLoadout(talentText, tree);

  const variants = simc.items.map((it) => ({ key: it.slot, id: it.id, bonuses: it.bonuses, ilvl: it.ilvl, craftedStats: it.craftedStats, statsFrom: it.statsFrom }));
  const gemIds = [...new Set(simc.items.flatMap((it) => it.gemIds))];
  const [described, xml, realm, gemXml] = await Promise.all([
    itemData.describeVariants(variants.filter((v) => v.ilvl), { signal }),
    Promise.all(simc.items.map((it) => wowhead.getItemXml(it.id, { signal }))),
    realmName(simc.region, simc.realmSlug, { signal }),
    Promise.all(gemIds.map((id) => wowhead.getItemXml(id, { signal }))),
  ]);
  // Gem labels like "16 Mast & 7 Crit" (what the stat comparison reads, as for raider.io gems).
  const gemName = new Map(gemIds.map((id, i) => [id, gemLabel(gemXml[i]?.stats) || gemXml[i]?.name || null]));
  const items = {};
  simc.items.forEach((it, i) => {
    const info = xml[i] || {};
    const details = described[it.slot] || null;
    items[it.slot] = {
      id: it.id,
      ilvl: it.ilvl,
      name: it.name || info.name || `Item ${it.id}`,
      icon: info.icon || 'inv_misc_questionmark',
      quality: details?.quality ?? info.quality ?? 1,
      bonuses: it.bonuses,
      tier: info.itemSet ? String(info.itemSet) : null,
      enchants: it.enchantId ? [{ id: it.enchantId, name: null, icon: null }] : [],
      gems: it.gemIds.map((id) => ({ id, name: gemName.get(id) || null, icon: null })),
      twoHand: isTwoHandSlot(info.slot),
      details: details ? { ...details, slotType: info.slotType || null } : null,
    };
  });

  return {
    source: 'simc',
    name: simc.name,
    realm,
    realmSlug: simc.realmSlug,
    region: simc.region,
    className: simc.className,
    race: raceOf({ name: simc.race })?.name || null,
    activeSpecName: tree.specName,
    itemLevel: averageItemLevel(items),
    profileUrl: simc.region && simc.realmSlug ? raiderio.profileUrl({ region: simc.region, realmSlug: simc.realmSlug, name: simc.name }) : null,
    thumbnail: null,
    talents: { specId: decoded.specId, heroSubTreeId: decoded.heroSubTreeId, loadoutText: talentText, version: null, nodes: decoded.nodes },
    items,
    statProfile: characterStatProfile(items),
    loadouts: loadouts.map((l) => l.name),
    loadout: chosen,
  };
}

module.exports = { importSimcCharacter, averageItemLevel };

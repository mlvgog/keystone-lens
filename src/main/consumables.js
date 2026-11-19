'use strict';

// The consumables the top players use: flasks, food and augment runes. They come from the buffs
// Raider.IO records at each boss pull of runs logged with its client (raiderio.pullBuffs). That
// list also holds raid buffs and class auras; the game's own tables (wago.tools exports) tell which
// auras a flask or an augment rune gives, and food buffs are the "Well Fed" auras.
// Potions and weapon oils are not in Raider.IO's data.

const itemData = require('./sources/itemData');

const KINDS = [
  { key: 'flask', label: 'Flask' },
  { key: 'food', label: 'Food' },
  { key: 'rune', label: 'Augment rune' },
];

const CONSUMABLE = 0; // item class
const FLASK = 3; // consumable subclass "Flasks & Phials"
const OTHER = 8; // consumable subclass "Other" (augment runes, among others)
const MOD_RATING = 189; // aura type of a food's secondary stats; its misc value is a rating mask
// Combat rating bits (CR_*) per secondary stat.
const RATING_BITS = { Crit: [8, 9, 10], Haste: [17, 18, 19], Mastery: [25], Versatility: [29, 30] };

const isFood = (name) => /well fed/i.test(name || '');

/** "Haste", "Haste & Mastery", or "Primary stat" (feasts) from a food's rating masks. */
function foodStat(masks) {
  const stats = Object.entries(RATING_BITS)
    .filter(([, bits]) => masks.some((m) => bits.some((b) => (m >>> 0) & (2 ** b))))
    .map(([name]) => name);
  return stats.length ? stats.join(' & ') : 'Primary stat';
}

/**
 * What each aura is: { [spellId]: { kind, name, icon, items, stat } | null } (null: not a
 * consumable). `auras`: [{ id, name, icon }] as Raider.IO lists them. Cached per spell for a week.
 * deps.rows(table, column, ids) reads a wago.tools table (tests pass a stand-in).
 */
async function classifyAuras(auras, { signal, rows = itemData.rowsById, cachedById = itemData.cachedById } = {}) {
  const byId = new Map(auras.filter((a) => a?.id).map((a) => [Number(a.id), a]));
  return cachedById(
    'consumable',
    [...byId.keys()],
    async (missing, o) => {
      const opts = { signal, ...o };
      // Spell -> item effects -> items (several items can give the same buff: quality ranks).
      const effects = await rows('ItemEffect', 'SpellID', missing, opts);
      const spellOfEffect = new Map(effects.map((r) => [Number(r.ID), Number(r.SpellID)]));
      const links = spellOfEffect.size ? await rows('ItemXItemEffect', 'ItemEffectID', [...spellOfEffect.keys()], opts) : [];
      const itemsOfSpell = new Map();
      for (const l of links) {
        const spell = spellOfEffect.get(Number(l.ItemEffectID));
        if (!spell) continue;
        if (!itemsOfSpell.has(spell)) itemsOfSpell.set(spell, new Set());
        itemsOfSpell.get(spell).add(Number(l.ItemID));
      }
      const itemIds = [...new Set([...itemsOfSpell.values()].flatMap((s) => [...s]))];
      const itemRows = itemIds.length ? await rows('Item', 'ID', itemIds, opts) : [];
      const itemClass = new Map(itemRows.map((r) => [Number(r.ID), [Number(r.ClassID), Number(r.SubclassID)]]));
      // Item names of "Other" consumables: augment runes are named so.
      const otherIds = itemIds.filter((id) => {
        const c = itemClass.get(id);
        return c && c[0] === CONSUMABLE && c[1] === OTHER;
      });
      const sparse = otherIds.length ? await rows('ItemSparse', 'ID', otherIds, opts) : [];
      const itemName = new Map(sparse.map((r) => [Number(r.ID), String(r.Display_lang || '')]));
      // Food: which stats the buff raises.
      const foods = missing.filter((id) => isFood(byId.get(id)?.name) && !itemsOfSpell.has(id));
      const fx = foods.length ? await rows('SpellEffect', 'SpellID', foods, opts) : [];

      const out = {};
      for (const id of missing) {
        const aura = byId.get(id) || {};
        const items = [...(itemsOfSpell.get(id) || [])].sort((a, b) => a - b);
        const classes = items.map((i) => itemClass.get(i)).filter(Boolean);
        const base = { name: aura.name || null, icon: aura.icon || null, items };
        if (classes.some(([c, s]) => c === CONSUMABLE && s === FLASK)) {
          out[id] = { kind: 'flask', ...base };
        } else if (items.some((i) => /augment rune/i.test(itemName.get(i) || ''))) {
          const named = items.map((i) => itemName.get(i)).find((n) => /augment rune/i.test(n));
          out[id] = { kind: 'rune', ...base, name: named || base.name };
        } else if (foods.includes(id)) {
          const masks = fx.filter((r) => Number(r.SpellID) === id && Number(r.EffectAura) === MOD_RATING).map((r) => Number(r.EffectMiscValue_0) || 0);
          const stat = foodStat(masks);
          out[id] = { kind: 'food', ...base, stat, name: `${stat} food` };
        } else {
          out[id] = null;
        }
      }
      return out;
    },
    { signal }
  );
}

/** Every aura of the players' runs that has not been classified yet. */
function unclassifiedAuras(entries, known = {}) {
  const out = new Map();
  for (const d of entries) {
    for (const a of d?.buffs?.auras || []) {
      if (!(a.id in known) && !out.has(a.id)) out.set(a.id, a);
    }
  }
  return [...out.values()];
}

/**
 * The consumables of a group of players: `entries` are the players' runs ({ buffs } of
 * raiderio.pullBuffs, null for a run that was not logged), `info` = classifyAuras' result.
 * Each player counts once per kind, with the aura of that kind present at most of their pulls.
 * Returns { players: logged players, total: all players, incomplete, kinds: [{ key, label, used,
 * options: [{ id, name, icon, items, stat, count, share }] }] }. `incomplete`: some buffs could not
 * be told apart yet (the game tables could not be loaded), so the counts may be too low.
 */
function summarizeConsumables(entries, info = {}) {
  const logged = entries.filter((d) => d?.buffs?.pulls > 0);
  const players = logged.length;
  const incomplete = logged.some((d) => d.buffs.auras.some((a) => !(a.id in info)));
  const kinds = KINDS.map((k) => {
    const counts = new Map();
    let used = 0;
    for (const d of logged) {
      let best = null;
      for (const a of d.buffs.auras) {
        const c = info[a.id];
        if (c?.kind === k.key && (!best || a.pulls > best.pulls)) best = a;
      }
      if (!best) continue;
      used++;
      const c = info[best.id];
      // Foods with the same stats count together (several dishes give the same buff).
      const key = k.key === 'food' ? c.name : best.id;
      const entry = counts.get(key) || { ids: new Map(), count: 0 };
      entry.count++;
      entry.ids.set(best.id, (entry.ids.get(best.id) || 0) + 1);
      counts.set(key, entry);
    }
    const options = [...counts.values()]
      .map((e) => {
        const id = [...e.ids].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        const c = info[id];
        return { id, name: c.name, icon: c.icon, items: c.items || [], stat: c.stat || null, count: e.count, share: players ? e.count / players : 0 };
      })
      .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
    return { key: k.key, label: k.label, used, options };
  });
  return { players, total: entries.length, incomplete, kinds };
}

module.exports = { KINDS, classifyAuras, unclassifiedAuras, summarizeConsumables, foodStat };

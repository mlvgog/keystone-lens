# M+ Talent & Gear Inspector

A Windows desktop app, styled like a WoW addon, that shows what the top Mythic+ players of a retail spec are running.

## Features

### Talents
- The class, hero and spec trees are laid out like the in-game talent frame.
- Every node shows the % of players who picked it.
- Choice nodes show "left | right" percentages.
- Multi-rank and apex nodes show their most common rank.
- Hover a node for the full breakdown and the spell description.

### Popular builds
- Players running nearly the same build are grouped together, for example "Build 1 · Frostfire · 12 players".
- Each build lists what makes it different, and has a **Copy** button for its in-game import string.
- Click a build to show only its players. Nodes where the build differs from the majority get a dashed cyan ring.

### Filters
These sit under the title and apply to every tab.
- **Dungeon:** each player's best key in one dungeon. A dungeon is loaded the first time you pick it.
- **Hero tree:** only players on one hero tree.
- **Trends:** pick-rate changes compared with an earlier run of the same search, shown as ▲/▼ on talents and items plus a "Biggest changes" card.

### Gear
- For every slot: the items used and how many players use each one ("Item (49)").
- Each item shows its stats, upgrade track, effects, enchant and gem usage, and **where it drops** (M+ dungeon, raid, crafted plus profession, tier).
- Hover an item for its full in-game-style tooltip, with a side box of who uses it.
- Rings and trinkets are combined, counted once per player.
- **Overview cards:**
  - the secondary-stat profile from gear and gems
  - the top enchant per slot
  - gems and embellishments
  - tier usage per slot
  - weapon setups

### Players
- The ranked players and the key their data comes from.
- Sortable columns, search, region and minimum-key-level filters.
- **Copy build**, plus raider.io / Warcraft Logs / Armory links.
- Click a row to **inspect** that player: their own talent tree and gear.

### Compare with my character
- Enter your region, realm and name.
- Your talents are overlaid on the tree:
  - ✔ marks your picks.
  - A red ring marks a popular talent you skip.
  - An orange ring marks an unusual pick.
- Each gear slot shows your item and how popular it is.

### Other
- **Export:** save or copy the talent tree as an image, for example for Discord.
- **Settings (⚙):** tooltip language (9 languages), default region and player count, cache size and clear cache.
- **Reopening:** the app reopens your last results instantly. Recent searches show on the class picker.

## Running it

Requires [Node.js](https://nodejs.org) (v20+).

```bat
start.bat
```

`start.bat` installs the dependencies on first run, then launches the app. You can also run `npm install` and then `npm start`.

### Portable .exe

```bat
npm run dist
```

This builds `dist\MPlusTalentGearInspector-portable.exe`, a single file you can copy anywhere and double-click.

## How the data is chosen

1. **Who is sampled.** The top N players of the spec (default 50, region World by default) come from the raider.io character rankings for the current season.
2. **Where the data comes from.** For each player the app gathers their best key per dungeon and their 10 most recent keys. Raider.io stores a **snapshot of the player's talents and gear for every key** they ran.
3. **Which key is used.** The **current patch** is the newest game version seen in those snapshots (e.g. `12.1.0`). Each player is represented by their **highest-scoring key played on the current patch**.
   - If they have none on the current patch, their best key overall is used instead, and they are marked "older patch".
   - In the dungeon filter, the same rule is applied to each player's keys in that dungeon.
4. **Tuning hotfixes.** Mid-patch tuning hotfixes don't change the game version. To count only keys played after a hotfix, choose **"Keys since date…"** and pick the hotfix date.
5. **Skipped players.** Players with private or anonymised profiles, or without a key on this spec, are skipped. The next ranked player is used instead.

A cold run makes roughly 150–450 requests and usually takes 40 seconds to 3 minutes, depending on raider.io. Results are cached:

| Data | Cached for |
|---|---|
| Analyses (reopened instantly; **Refresh** fetches new data) | 1 hour |
| Key snapshots | forever (they never change) |
| Item and spell tooltips, item sources | 7 days |
| Talent trees | 1 day |

The cache lives in `%APPDATA%\M+ Talent & Gear Inspector\cache`, and you can clear it in Settings. Trend history is stored in `...\history` and settings in `...\settings.json`.

## Data sources

All public, no API key needed:

- [raider.io](https://raider.io): rankings, key history, talent and gear snapshots per key, your character, dungeon and raid lists.
- [raidbots](https://www.raidbots.com/static/data/live/talents.json): talent tree layout (positions, connections, icons).
- [Wowhead](https://www.wowhead.com): item stats for the exact item variant (bonus IDs and item level), talent descriptions, and item sources.

## Optional: the in-game font

Copy `FRIZQT__.TTF` (WoW's UI font) into `src/renderer/fonts/` to have headings use it. Without it, the bundled Marcellus font is used.

## Development

```bat
npm test
```

`npm test` runs the unit tests (`node:test`).

```bat
npm run icon
```

`npm run icon` regenerates `src/assets/icon.png`.

| File | Purpose |
|---|---|
| `src/main/collector.js` | Builds an analysis "session" (raw per-player data) and loads dungeons on demand |
| `src/main/views.js` | Filtered statistics for the UI (hero / dungeon / build / trends) |
| `src/main/selection.js` | Which key represents a player |
| `src/main/aggregate.js` | Talent and gear counting |
| `src/main/builds.js` | Popular builds (clustering) |
| `src/main/gearSummary.js` | Stat profile, enchants, gems, embellishments |
| `src/main/itemInfo.js` | Stats and source parsing |
| `src/main/history.js` | Trend snapshots |
| `src/main/settings.js` | Settings |
| `src/main/sources/` | raider.io / raidbots / Wowhead clients (rate limited, retried, cached) |
| `src/renderer/` | UI (plain HTML/CSS/ES modules) |

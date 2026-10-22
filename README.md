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
- Enter your region, realm and name. The realm field suggests realm names as you type (all realms of the region, including Korean and Chinese names).
- Characters you load are remembered: click one to load it again, or start typing its name. While comparing, opening another spec automatically loads your most recently used character of that class.
- Your talents are overlaid on the tree:
  - ✔ marks your picks.
  - A red ring marks a popular talent you skip.
  - An orange ring marks an unusual pick.
- Each gear slot shows your item and how popular it is.

### Damage (Warcraft Logs)
- Median **DPS** (or **HPS** for healing) of the spec in each dungeon, per key level, from logged keys on Warcraft Logs. Hover a cell for the average, the middle half of runs, the range, run time and how many runs it is based on. Cells with fewer than 5 runs are greyed out.
- **Columns by item level** instead of key level: the same numbers grouped by the players' equipped item level (needs each run's gear, so it downloads much more).
- **Your own runs** (when "Compare with my character" is on): every logged key of yours in the selected range, with the spec median at the same key level, the difference in %, and the share of other logged runs you beat. Your best run per key level also shows inside the table. Links open the log on Warcraft Logs.
- Numbers are per second over the whole key, like Details' "overall" segment. Per dungeon and key level, Warcraft Logs ranks up to 100 of the best-timed logged runs; players who log tend to be above average.

**Setup:** this needs your own free Warcraft Logs API client.
1. Sign in at warcraftlogs.com and open https://www.warcraftlogs.com/api/clients/.
2. Create a client (any name, redirect URL `http://localhost`, *not* a public client).
3. Paste the client ID and secret into ⚙ Settings → Warcraft Logs and press **Save & test**. They are stored only on your PC.

Warcraft Logs limits lookups per hour for each API key. Each key level in the range costs one lookup per dungeon, the item-level view costs a lot more, and everything loaded is cached for a day. If the limit is reached, the tab tells you when it resets.

### Other
- **Export:** save or copy the talent tree as an image, for example for Discord.
- **Settings (⚙):** tooltip language (9 languages), default region and player count, cache size and clear cache.
- **Reopening:** the app reopens your last results instantly. Recent searches show on the class picker.
- **Developer menu** (Settings → Developer…, or **Ctrl+Shift+D**): how much data was downloaded from each source, this session and all time (raider.io, Wowhead, raidbots, icon CDNs). It also shows request counts, average response time, errors, what is cached on disk per data type with hit rates, and a live list of the latest requests. Buttons: open DevTools, open the data folder, reset counters, clear cache.

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

The cache lives in `%APPDATA%\M+ Talent & Gear Inspector\data-cache`, and you can clear it in Settings. Trend history is stored in `...\history`, settings in `...\settings.json`, and the developer-menu totals in `...\stats.json`.

## Data sources

All public, no API key needed:

- [raider.io](https://raider.io): rankings, key history, talent and gear snapshots per key, your character, dungeon and raid lists.
- [raidbots](https://www.raidbots.com/static/data/live/talents.json): talent tree layout (positions, connections, icons).
- [Wowhead](https://www.wowhead.com): item stats for the exact item variant (bonus IDs and item level), talent descriptions, and item sources.
- [Warcraft Logs](https://www.warcraftlogs.com) (optional, with your own API client): damage and healing per dungeon and key level, and your own logged runs.

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
| `src/main/stats.js` | Download and cache statistics for the developer menu |
| `src/main/throughput.js` | Damage / healing statistics (medians per dungeon and key or item level, your runs vs the spec) |
| `src/main/sources/wcl.js` | Warcraft Logs client (OAuth client credentials, GraphQL, rankings) |
| `src/main/sources/` | raider.io / raidbots / Wowhead clients (rate limited, retried, cached) |
| `src/renderer/` | UI (plain HTML/CSS/ES modules) |

# The Keystone Lens game addon

`addon/KeystoneLens` is a World of Warcraft addon that brings the top players' Mythic+ data into the game. It has no network access, as no addon does. It reads two kinds of data: the **weekly data** that ships with it on CurseForge (`KeystoneLens_DB`), and the data the **desktop app** writes when you have it (`KeystoneLens_Data`). It also saves your characters for the app.

## How the data gets to the game

| Direction | What | Where |
|---|---|---|
| Weekly build → game | One record per spec for every spec (world-wide, top 50, every dungeon), built by the Addon workflow from Raider.IO's API (see [The weekly data](#the-weekly-data)) | `Interface/AddOns/KeystoneLens_DB/Data.lua`, a second folder in the CurseForge zip, as `KeystoneLensBundledData` |
| App → game | One record per spec: pick rates, choice splits, popular builds (with their talents and import strings), gear, enchants and gems by game ID, stat profile, races with their racial spells for the spec's class, per-dungeon talents and builds | `Interface/AddOns/KeystoneLens_Data/Data.lua`, a separate addon folder the app writes, loaded at login or `/reload` |
| Game → app | Your character as SimulationCraft-style text (talent strings, saved loadouts, equipped items), plus name, realm, region, spec and item level | `WTF/Account/<account>/SavedVariables/KeystoneLens.lua`, written by the game at logout or `/reload` |

**Keeping the addon itself up to date.** The app carries the addon (`resources/addon/KeystoneLens`). Settings → Game addon installs it and writes a marker file, `.installed-by-keystone-lens`, into the copy. Each time the app starts, and each time you click Rescan, it compares that copy's files with its own (`wow.addonFingerprint`). If it carries a newer build, it replaces the copy, even when the version number is the same. Copies without the marker (installed by hand or from CurseForge) are never replaced on their own. Settings and a banner offer the update for those instead. The app never replaces a newer version than its own. **Reinstall addon** forces a fresh copy.

Per spec, the addon shows the newer of the weekly record and the app's record. The data folders are separate from the addon folder: a CurseForge update replaces `KeystoneLens` and `KeystoneLens_DB` but never touches the app's `KeystoneLens_Data`, and the app never touches the weekly data. Its `.toc` copies the `## Interface` value of the installed addon, so the game doesn't list it as out of date.

**What the app sends.** Every Mythic+ analysis you open becomes the record of its spec, replacing any older one. In the background, the app also refreshes the specs of the characters the addon saved, when their data is over a day old or misses dungeons. It does them one at a time and pauses while you run your own searches. Warcraft Logs data (Damage tab, Raid mode) is never written to disk, so it never reaches the addon.

**Data format.** `KeystoneLensAppData = { schema = 1, source = "app", app = "<version>", time = <unix>, specs = { [specID] = record } }`. The record is documented at the top of `src/main/addonExport.js`. The addon ignores data whose `schema` is newer than it understands, and says so. Change `SCHEMA` in both `addonExport.js` and `Data.lua` when the format changes incompatibly. Fields that are only added (like `races`, from app 1.2.0) keep the schema: older addons ignore them, and the addon handles records without them.

**Races.** The app gets each player's race from raider.io. It adds every race's racial spells for the spec's class from SimulationCraft's game data (`src/main/races.js`). The addon shows the race names in the game's language (`C_CreatureInfo.GetRaceInfo`), the game's race portraits when it has them, and the spells' own names, icons and tooltips.

## Files

| File | Purpose |
|---|---|
| `KeystoneLens.toc` | Interface version, `## Version`, SavedVariables, addon compartment entry |
| `Core.lua` | Namespace, settings, events, `/kl` |
| `Data.lua` | Data lookup (newest record per spec), dungeon of your keystone, your talents, build distance |
| `Character.lua` | Saves your character for the app (SimulationCraft format, read by `src/main/simc.js`) |
| `Talents.lua` | Pick rates and frames on Blizzard's talent window (or a compared build's changes), and the switch in its title row |
| `Gear.lua` | The Overview tab: character pane with the top players' gear, slot flyouts, stat bars |
| `Races.lua` | The Overview's "Popular races" strip and the flyout with a race's racial abilities |
| `Builds.lua` | The side pane with the popular builds, their differences from yours, Copy and Show on talents |
| `Panel.lua` | The `/kl` window: spec and dungeon menus, Overview and Info tabs, the copy box |
| `Tooltips.lua` | The popularity line on item tooltips |
| `Options.lua` | The page in the game's Settings → AddOns |

The addon has no libraries and no minimap button. It only writes to chat in answer to `/kl` commands.

## Mentioning the app

Blizzard's add-on policy does not allow advertisements in add-ons. The addon therefore mentions the desktop app only where that is plain information, and only in its own UI:

- the data line ("From the Keystone Lens app · 2 hours ago", or "Weekly data · 3 days ago · from Raider.IO");
- the empty state when there is no data, which explains where data comes from;
- the About tab and the Settings page, with the project link in a copy box.

There are no pop-ups, login messages or reminders. The CurseForge project page is the place to describe the app in full.

## Testing

```bat
npm test
```

`test/addon.test.js` loads the addon in a Lua VM (`fengari`) against a stand-in WoW API (`test/helpers/wow_stub.lua`). It covers reading the app's data file, the build comparison, tooltips, the talent overlay and window texts, and the character snapshot. That snapshot is parsed by the app's SimulationCraft importer and read back from a SavedVariables file. The tests also check that the code is Lua 5.1, the version WoW runs. With `luac5.1` installed (the `addon` CI job), every file is also compiled with it.

```sh
luacheck addon/KeystoneLens --config addon/.luacheckrc
```

`luacheck` catches misspelled globals and unused variables. CI runs it on Linux.

### In-game checklist

The stand-in API can't prove that Blizzard's frames behave as expected. Before a release, check in game:

1. **Install.** In the app, ⚙ Settings → Game addon shows your WoW folder. Install the addon, look at your spec in the app, then `/reload` in game. `/kl status` lists the spec. After changing the addon in the repository, restart the app (or click Rescan). It should report "Updated by the app", and `/reload` shows the change.
2. **Talent window** (N). Percentages appear under the nodes, with choice nodes as "60/40". There is a red frame on a popular talent you skip and an orange frame on a rare pick. The tooltip shows the Keystone Lens lines. The switch in the window's title row cycles through the dungeons, and its checkbox hides everything. With a keystone in your bags, the switch starts on its dungeon. Check that it doesn't cover anything in the title row, at the normal and the wide window size.
3. **Hero talents.** Only the active hero tree gets numbers.
4. **`/kl` window.**
   - It looks like a game window (portrait, title, tabs under it), is opaque, can be moved, and closes with Escape.
   - Every slot shows an icon with a quality border and a %. Empty slots show the slot art. Your items have a tick.
   - Clicking a slot opens its flyout next to it, with options, enchants and your items highlighted. A click elsewhere closes it.
   - The stat bars show sensible ratings and percentages for both sides. Compare yours with the character sheet: these leave out enchants.
   - The spec menu appears with two or more specs. The dungeon menu changes the builds and the talent window together.
   - The Info tab is filled in, and its checkboxes work.
5. **Build pane.**
   - The pane sits against the right of the window and can be closed and reopened (Builds).
   - The card closest to yours is open and ticked. Other cards list the talents to take, drop or change, with icons.
   - Copy shows the string, which imports through Loadouts → Import.
   - **Show on talents** opens the talent window if the game has loaded it this session (otherwise it asks you to press N). It frames take (green), drop (red) and change (yellow). The "Build N" button in the window's title row goes back to pick rates.
   - **After using it, apply a talent change: there must be no "Interface action failed because of an AddOn".**
6. **Races.** The Overview's bottom row shows up to five race portraits with their %. Your race is ticked, and "+N" lists the rest. The row must not overlap the weapon slots. Clicking a race opens the flyout of its racials, with "Passive" on passives and the game's tooltip on hover. A click elsewhere closes it. Check a Blood Elf: only your class's Arcane Torrent is listed. Portraits that the game lacks fall back to a spell icon.
7. **Item tooltips.** Hovering a popular trinket shows "Keystone Lens: 42% of the top 50 …".
8. **Back to the app.** Log out or `/reload`, then open Compare with my character in the app. The character is listed under "From the game addon" and loads.
9. **Errors.** Use `/console scriptErrors 1`, or BugSack, and expect no Lua errors, also in combat and in a key.
10. **Weekly data alone.** Unzip the Addon workflow's artifact into `Interface/AddOns` and move `KeystoneLens_Data` away. Every spec has data: the footer says "Weekly data · … · from Raider.IO", and talents, `/kl` and tooltips work for any spec. Move `KeystoneLens_Data` back: the specs the app refreshed since show "From the Keystone Lens app". Check `/run UpdateAddOnMemoryUsage() print(GetAddOnMemoryUsage("KeystoneLens_DB"))` stays reasonable (a few MB).

## Publishing on CurseForge

The **Addon** workflow ([`addon.yml`](../.github/workflows/addon.yml)) publishes the addon with fresh data every **Wednesday** at 07:23 UTC, after the US and EU weekly resets. It also runs when you push an `addon-v*` tag, and by hand from the Actions tab.

**One-time setup:**

1. **Create the project** on <https://authors.curseforge.com> (World of Warcraft → Addons). Name: *Keystone Lens*. License: MIT. Paste the description below. CurseForge reviews new projects before they go public.
2. **Create an API token** at <https://authors.curseforge.com/#/settings/api-tokens>. Store it as the repository **secret** `CF_API_TOKEN` (GitHub → Settings → Secrets and variables → Actions → Secrets).
3. **Store the project ID** (on the project page under "About Project") as the repository **variable** `CF_PROJECT_ID` (same page, Variables tab).

Without the secret or the variable, every run only builds the zip, which you can download from the run as an artifact. To pause uploads, delete the variable.

**What a run does:**

1. Lints and tests the addon, the data build and the upload script.
2. Builds the week's data with `scripts/build-addon-data.js`, using the cache of key snapshots from earlier runs.
3. Zips the addon exactly as committed (`git archive`, without hidden files) and the data as its own `KeystoneLens_DB` folder. The `KeystoneLens` folder is identical to the app's copy, so the app sees the same build.
4. Checks the zip (both folders, nothing else, nothing hidden) and keeps it as an artifact.
5. When it may, uploads it with `scripts/upload-curseforge.js` as, for example, `1.2.0-data.20261111`: the addon version and the data's date. The upload uses the CurseForge game version for `## Interface` (the newest listed one below it for a patch CurseForge doesn't list yet). The changelog is `CHANGELOG.md`, with a line about the week's data on top.

A manual run uploads only with **Upload to CurseForge** ticked. With **specs** filled in (for example `261,262`), it builds just those specs as a quick test and never uploads.

**Releasing a new addon version.** Set `## Version` in the `.toc`, add the changes to `addon/KeystoneLens/CHANGELOG.md` (CurseForge shows it as the changelog), commit, then tag and push:

```bat
git tag addon-v1.2.0
git push origin addon-v1.2.0
```

That run checks the tag against `## Version` and publishes at once; the weekly runs then keep using the new version.

**Things to know:**
- GitHub pauses scheduled workflows in a public repository after 60 days without a commit, and emails you first. Re-enable it under Actions → Addon, or push any commit.
- The cache of key snapshots is about 1 GB. GitHub drops caches unused for 7 days, so a small Sunday run restores it to keep it. If it is lost anyway, the next run fetches every snapshot again, which takes longer and asks Raider.IO more.
- A run fails, and uploads nothing, when more than 3 specs fail to build.

Keep the `## Interface` line current with the live game (`/dump select(4, GetBuildInfo())` in game). Several values can be listed: `## Interface: 120105, 120200`.

### CurseForge description (draft)

> **See what the top Mythic+ players of your spec run, right on your talent window.**
>
> - Pick rates of the top players on every talent, with choice splits. Popular talents you skip and rare ones you take are framed.
> - The popular builds per dungeon, which one is closest to yours, and their import strings.
> - The most used gear, enchants and gems per slot, with yours marked, and their secondary stats next to yours.
> - The races they play, with each race's racial abilities for your class.
> - Item tooltips that say how many top players use an item.
> - Switch to the dungeon of your keystone in one click.
>
> **Data.** The addon comes with data for every spec: the top 50 Mythic+ players world-wide, with every dungeon, renewed every week with an addon update. It is built from [Raider.IO](https://raider.io)'s public data, with their permission, and contains no player names.
>
> **Want fresher data?** The free, open-source [Keystone Lens desktop app](https://mlvgog.github.io/keystone-lens/) for Windows adds data whenever you look at a spec, for any region and number of players, and keeps your characters' specs up to date. It also reads the characters this addon saves, to compare them with the top players. Per spec, the addon shows whichever data is newer.
>
> Data: Raider.IO. Not affiliated with Blizzard Entertainment or Raider.IO.

## The weekly data

[`scripts/build-addon-data.js`](../scripts/build-addon-data.js) runs the app's own data code in plain Node, without Electron. For each spec, it runs `analyze()` and `loadDungeon()` from `src/main/collector.js` (world-wide, top 50, current patch) and `specRecord()`, then writes `KeystoneLens_DB/{KeystoneLens_DB.toc,Data.lua}` with `dataFileText(records, { bundle: true })`:

- **Size:** about 3 MB for all specs.
- **Contents:** no player names, only aggregates and build import strings.

**Raider.IO's permission.** In November 2026, Raider.IO agreed to the project as it was proposed to them:
- once a week;
- aggregated statistics only, with no player names;
- credit with a link, in the addon and on the CurseForge page.

Their [branding guidelines](https://raider.io/branding) ask not to edit, recolor or distort their logo. The addon credits them in text ("Raider.IO").

**Being polite to the API.** The build identifies itself as `KeystoneLens/<version> (addon data build; +<repository>)`. It uses at most 3 parallel requests to raider.io, against the app's 8 (`http.configure()`). It keeps every key snapshot it fetched in `.addon-data-cache`, carried between runs by the workflow's cache. A first run with an empty cache is about 20,000 raider.io requests and 70 minutes. A weekly run fetches only new keys plus the score and top-key lists, about half of that.

**Running it locally:**

```bat
node scripts/build-addon-data.js --specs 261
```

This writes `build/addon/KeystoneLens_DB`. Copy that folder into `Interface/AddOns` to try it in game. `--specs` takes spec IDs; without it, every spec is built.

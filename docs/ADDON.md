# The Keystone Lens game addon

`addon/KeystoneLens` is a World of Warcraft addon that brings the app's Mythic+ data into the game. It has no network access, as no addon does. It reads data the desktop app writes for it, and it saves your characters for the app.

## How the data gets to the game

| Direction | What | Where |
|---|---|---|
| App → game | One record per spec: pick rates, choice splits, popular builds (with their talents and import strings), gear, enchants and gems by game ID, stat profile, per-dungeon talents and builds | `Interface/AddOns/KeystoneLens_Data/Data.lua`, a separate addon folder the app writes, loaded at login or `/reload` |
| Game → app | Your character as SimulationCraft-style text (talent strings, saved loadouts, equipped items), plus name, realm, region, spec and item level | `WTF/Account/<account>/SavedVariables/KeystoneLens.lua`, written by the game at logout or `/reload` |

**Keeping the addon itself up to date.** The app carries the addon (`resources/addon/KeystoneLens`). Settings → Game addon installs it and writes a marker file, `.installed-by-keystone-lens`, into the copy. Each time the app starts, and each time you click Rescan, it compares that copy's files with its own (`wow.addonFingerprint`). If it carries a newer build, it replaces the copy, even when the version number is the same. Copies without the marker (installed by hand or from CurseForge) are never replaced on their own. Settings and a banner offer the update for those instead. The app never replaces a newer version than its own. **Reinstall addon** forces a fresh copy.

The data folder is separate from the addon folder so that a CurseForge update of the addon never deletes the data. Its `.toc` copies the `## Interface` value of the installed addon, so the game doesn't list it as out of date.

**What the app sends.** Every Mythic+ analysis you open becomes the record of its spec, replacing any older one. In the background, the app also refreshes the specs of the characters the addon saved, when their data is over a day old or misses dungeons. It does them one at a time and pauses while you run your own searches. Warcraft Logs data (Damage tab, Raid mode) is never written to disk, so it never reaches the addon.

**Data format.** `KeystoneLensAppData = { schema = 1, source = "app", app = "<version>", time = <unix>, specs = { [specID] = record } }`. The record is documented at the top of `src/main/addonExport.js`. The addon ignores data whose `schema` is newer than it understands, and says so. Change `SCHEMA` in both `addonExport.js` and `Data.lua` when the format changes incompatibly.

## Files

| File | Purpose |
|---|---|
| `KeystoneLens.toc` | Interface version, `## Version`, SavedVariables, addon compartment entry |
| `Core.lua` | Namespace, settings, events, `/kl` |
| `Data.lua` | Data lookup (newest record per spec), dungeon of your keystone, your talents, build distance |
| `Character.lua` | Saves your character for the app (SimulationCraft format, read by `src/main/simc.js`) |
| `Talents.lua` | Pick rates and frames on Blizzard's talent window (or a compared build's changes), and the switch in its title row |
| `Gear.lua` | The Overview tab: character pane with the top players' gear, slot flyouts, stat bars |
| `Builds.lua` | The side pane with the popular builds, their differences from yours, Copy and Show on talents |
| `Panel.lua` | The `/kl` window: spec and dungeon menus, Overview and Info tabs, the copy box |
| `Tooltips.lua` | The popularity line on item tooltips |
| `Options.lua` | The page in the game's Settings → AddOns |

The addon has no libraries and no minimap button. It only writes to chat in answer to `/kl` commands.

## Mentioning the app

Blizzard's add-on policy does not allow advertisements in add-ons. The addon therefore mentions the desktop app only where that is plain information, and only in its own UI:

- the data line ("From the Keystone Lens app · 2 hours ago");
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
6. **Item tooltips.** Hovering a popular trinket shows "Keystone Lens: 42% of the top 50 …".
7. **Back to the app.** Log out or `/reload`, then open Compare with my character in the app. The character is listed under "From the game addon" and loads.
8. **Errors.** Use `/console scriptErrors 1`, or BugSack, and expect no Lua errors, also in combat and in a key.

## Publishing on CurseForge

1. **Create the project** on <https://authors.curseforge.com> (World of Warcraft → Addons). Name: *Keystone Lens*. License: MIT. Paste the description below. CurseForge reviews new projects before they go public.
2. **Add the project ID** to `addon/KeystoneLens/KeystoneLens.toc`: `## X-Curse-Project-ID: <id>` (it is on the project page under "About Project").
3. **Create an API token** at <https://authors.curseforge.com/#/settings/api-tokens>. Store it as the repository secret `CF_API_TOKEN` (GitHub → Settings → Secrets and variables → Actions).
4. **Release.** Set `## Version` in the `.toc` and add the changes to `addon/KeystoneLens/CHANGELOG.md`. Commit, then tag and push:

   ```bat
   git tag addon-v1.0.0
   git push origin addon-v1.0.0
   ```

   The **Addon** workflow lints and tests the addon, checks the tag against `## Version`, packages it with the [BigWigs packager](https://github.com/BigWigsMods/packager), and uploads it to CurseForge. The zip is also kept as a workflow artifact. Without the secret or the project ID it only builds the zip.

Keep the `## Interface` line current with the live game (`/dump select(4, GetBuildInfo())` in game). Several values can be listed: `## Interface: 120105, 120200`.

### CurseForge description (draft)

> **See what the top Mythic+ players of your spec run, right on your talent window.**
>
> - Pick rates of the top players on every talent, with choice splits. Popular talents you skip and rare ones you take are framed.
> - The popular builds per dungeon, which one is closest to yours, and their import strings.
> - The most used gear, enchants and gems per slot, with yours marked, and their secondary stats next to yours.
> - Item tooltips that say how many top players use an item.
> - Switch to the dungeon of your keystone in one click.
>
> **Where the data comes from.** Keystone Lens is the companion of the free, open-source [Keystone Lens desktop app](https://github.com/mlvgog/keystone-lens) for Windows. The app finds the top players of a spec in raider.io's published Mythic+ data. It writes their talents and gear for this addon, and keeps the specs of your characters up to date. The app also reads the characters this addon saves, to compare them with the top players. Without the app, this addon has no data to show.
>
> Data: raider.io. Not affiliated with Blizzard Entertainment or raider.io.

## A standalone version (not built yet)

A standalone release would ship a data snapshot inside the addon (`KeystoneLensBundledData`), so it works without the app. The addon already reads such a table, and per spec the newest of the bundled and the app's data wins. The missing piece:

- a script (`scripts/build-addon-data.js`) that runs `analyze()` and `loadDungeon()` from `src/main/collector.js` for all specs. They are plain Node and need no Electron. It would write `addon/KeystoneLens/Data/Bundled.lua` with `dataFileText()`, with `source = "bundle"` and the global renamed. All 40 specs, top 50, with every dungeon, come to about 1–2 MB;
- a weekly scheduled GitHub Actions job that runs it, bumps the addon version, and tags a release. That is a few thousand raider.io requests a week, most of them cached key snapshots after the first run.

**Why it waits.** A bundled snapshot redistributes data derived from raider.io in a public download. raider.io's API is meant for personal and community use, asks for attribution, and doesn't allow competing services or reselling data. It doesn't clearly cover bundling data in a public addon, and raider.io has its own addon. The companion mode is different: the data is computed on your own PC from your own requests, like the app's cache. Ask raider.io before publishing a standalone build, for example:

> Hi! I make Keystone Lens (https://github.com/mlvgog/keystone-lens), a free, open-source desktop app that shows talent pick rates and gear of the top Mythic+ players per spec, using your public API, with credit and links to raider.io. I'd like to publish a free companion addon on CurseForge that ships a weekly snapshot of the aggregated statistics (pick rates per talent, popular builds, gear usage per slot for the top 50 players of each spec; no player names). It would make about N requests a week, cached. Is that use of the API okay with you, and are there conditions (attribution, rate, an API key) you'd like me to follow?

If they agree, add the script and the scheduled workflow, then mention the bundled data in the CurseForge description.

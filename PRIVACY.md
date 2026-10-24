# Privacy Policy

_Last updated: 24 October 2026_

Keystone Lens is a desktop app that runs entirely on your PC. It has no accounts, no analytics, no telemetry and no server of its own. The developer never receives any of your data.

## What the app stores on your PC

Everything is stored in `%APPDATA%\Keystone Lens`. Nothing is uploaded.

| What | Where | Notes |
|---|---|---|
| Settings: language, default region, player count, update mode, whether the Warcraft Logs features are on | `settings.json` | |
| Your Warcraft Logs client ID and secret (optional) | `settings.json` | Only asked for after you turn on the Warcraft Logs features. The secret is encrypted with Windows' per-user encryption (DPAPI) and can't be read by other Windows accounts. |
| Characters you load in "Compare with my character" (region, realm, name, class) | the app's local storage | Up to 12, so you can load them again with one click. |
| SimulationCraft exports you paste | the app's local storage | Kept with the saved character so it can be loaded again without pasting. They contain your character's name, realm, talents and gear. Never sent anywhere; only the item IDs in it are looked up as described below. |
| Cached public data from raider.io, Wowhead, wago.tools and SimulationCraft | `data-cache` | Clear it in ⚙ Settings → Clear cache. |
| Trend history (pick rates of earlier searches) | `history` | |
| Download statistics for the developer menu | `stats.json` | Request counts and sizes per source. |
| Specs sent to the game addon (pick rates, builds, gear and races of the top players) | `addon-data.json` | Public Mythic+ data only. |
| Your World of Warcraft folder | `settings.json` | Found through the Windows registry or the usual install folders, or chosen by you. |

## The game addon

If you use the Keystone Lens game addon, two more things happen on your PC. Nothing is uploaded.

- **The app writes** the addon's data to `World of Warcraft\_retail_\Interface\AddOns\KeystoneLens_Data`. When you click **Install addon**, it also copies the addon to `Interface\AddOns\KeystoneLens`, with a small file `.installed-by-keystone-lens` (the version it installed). That copy is replaced when the app comes with a newer build of the addon, unless you turn that off in Settings. It writes nowhere else in the game folder.
- **The addon saves** your characters' name, realm, region, spec, item level, talents and equipped gear in the game's SavedVariables file (`WTF\Account\<account>\SavedVariables\KeystoneLens.lua`). The app only reads that file, to list your characters in "Compare with my character". Remove a character by deleting that file while the game is closed.

Data from Warcraft Logs (damage numbers and raid kills with talents and gear) is **never written to disk**. It is kept in memory for up to 30 minutes and is gone when the app closes.

## What the app sends, and to whom

The app talks directly to these services, only to fetch the data it shows:

| Service | What is sent | Their privacy policy |
|---|---|---|
| raider.io (`raider.io`, `cdn.raiderio.net`) | Requests for public M+ data and images. With "Compare with my character", the region, realm and name you enter. | [raider.io privacy policy](https://raider.io/privacy-policy) |
| Wowhead (`www.wowhead.com`, `nether.wowhead.com`, `wow.zamimg.com`) | Item IDs for the item XML. When you hover an item or talent, Wowhead's tooltips script loads and requests that item or spell. | [Wowhead privacy policy](https://www.wowhead.com/privacy) |
| wago.tools | Requests for public game tables (talent and item data). | [wago.tools privacy policy](https://wago.tools/privacy-policy) |
| GitHub (`raw.githubusercontent.com`) | Downloads of SimulationCraft's public game data files (talent trees, item scaling, racial abilities). | [GitHub privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) |
| GitHub (`github.com`, `api.github.com`, GitHub's download servers) | Update checks: a request for the newest Keystone Lens release, at start-up and every 6 hours while the app is open, and the download of a new version. Nothing about you is sent. Turn it off in ⚙ Settings → Updates. | [GitHub privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) |
| Blizzard (`render.worldofwarcraft.com`) | Icon downloads, when raider.io's image server lacks an icon. | Blizzard's privacy policy |
| Warcraft Logs (optional, off by default) | Only while the Warcraft Logs features are on (⚙ Settings → Warcraft Logs): your client ID and secret, to get an access token. Requests for public rankings. With "Compare with my character", the region, realm and name you enter. While they are off, the app never contacts Warcraft Logs. | [Archon (RPGLogs) privacy policy](https://archon.gg/privacy-policy) |

Like any internet request, these services can see your IP address. Data requests carry a User-Agent of the form `KeystoneLens/<version> (desktop app; +https://github.com/mlvgog/keystone-lens)` so the services know which app is calling. It contains nothing about you. Icons and Wowhead's tooltips script are loaded by the app's window the way a web page loads them.

A downloaded update waits in Windows' temporary folder for your user (`%LOCALAPPDATA%\keystone-lens-updater`) until it is installed.

Links in the app (raider.io profiles, Warcraft Logs reports, the Armory, the GitHub page) open in your normal web browser.

## Deleting your data

- **Warcraft Logs credentials.** ⚙ Settings → Warcraft Logs → **Remove** (also there while the features are off, as long as a client is saved).
- **Cache.** ⚙ Settings → **Clear cache**.
- **Everything.** Uninstall the app, then delete the folder `%APPDATA%\Keystone Lens`. The uninstaller keeps this folder so that a reinstall keeps your settings.

## Changes and contact

Changes to this policy are published in this repository. Questions can go in [GitHub Issues](https://github.com/mlvgog/keystone-lens/issues). Please never post your Warcraft Logs secret there.

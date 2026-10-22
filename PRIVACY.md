# Privacy Policy

_Last updated: 22 October 2026_

Keystone Lens is a desktop app that runs entirely on your PC. It has no accounts, no analytics, no telemetry and no server of its own. The developer never receives any of your data.

## What the app stores on your PC

Everything is stored in `%APPDATA%\Keystone Lens`. Nothing is uploaded.

| What | Where | Notes |
|---|---|---|
| Settings: language, default region, player count | `settings.json` | |
| Your Warcraft Logs client ID and secret (optional) | `settings.json` | The secret is encrypted with Windows' per-user encryption (DPAPI) and can't be read by other Windows accounts. |
| Characters you load in "Compare with my character" (region, realm, name, class) | the app's local storage | Up to 12, so you can load them again with one click. |
| Cached public data from raider.io, Wowhead and raidbots | `data-cache` | Clear it in ⚙ Settings → Clear cache. |
| Trend history (pick rates of earlier searches) | `history` | |
| Download statistics for the developer menu | `stats.json` | Request counts and sizes per source. |

Data from Warcraft Logs is **never written to disk**. It is kept in memory for up to 30 minutes and is gone when the app closes.

## What the app sends, and to whom

The app talks directly to these services, only to fetch the data it shows:

| Service | What is sent | Their privacy policy |
|---|---|---|
| raider.io (`raider.io`, `cdn.raiderio.net`) | Requests for public M+ data and images. With "Compare with my character", the region, realm and name you enter. | [raider.io privacy policy](https://raider.io/privacy-policy) |
| Wowhead (`wowhead.com`, `wow.zamimg.com`) | Item and spell IDs for tooltips, and icon downloads. | [Wowhead privacy policy](https://www.wowhead.com/privacy) |
| raidbots | A request for the public talent-tree data file. | [raidbots privacy policy](https://www.raidbots.com/privacy) |
| Warcraft Logs (optional) | Your client ID and secret, to get an access token. Requests for public rankings. With "Compare with my character", the region, realm and name you enter. | [Archon (RPGLogs) privacy policy](https://archon.gg/privacy-policy) |
| GitHub | Nothing, unless you click the "Source code and releases" link, which opens your browser. | |

Like any internet request, these services can see your IP address. Every request carries a User-Agent of the form `KeystoneLens/<version> (desktop app; +https://github.com/mlvgog/keystone-lens)` so the services know which app is calling. It contains nothing about you.

Links in the app (raider.io profiles, Warcraft Logs reports, the Armory) open in your normal web browser.

## Deleting your data

- **Warcraft Logs credentials.** ⚙ Settings → Warcraft Logs → **Remove**.
- **Cache.** ⚙ Settings → **Clear cache**.
- **Everything.** Uninstall the app, then delete the folder `%APPDATA%\Keystone Lens`. The uninstaller keeps this folder so that a reinstall keeps your settings.

## Changes and contact

Changes to this policy are published in this repository. Questions can go in [GitHub Issues](https://github.com/mlvgog/keystone-lens/issues). Please never post your Warcraft Logs secret there.

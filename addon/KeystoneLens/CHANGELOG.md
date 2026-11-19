# Keystone Lens addon

## 1.3.0

- **Consumables:** under the secondary stats, `/kl` now shows the flask, food and augment rune the top players use most, with their share. Hover one for the other options, and for whether you carry it: a tick shows when the top flask or rune is in your bags. The data comes from the buffs Raider.IO records at the boss pulls of runs logged with its client, so it covers the players whose runs were logged (most of the top players). Potions and weapon oils are not recorded there. Older data without consumables hides the row.
- **Ready for patch 12.1.7:** the addon declares both 12.1.5 and 12.1.7, so it won't show as out of date when the patch goes live.
- **The same version everywhere:** from now on the addon on CurseForge is always the one in the latest Keystone Lens app, and the app installs the same weekly data for every spec as CurseForge. Using the app and the CurseForge addon together works: each keeps its own folders current, and per spec you see the newer data.

## 1.2.0

- **Works on its own.** The addon now comes with data for every spec: the top 50 Mythic+ players world-wide, with every dungeon, from Raider.IO's public data. It is renewed every week with an addon update. You no longer need the desktop app to use it.
- **The app still adds more.** With the free Keystone Lens app, the specs you look at get fresh data whenever you want, for any region and number of players. Per spec, the addon shows whichever data is newer.
- The window's footer and Info tab say which data you see and how old it is.

## 1.1.2

- **Fixed:** every popular build listed one talent more than you have, shown as "+ Talent" with a number (for example "+ Talent 99842"). It was the choice of hero tree, which is not a talent you take or skip. Your own build now shows as "your build", and "Your talents are closest to Build 1 (1 differ)" reads "Your talents are Build 1." when they match.
- **Fixed:** the menus that open from a race or a gear slot were see-through, so the window's text showed through them. They now have a solid background.

## 1.1.1

- **Fixed:** talents the game gives you for free (the first talent of a tree, such as Cloak of Shadows, and the first talent of your hero tree) were framed red as "most top players take this and you don't". They no longer get a frame.

## 1.1.0

- **Popular races:** a strip at the bottom of `/kl` shows the races the top players of the spec play, with each race's share and your own race ticked. Click a race for its racial abilities for your class, with the game's tooltips. Needs data from Keystone Lens app 1.2.0 or newer; older data shows a hint instead.
- The window is a little taller to make room for it.

## 1.0.0

First release.

- **Talent window:** the pick rate of the top Mythic+ players of your spec on every talent, choice splits on choice nodes, and frames around the popular talents you skip (red) and the rare ones you take (orange). A switch in the window's title row changes between all dungeons and each dungeon; it starts on the dungeon of your keystone.
- **Gear (`/kl`):** the top players' gear as a character pane. Each slot shows the most used item and its %, with a tick when you wear it. Click a slot for every option, its enchants, and the gems. Bars compare their secondary stats with yours, as rating and %.
- **Builds:** a side pane with the popular builds per dungeon. Each one lists the talents it changes compared with yours, has a Copy button for its import string, and can be shown on your talent window (take, drop and change framed in green, red and yellow).
- **Item tooltips:** how many top players of your spec use an item.
- **Data:** written by the free Keystone Lens desktop app, which also reads the characters this addon saves, so they can be compared there without a SimulationCraft export.

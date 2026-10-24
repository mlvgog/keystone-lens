# Releasing

Releases are built by GitHub Actions ([`release.yml`](../.github/workflows/release.yml)) when a version tag is pushed. The workflow:

1. runs the tests;
2. checks that the tag matches `version` in `package.json`;
3. builds the installer and the portable exe on Windows;
4. checks that `latest.yml` (for the in-app updater) names the new installer;
5. writes `SHA256SUMS.txt`;
6. publishes a release with the files, using `docs/release-notes/<tag>.md` as its notes (plus GitHub's list of changes).

## How updates reach users

The installed app checks the **newest published release** (not drafts, not pre-releases) at start-up and every 6 hours. It reads `latest.yml` from that release, downloads the installer it names, checks its SHA-512 and installs it silently when the user restarts or closes the app. The portable exe only compares version numbers through GitHub's API and links to the release page.

So every release must contain `latest.yml` and `KeystoneLens-Setup-<version>.exe.blockmap`; the workflow uploads them. Deleting a release, or marking it as a pre-release, stops it from being offered. Users of 1.0.0 have no updater and need to install 1.1.0 by hand once.

## Steps

1. **Write the release notes** in `docs/release-notes/v1.1.0.md` (what's new, for players) and commit them.

2. **Bump the version.** This updates `package.json` and `package-lock.json` and creates a commit and a `v1.1.0` tag:

   ```bat
   npm version minor
   ```

   Use `patch` for fixes and `minor` for new features.

3. **Push the commit and the tag:**

   ```bat
   git push --follow-tags
   ```

4. **Wait for the Release workflow** under the repository's **Actions** tab (about 5 minutes). The release appears under **Releases** when it finishes.

To review a release before it goes out, set `draft: true` in `release.yml` and publish the draft from **Releases** yourself. The updater ignores drafts, so nobody gets it until you publish.

## Building locally

```bat
npm run dist
```

This writes `dist\KeystoneLens-Setup-<version>.exe` and `dist\KeystoneLens-Portable-<version>.exe`. Local builds are not signed either.

## Code signing (optional, recommended later)

Unsigned builds trigger the Windows SmartScreen warning ("Windows protected your PC"). Signing removes or reduces it:

| Option | Cost | Notes |
|---|---|---|
| [SignPath Foundation](https://signpath.org) | Free for open-source projects | Signs builds made by GitHub Actions. You apply with the repository, and the signing happens in their service. |
| [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) | About $10 a month | Needs identity verification. It works with electron-builder through `win.azureSignOptions`. |
| OV code-signing certificate | About $200–400 a year | Classic certificate, now usually on a hardware token or cloud HSM. SmartScreen reputation still builds up over time. |

Once signing is set up, remove `CSC_IDENTITY_AUTO_DISCOVERY: false` from `release.yml` and add the signing configuration and secrets. The updater then also checks that a downloaded installer is signed by the same publisher (`publisherName` in `win.signtoolOptions` or `win.azureSignOptions`). Ship one signed release before relying on that check, because an unsigned app accepts any installer whose SHA-512 matches `latest.yml`.

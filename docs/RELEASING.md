# Releasing

Releases are built by GitHub Actions ([`release.yml`](../.github/workflows/release.yml)) when a version tag is pushed. The workflow:

1. runs the tests;
2. checks that the tag matches `version` in `package.json`;
3. builds the installer and the portable exe on Windows;
4. writes `SHA256SUMS.txt`;
5. publishes a release with the files, using `docs/release-notes/<tag>.md` as its notes (plus GitHub's list of changes).

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

To review a release before it goes out, set `draft: true` in `release.yml` and publish the draft from **Releases** yourself.

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

Once signing is set up, remove `CSC_IDENTITY_AUTO_DISCOVERY: false` from `release.yml` and add the signing configuration and secrets.

# Releasing

Releases are built by GitHub Actions ([`release.yml`](../.github/workflows/release.yml)) when a version tag is pushed. The workflow:

1. runs the tests;
2. checks that the tag matches `version` in `package.json`;
3. builds the installer and the portable exe on Windows;
4. writes `SHA256SUMS.txt`;
5. attaches everything to a **draft** release.

Nothing is published until you publish the draft.

## Steps

1. **Bump the version.** This updates `package.json` and `package-lock.json` and creates a commit and a `v1.1.0` tag:

   ```bat
   npm version minor
   ```

   Use `patch` for fixes and `minor` for new features.

2. **Push the commit and the tag:**

   ```bat
   git push --follow-tags
   ```

3. **Wait for the Release workflow** under the repository's **Actions** tab (about 5 minutes).

4. **Publish the draft.** Open **Releases**, edit the new draft and check the generated notes. Download the installer once to try it, then press **Publish release**.

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

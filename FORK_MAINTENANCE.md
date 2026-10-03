# Maintaining the Swompen SleekFin fork

This fork preserves SleekFin's plugin name, assembly name, and GUID so an existing upstream SleekFin installation keeps its configuration when upgraded. Fork releases have `autoUpdate` disabled: updates are deliberate, manual installs from this fork's catalog and cannot silently switch back to upstream artifacts.

## Baseline and carried work

- Upstream: `https://github.com/varunaditya-plus/SleekFin.git`
- Recorded base: `6c19ce8f8e3fbdc2e1dde9700db9b69f9651e70e` (`1.4.2.2`)
- Carried upstream PR: #33, commit `28710051b4e9343c8291450f48ac871d5398489b`, preserved as a cherry-pick
- First fork release: `1.4.2.3`

## Updating from upstream

Keep the fork remote as `origin` and the source project as `upstream`:

```sh
git remote add upstream https://github.com/varunaditya-plus/SleekFin.git
git fetch upstream
git switch main
git log --oneline --decorate main..upstream/main
git merge --no-ff upstream/main
```

Review conflicts narrowly. Do not bulk-import open pull requests; reassess each PR against the current upstream base and preserve author commits with `git cherry-pick <commit>` when selected.

Before pushing an update, run:

```sh
npm ci
npm test
npm run check
npm run build
dotnet build SleekFin.sln -c Release
dotnet format SleekFin.sln --verify-no-changes --no-restore
git diff --check
git diff upstream/main...HEAD
```

A release is triggered only by a commit pushed to `main` whose first line ends in an approved four-part marker such as `(v1.4.2.3)`. The workflow builds the Jellyfin 12/.NET 10 plugin, packages the ZIP, computes its MD5 checksum, prepends the fork release to `manifest.json`, commits version metadata, tags the version, and publishes the asset.

After release, verify the default branch, tag, release asset, checksum, and raw manifest from GitHub before installing. Retain `autoUpdate: false` unless the fork owner explicitly changes the update policy.

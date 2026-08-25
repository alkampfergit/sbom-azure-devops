# Contributing and CI

## GitHub Actions workflows (`.github/workflows/`)

| Workflow            | Trigger                          | What it does                                                                                                                                                                                              |
| ------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build.yml`         | push/PR to `main`                | Node 20.1.x, `npm install`, `npm run build`, `npm test`. The baseline "does it compile and pass tests" gate.                                                                                              |
| `prettier.yml`      | push/PR to `main`                | `npm install`, `npm run format:check`. Fails on unformatted files.                                                                                                                                        |
| `codespell.yml`     | push/PR to `main`                | Runs [`codespell-project/actions-codespell`](https://github.com/codespell-project/actions-codespell) against the whole repo (config: `.codespellrc` — skips `node_modules`, `package-lock.json`, `*.js`). |
| `tfx-extension.yml` | push to `main`, and any tag push | The release pipeline — see below.                                                                                                                                                                         |

## Release pipeline (`tfx-extension.yml`)

1. Checkout with full history (`fetch-depth: 0`, required for GitVersion).
2. **GitVersion** (`gittools/actions/gitversion`, config `GitVersion.yml`: `main` branch → `ci`
   label, PRs → `pr` label) computes `majorMinorPatch`.
3. `cschleiden/replace-tokens` substitutes `MAJOR_MINOR_PATCH` / `BUILD_NUMBER`
   (`github.run_number`) into the `#{...}#` placeholders inside
   `vss-extension.overrides.*.json`.
4. `jq` stamps the same major/minor into `task/task.json`'s `version`, and `github.run_number` into
   its `Patch`.
5. `npm install`, `npm run build`, `npm test`.
6. `npm run package:dev` and `npm run package:prod` — produces `dist/dev/*.vsix` and
   `dist/prod/*.vsix`.
7. Uploads both as a single `drop` artifact.
8. **`publish` job** (needs `build`):
   - Downloads the `drop` artifact.
   - On a tag push: creates/updates a **draft** GitHub Release with both `.vsix` files attached
     (`ncipollo/release-action`).
   - On push to `main`: `tfx-cli extension publish` the **dev** vsix, shared with `rhyskoedijk`
     (the maintainer's own org) — using `secrets.AZURE_DEVOPS_EXTENSION_TOKEN`. This is the
     "public listing stays untouched, but the maintainer gets a fresh private build to smoke-test
     on every `main` push" step — the same mechanism described for you in
     [Manual Private Install](Manual-Private-Install.md), just automated for the upstream repo's
     own testing org.
   - On a tag push: `tfx-cli extension publish` the **prod** vsix — this is the actual public
     Marketplace release.

If you're working in a fork, `AZURE_DEVOPS_EXTENSION_TOKEN` won't be set for you (it's a repo
secret on the upstream repo), so the `publish` job's marketplace-publish steps will simply fail
open (no token) — that's expected in a fork; use
[Manual Private Install](Manual-Private-Install.md) to test against your own org/publisher
instead of relying on this workflow.

## Dependabot (`.github/dependabot.yml`)

Weekly (Saturdays, 06:00 Pacific/Auckland), npm ecosystem, across all four `package.json` locations
(`/`, `/shared`, `/task`, `/ui`), targeting `main`. `react`/`react-dom` are pinned below `17.0.0`
until `azure-devops-ui` supports newer React — don't manually bump those past that ceiling either.

## Local pre-commit hook

`.husky/pre-commit`: `pretty-quick --staged` then `codespell`. See
[Local Development § Pre-commit hook](Local-Development.md#pre-commit-hook).

## Cutting a release (maintainer flow)

Versioning is entirely GitVersion-driven from commit history/branch — there's no manual "bump
version and commit" step for a release. To ship a public release: tag `main` at the desired commit
(`git tag vX.Y.Z && git push --tags` — coordinate with the maintainer/repo owner since this
triggers a real Marketplace publish via CI); GitVersion + the workflow above handle the rest.

## Syncing `docs/wiki/` to the GitHub Wiki

`docs/wiki/*.md` here is the source of truth (PR-reviewed like any other code change). The
[GitHub Wiki](../../wiki) is a mirror, kept in a **separate** git repo
(`<this-repo>.wiki.git`) that GitHub manages alongside the main repo. Don't edit pages directly on
the wiki — edits made there aren't tracked anywhere else and will be silently overwritten by the
next sync.

To publish the current `docs/wiki/` content to the GitHub Wiki:

```bash
# one-time: make sure the Wiki feature is enabled for the repo (Settings → Features → Wikis),
# or: gh api -X PATCH repos/<owner>/<repo> -f has_wiki=true

git clone https://github.com/<owner>/<repo>.wiki.git /tmp/<repo>-wiki
cp docs/wiki/*.md /tmp/<repo>-wiki/
cd /tmp/<repo>-wiki
git add -A
git commit -m "Sync wiki from docs/wiki/"
git push
```

Filenames under `docs/wiki/` are already chosen to match GitHub Wiki page-name conventions
(`Home.md` is the landing page; hyphenated titles like `Manual-Private-Install.md` become "Manual
Private Install" in the wiki sidebar) — a straight file copy is sufficient, no renaming needed.
This isn't currently automated as a CI step; treat it as a manual "publish docs" action after
merging documentation changes to `main`.

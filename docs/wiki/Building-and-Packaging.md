# Building and Packaging

This page covers turning built `task/dist` + `ui/dist` output into an installable `.vsix`. For the
"then what" — actually getting that `.vsix` into an org without a public Marketplace listing — see
[Manual Private Install](Manual-Private-Install.md).

## The three manifest variants

The base manifest is `vss-extension.json`. Two override files layer a handful of fields on top of
it at package time (`tfx-cli extension create --overrides-file <file>` deep-merges the override
JSON over the base):

| Variant   | Manifest used                         | `id`              | `name`                  | `public` | `baseUri`                 |
| --------- | ------------------------------------- | ----------------- | ----------------------- | -------- | ------------------------- |
| **local** | `vss-extension.json` (no override)    | `sbom-tool-local` | `SBOM Tool [LOCALHOST]` | `false`  | `https://localhost:3000/` |
| **dev**   | + `vss-extension.overrides.dev.json`  | `sbom-tool-dev`   | `SBOM Tool [DEV]`       | `false`  | `null`                    |
| **prod**  | + `vss-extension.overrides.prod.json` | `sbom-tool`       | `SBOM Tool`             | `true`   | `null`                    |

Root npm scripts:

```bash
npm run package        # node vss-extension.version.increment.js && tfx-cli extension create --manifests vss-extension.json --output-path dist
npm run package:dev     # tfx-cli extension create --manifests vss-extension.json --output-path dist/dev  --overrides-file vss-extension.overrides.dev.json
npm run package:prod     # tfx-cli extension create --manifests vss-extension.json --output-path dist/prod --overrides-file vss-extension.overrides.prod.json
```

`tfx-cli` runs via `npx` — no global install needed. Note only `package` (not `package:dev`/
`package:prod`) runs the version-increment script first.

## `baseUri` — packaged files vs. loopback dev

`vss-extension.json`'s `files` array marks `ui/dist` as `addressable: true`. When `baseUri` is set
(the local variant), Azure DevOps loads the report-tab iframe's HTML/JS from that URL instead of
from the files bundled in the `.vsix` — so pairing it with `npm run start:ui` (which serves on that
exact origin) lets you edit `ui/` and just refresh the ADO browser tab, no repackage/reinstall. The
`dev`/`prod` variants set `baseUri: null` so the `ui/dist` files are always fully embedded in the
package instead — the only way to get a `.vsix` that works without your dev machine's server
running. **`task/dist` is always fully packaged regardless of `baseUri`** — only UI iframe content
is affected by it, since the task itself runs on a pipeline agent, not in a browser.

## Versioning — three numbers that can drift independently

1. **`vss-extension.json`'s own `version`** (the extension package version, `Major.Minor.Patch`,
   what Azure DevOps shows as "extension version"). Only used by the base/"local" manifest variant.
2. **The override files' `version`** — literally the placeholder string
   `"#{MAJOR_MINOR_PATCH}#.#{BUILD_NUMBER}#"` in both `vss-extension.overrides.dev.json` and
   `vss-extension.overrides.prod.json`, resolved by [`build.ps1`](#buildps1--the-real-build-job-runnable-anywhere)
   (locally or in CI — see below) using GitVersion for `MAJOR_MINOR_PATCH` and either
   `github.run_number` (in CI) or a date-based fallback (locally) for `BUILD_NUMBER`.
3. **`task/task.json`'s own `version.{Major,Minor,Patch}`** (the _task_'s version, independent of
   the extension package version — Azure DevOps pipelines pin a task by this). Also stamped by
   `build.ps1`, from the same GitVersion output + build number.

### `build.ps1` — the real `build` job, runnable anywhere

`build.ps1` (repo root) _is_ the CI `build` job now — `.github/workflows/tfx-extension.yml` just
runs `./build.ps1 -BuildNumber ${{ github.run_number }}` (see
[Contributing and CI](Contributing-and-CI.md#release-pipeline-tfx-extensionyml)). The same script
runs identically on a GitHub-hosted Ubuntu runner or on a local Windows/macOS/Linux machine, via
PowerShell 7 (`pwsh`) — preinstalled on GitHub-hosted runners, and cross-platform to install
elsewhere. It:

1. Installs `GitVersion.Tool` as a `dotnet` global tool if `dotnet-gitversion` isn't already on
   `PATH`, then runs it to compute `MajorMinorPatch` from your actual git tag/commit history — the
   same underlying GitVersion tool the `gittools/actions/gitversion` GitHub Action used to wrap,
   just invoked directly.
2. Replaces the `#{MAJOR_MINOR_PATCH}#`/`#{BUILD_NUMBER}#` tokens in every
   `vss-extension.overrides.*.json` (a plain text substitution — same effect as the old
   `cschleiden/replace-tokens` CI step).
3. Stamps `task/task.json`'s `version.{Major,Minor,Patch}`, the same way the old inline `jq` CI
   step did, just via PowerShell's native JSON cmdlets.
4. Runs `npm install`, `npm run build`, `npm test`, `npm run package:dev`, `npm run package:prod` —
   identical to before.

```powershell
./build.ps1                                      # local build; build number = date-based (YMMDDHHmm)
./build.ps1 -BuildNumber $env:GITHUB_RUN_NUMBER  # what CI actually runs
./build.ps1 -SkipTests                           # skip `npm test` for a faster local iteration
```

Steps 2–3 mutate tracked files on disk (`task/task.json`, both override files) — this is
intentional (CI does the same thing in its own throwaway checkout) but means you'll see a git diff
afterward. Revert it if you don't intend to commit a version bump:

```bash
git checkout -- task/task.json vss-extension.overrides.dev.json vss-extension.overrides.prod.json
```

For real git history (tags), GitVersion needs your fork's history to actually descend from
upstream's release tags — if you forked before adding an `upstream` remote, run
`git remote add upstream https://github.com/rhyskoedijk/sbom-azure-devops.git && git fetch upstream --tags`
once so those tags are visible locally; GitHub doesn't copy a fork's parent tags automatically.

**If you don't have/want `dotnet`**, the old manual paths still work — they just don't compute a
"real" GitVersion-derived number:

- Plain `npm run package` — packages the base (`local`) manifest, which has a real starting
  version (`0.0.0.0`) and is auto-bumped by `vss-extension.version.increment.js` (sets
  `task/task.json`'s `version.Patch` to a date-derived number, mirrors it into
  `vss-extension.json`'s `version`).
- Hand-edit an override file's placeholder to a literal value, then `npm run package:dev`/`:prod`
  as usual. `tfx-cli` also supports `--rev-version` to auto-increment just the patch number.

## Checking package size

Azure DevOps extensions have a soft 50MB `.vsix` limit before Microsoft asks you to optimize.
Contributors to this repo's dependency tree (`@vizdom/vizdom-ts-node`'s WASM binary,
`azure-devops-ui`, `recharts`) are the most likely source of bloat growth — if a package starts
approaching the limit, look at deduplicating dependencies between `task`/`ui`/`shared`,
tree-shaking harder, or fetching large binaries at pipeline run time instead of bundling them
(this is already how `sbom-tool` itself is handled).

## Publisher identity

The manifest's `publisher` is `rhyskoedijk`. To package/publish under a different identity (e.g.
your own fork), change `"publisher"` (and, if you want a distinct listing rather than an update to
the same one, `"id"`) in `vss-extension.json` before packaging — the `publisher` value must match a
Marketplace publisher account you actually control. See
[Manual Private Install § Prerequisite](Manual-Private-Install.md#prerequisite-a-marketplace-publisher-you-control).

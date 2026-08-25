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
   what Azure DevOps shows as "extension version").
2. **The override files' `version`** — literally the placeholder string
   `"#{MAJOR_MINOR_PATCH}#.#{BUILD_NUMBER}#"` in both `vss-extension.overrides.dev.json` and
   `vss-extension.overrides.prod.json`. These are token-replaced **only in CI**
   (`.github/workflows/tfx-extension.yml`), using `gittools/actions/gitversion` (config:
   `GitVersion.yml` — `main` branch → `ci` label, PRs → `pr` label) to compute
   `majorMinorPatch`, then `cschleiden/replace-tokens` substitutes
   `MAJOR_MINOR_PATCH`/`BUILD_NUMBER` (the latter is `github.run_number`) into both override files.
3. **`task/task.json`'s own `version.{Major,Minor,Patch}`** (the _task_'s version, independent of
   the extension package version — Azure DevOps pipelines pin a task by this). In CI this is set
   via `jq` from the same GitVersion output + `github.run_number`.

**There is no local equivalent of step 2's token replacement.** If you run `npm run package:dev` or
`npm run package:prod` without first hand-editing the placeholder, `tfx-cli` will fail on an invalid
semver string. Two ways to package locally:

- **Simplest**: use plain `npm run package`. It packages the base (`local`) manifest, which has a
  real starting version (`0.0.0.0`) and is auto-bumped by `vss-extension.version.increment.js`:
  that script sets `task/task.json`'s `version.Patch` to a date-derived number (`YMMDDHHmm`, e.g.
  `2510251430`), then mirrors `task.json`'s `Major.Minor.Patch` into `vss-extension.json`'s
  `version`. This also means `npm run package` **mutates `task/task.json` and `vss-extension.json`
  on disk** — expect a git diff after running it; don't commit that diff unless you intend to bump
  the checked-in version.
- **For a `dev`/`prod`-style fully self-contained build**: hand-edit the placeholder in the override
  file to a real value first, e.g.:
  ```json
  { "id": "sbom-tool-dev", "name": "SBOM Tool [DEV]", "version": "0.1.0", "public": false, "baseUri": null }
  ```
  then run `npm run package:dev` as usual. `tfx-cli` also supports `--rev-version` to
  auto-increment just the patch number and persist it back to the manifest, if you'd rather not
  hand-pick a version each time.

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

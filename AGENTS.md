# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. This file is the canonical
entry point for repo context — the only other hand-written doc is [`README.md`](README.md), which
is **end-user** facing (marketplace listing content, pipeline YAML usage example). Everything about
building, packaging and locally installing the extension lives here instead.

## What this is

Unofficial Azure DevOps extension that wraps Microsoft's [`sbom-tool`](https://github.com/microsoft/sbom-tool)
to generate SPDX SBOM manifests during a pipeline build, and adds a "SBOM" build-results tab UI to
view/browse the generated manifest (packages, licenses, suppliers, GitHub Advisory security
vulnerabilities, dependency graph, XLSX export).

Upstream project: https://github.com/rhyskoedijk/sbom-azure-devops (publisher id `rhyskoedijk`,
marketplace listing `rhyskoedijk.sbom-tool`). If you are packaging/publishing under your own
identity (see below), you'll need to change the `publisher` field in `vss-extension.json`.

## Repo layout (npm workspaces-by-convention monorepo, not actual npm workspaces)

Root `package.json` has **no dependencies of its own** — it only orchestrates 3 independent
sub-projects, each with its own `package.json`/`package-lock.json`/`node_modules`:

| Dir       | Purpose                                                                                                                                                                                                                                                                        | Runtime target                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `shared/` | Pure TypeScript, no bundler of its own. SPDX 2.3 model/types, SPDX→XLSX / SPDX→SVG conversion, SPDX document merging, GHSA (GitHub Advisory) API client, small `Array`/`Number`/`String` prototype extensions.                                                                 | consumed as **source**, not a package             |
| `task/`   | The Azure Pipelines task (`sbom-tool` task, id `79d7e0df-bd9a-4658-9897-ae059fc992c5`). Node.js, runs `sbom-tool` CLI (auto-installed via brew/winget/curl if missing), post-processes the SPDX output (security advisories, XLSX, SVG), attaches files to the build timeline. | Node20_1 agent handler (webpack `target: 'node'`) |
| `ui/`     | The "SBOM" build-results tab. React + `azure-devops-ui`/`azure-devops-extension-sdk`, reads SPDX JSON build attachments via the Build REST API and renders package/license/vulnerability tables + a zoom/pan SVG relationship graph.                                           | browser (webpack `target: 'web'`)                 |
| `tests/`  | Fixture data only (`tests/spdx/manifest.spdx.json`) — no test runner config here.                                                                                                                                                                                              | —                                                 |

`shared/` is **not** an npm package — `task/` and `ui/` import it via relative paths
(e.g. `import { ... } from '../../shared/spdx/...'`), and each side's own webpack config compiles
those `.ts`/`.tsx` files straight into its bundle. There is no path alias / `tsconfig` "paths"
mapping for it, just relative `../../shared/...` imports.

Root `package.json` → `scripts.postinstall` runs `npm install` inside `shared`, `task`, and `ui`
automatically, so a single `npm install` at the repo root is enough to bootstrap everything.

## Everyday commands (run from repo root)

```bash
npm install              # bootstraps root + shared/ + task/ + ui/ (via postinstall)

npm run build            # = build:task + build:ui (webpack --mode development, both projects)
npm run build:task       # cd task && webpack  -> task/dist/task/{index.js, task.json, icon.png, *.wasm}
npm run build:ui         # cd ui   && webpack  -> ui/dist/ui/{sbom-report-tab.js, .html}

npm test                 # jest (ts-jest), matches **/*.test.ts anywhere in the repo
npm run format           # prettier --write (ts/tsx/js/scss/json/yaml/md/html)
npm run format:check     # prettier --check (this is what CI runs)

npm run start:task       # node task/dist/task/index.js  (requires build:task first; needs ADO task-lib env vars to do anything useful)
npm run start:ui         # cd ui && webpack serve --mode development  -> https://localhost:3000 (hot-reload dev server for the report tab UI)
```

Husky `pre-commit` hook runs `pretty-quick --staged` then `codespell` — expect commits to fail if
formatting or spelling checks don't pass (see `.prettierrc.yml`, `.codespellrc`).

There is currently very little test coverage: only `shared/spdx/convertSpdxToXlsx.test.ts` and
`shared/spdx/models/2.3/document.test.ts`.

## Extension packaging model

There are **three parallel identities** for the same extension, distinguished only by which
manifest override is applied on top of the base `vss-extension.json`:

| Variant | Manifest                                 | id                | name                    | public  | baseUri                   |
| ------- | ---------------------------------------- | ----------------- | ----------------------- | ------- | ------------------------- |
| local   | `vss-extension.json` (base, no override) | `sbom-tool-local` | `SBOM Tool [LOCALHOST]` | `false` | `https://localhost:3000/` |
| dev     | `vss-extension.overrides.dev.json`       | `sbom-tool-dev`   | `SBOM Tool [DEV]`       | `false` | `null`                    |
| prod    | `vss-extension.overrides.prod.json`      | `sbom-tool`       | `SBOM Tool`             | `true`  | `null`                    |

Root scripts:

```bash
npm run package          # bumps patch version (see below), packages base manifest -> dist/*.vsix
npm run package:dev      # packages with dev override -> dist/dev/*.vsix
npm run package:prod     # packages with prod override -> dist/prod/*.vsix
```

Details that matter when packaging manually:

- **`baseUri`**: when set (as in the base/"local" manifest), Azure DevOps loads the report-tab
  iframe content from that URL instead of the files bundled in the vsix. This is what makes the
  `sbom-tool-local` variant useful for live UI development (edit `ui/`, refresh the browser, no
  repackage/reinstall needed) — but it only works while `npm run start:ui` is running on the same
  machine viewing the page, and it's brittle/self-signed-cert dependent. The `dev`/`prod` overrides
  set `baseUri: null` so the vsix is fully self-contained (files under `ui/dist` are embedded via
  the `files` entry in `vss-extension.json`, since they're marked `addressable: true`).
- **Version tokens**: `vss-extension.overrides.dev.json` / `.prod.json` contain the literal
  placeholder `"#{MAJOR_MINOR_PATCH}#.#{BUILD_NUMBER}#"`. In CI (`.github/workflows/tfx-extension.yml`)
  these get resolved by GitVersion (`GitVersion.yml`) + `cschleiden/replace-tokens` before packaging.
  **Locally there is no equivalent step** — if you run `npm run package:dev`/`package:prod` as-is,
  `tfx-cli` will fail on an invalid version string. Either hand-edit the override file's `version`
  field to a real value first, or just use plain `npm run package`, which packages the base manifest
  (static starting version `0.0.0.0` in `vss-extension.json`) and auto-bumps the patch number itself
  via `vss-extension.version.increment.js` (sets `task/task.json`'s `version.Patch` to a
  date-derived number `YMMDDHHmm`, then mirrors `Major.Minor.Patch` into `vss-extension.json`'s
  `version`).
- `task/task.json`'s own `version.{Major,Minor,Patch}` (separate from the extension's manifest
  version) is also stamped by GitVersion + a `jq` step in CI; locally it stays whatever is
  committed unless you run `npm run package` (which touches it via the increment script) or edit it
  by hand.
- `tfx-cli` is invoked via `npx` — no global install required.

## Local build → manually installing into an Azure DevOps org (no public Marketplace listing)

This is possible and is exactly how the maintainer tests before making a release public (see the
`dev` variant above and the `publish` job in `.github/workflows/tfx-extension.yml`), but there's an
important caveat: **for Azure DevOps _Services_ (dev.azure.com / cloud), there is no way to sideload
a `.vsix` directly into an org.** Every install — even a fully private, unlisted one — still goes
through the Visual Studio Marketplace _publisher_ pipeline; "private" just means you leave
`public: false` and only _share_ it with your org instead of making it publicly listed. (Azure DevOps
_Server_, the on-prem product, is different: a Team Foundation Administrator can upload a `.vsix`
straight into the server with no Marketplace involved at all — see "On-prem" below.)

### Prerequisite: a Marketplace publisher you control

The manifest's `publisher` is `rhyskoedijk`. You almost certainly don't have upload rights to that
publisher, so either:

- ask to be added as a member of that publisher account, or
- register your own publisher for free at https://marketplace.visualstudio.com/manage, then change
  `"publisher"` (and optionally `"id"`) in `vss-extension.json` / the override file you use to your
  own publisher id before packaging.

### Recommended path: fully self-contained private build (`dev` variant)

1. Edit `vss-extension.overrides.dev.json` and replace the version placeholder with a concrete
   value, e.g.:
   ```json
   { "id": "sbom-tool-dev", "name": "SBOM Tool [DEV]", "version": "0.1.0", "public": false, "baseUri": null }
   ```
2. `npm install`
3. `npm run build`
4. `npm run package:dev` → produces `dist/dev/<publisher>.sbom-tool-dev-0.1.0.vsix`
5. Upload it privately and install it into your org, either:
   - **CLI, one shot** (package+upload+share): create a PAT with **Marketplace (publish)** scope
     (or use an Entra token), then:
     ```bash
     npx tfx-cli extension publish \
       --manifests vss-extension.json --overrides-file vss-extension.overrides.dev.json \
       --auth-type pat --token <PAT> \
       --share-with <your-org-name>
     ```
   - **Web UI**: go to https://marketplace.visualstudio.com/manage → your publisher → **New
     extension → Azure DevOps** → upload the `.vsix` from step 4 (it stays private/unlisted, only
     visible to you) → right-click it → **Share/Unshare** → enter your org name.
6. In the org: **Organization Settings → Extensions → Browse Marketplace**, find it (it'll show as
   shared-with-you), **Get it free** → install.
7. To update later: rebuild, re-`create`/`publish` with a **bumped version** (`--rev-version` flag
   works with `tfx extension create`/`publish` too), then re-upload/**Update** the same extension —
   Azure DevOps auto-upgrades it for every org that already installed it. Don't delete/re-create
   unless you must.

### Faster inner loop: `sbom-tool-local` variant (UI-only iteration)

If you're only iterating on the **report tab UI** and don't need a fully portable artifact:

1. `npm run start:ui` (leave running — serves the UI on `https://localhost:3000`, self-signed cert)
2. `npm install && npm run build && npm run package` → `dist/sbom-tool-local-0.0.<patch>.vsix`
3. Upload/share/install exactly as above.
4. Because `baseUri` is `https://localhost:3000/`, the installed extension's report-tab iframe
   loads live from your dev machine — edit `ui/`, refresh the ADO browser tab, no repackage or
   reinstall needed. This only works on the machine running `start:ui` and requires accepting the
   self-signed localhost cert in that browser. The **task itself** (`task/dist`) is always fully
   packaged regardless of `baseUri` — only the UI's addressable files are affected.

### On-prem (Azure DevOps Server) alternative

If the target is Azure DevOps _Server_ rather than the cloud service, a member of the **Team
Foundation Administrators** group with **Edit instance-level information** permission can upload
the `.vsix` directly to the server (no Marketplace, no publisher account, no sharing step) via the
server's own extensions admin page. This is the closest thing to a true "sideload."

## Notes for extending this extension

- Pipeline task entry point: `task/index.ts` (`run()`), implements `generate` (runs `sbom-tool`)
  and `import` (attaches an already-generated SPDX file, skipping the `sbom-tool` CLI entirely —
  see `SbomTool.importAsync` in `task/utils/sbomTool.ts`); `validate`/`redact` are still stubbed
  with `throw new Error('Not implemented')`. Inputs are declared in `task/task.json` and must stay
  in sync with what `task/index.ts` reads via `getInput`/`getBoolInput`.
- The UI's "Upload SPDX" button (`ui/components/sbom/documentHeader.tsx`) used to only render when
  `window.location.hostname === 'localhost'` (a debug-only affordance) — this gate has been
  removed, so it's now available on any real installed extension too, as a second way to view an
  externally-generated SBOM without running the task at all (once at least one artifact tab is
  already open).
- Core orchestration of the `sbom-tool` CLI itself lives in `task/utils/sbomTool.ts`
  (`SbomTool.generateAsync`) — it locates/installs the `sbom-tool` binary, shells out to it, then
  post-processes the resulting `_manifest/spdx_2.2/manifest.spdx.json` (security advisories via
  `task/utils/spdx/addSpdxPackageSecurityAdvisories.ts`, XLSX via `shared/spdx/convertSpdxToXlsx.ts`,
  SVG via `task/utils/spdx/convertSpdxToSvg.ts`), and attaches files to the build timeline with
  `addAttachment(...)` under attachment types `spdx.json` / `spdx.svg`.
- The UI (`ui/sbom-report-tab.tsx`) discovers manifests purely by querying the Build REST API for
  attachments of type `spdx.json`/`spdx.svg` on the current build (see
  `ui/clients/azureDevOpsWebApi/build.tsx`) — it does not read build artifacts/files directly. If a
  build produced multiple SBOMs (multiple source paths), the UI also merges them into a synthetic
  "All Manifests" summary via `shared/spdx/mergeSpdxDocuments.ts`.
- SPDX 2.3 model types live under `shared/spdx/models/2.3/`; the task always generates 2.2 and only
  upgrades to 2.3 when security advisories are found (2.3 is the minimum version with an external-ref
  shape for security advisories) — see `MANIFEST_VERSION` in `task/utils/sbomTool.ts` and
  `helpMarkDown` on the `fetchSecurityAdvisories` input in `task/task.json`.
- GitHub Advisory (GHSA) lookups go through `shared/ghsa/client.ts`.
- Both `task/webpack.config.js` and `ui/webpack.config.js` set `optimization.minimize` with
  `TerserPlugin` and strip comments — don't rely on runtime code comments surviving into `dist/`.

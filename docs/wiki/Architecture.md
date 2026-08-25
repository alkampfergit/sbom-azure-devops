# Architecture

## Repo layout

A monorepo-by-convention (not npm/yarn workspaces) with 3 independently-built sub-projects, each
with its own `package.json`/`package-lock.json`/`node_modules`, plus a `shared/` source folder
consumed by both:

| Dir       | What                                                                                                                                                                  | Bundled with                                     | Output                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `shared/` | Pure TS: SPDX 2.3 model types, SPDX↔XLSX/SVG conversion, SPDX document merging, GHSA (GitHub Advisory) GraphQL client, `Array`/`Number`/`String` prototype extensions | — (compiled in-place by each consumer's webpack) | n/a — not published, consumed as source                  |
| `task/`   | The Azure Pipelines task                                                                                                                                              | webpack, `target: 'node'`                        | `task/dist/task/{index.js, task.json, icon.png, *.wasm}` |
| `ui/`     | The "SBOM" build-results tab                                                                                                                                          | webpack, `target: 'web'`                         | `ui/dist/ui/{sbom-report-tab.js, sbom-report-tab.html}`  |
| `tests/`  | Fixture data (`tests/spdx/manifest.spdx.json`) only, no runner config                                                                                                 | —                                                | —                                                        |

Root `package.json` has no dependencies of its own — `scripts.postinstall` runs `npm install`
inside `shared`, `task`, and `ui`, so one `npm install` at the root bootstraps everything (see
[Local Development](Local-Development.md)).

`shared/` is **not** an npm package. `task/` and `ui/` import its `.ts`/`.tsx` files via relative
paths (e.g. `import { ... } from '../../shared/spdx/models/2.3/document'`), and each side's own
webpack config (`ts-loader`) compiles those files straight into its own bundle. There's no
`tsconfig` path-alias for it — just plain relative imports that happen to reach up and out of the
`task`/`ui` directory.

## Data flow, end to end

```
 Pipeline run
 ┌─────────────────────────────────────────────────────────────────────┐
 │ task/index.ts  run()                                                 │
 │  → task/utils/sbomTool.ts  SbomTool.generateAsync()                  │
 │     1. locate/install the `sbom-tool` CLI (winget/brew/curl/PS)      │
 │     2. shell out: sbom-tool generate -bc <src> -b <artifacts> ...    │
 │        → writes  _manifest/spdx_2.2/manifest.spdx.json               │
 │     3. [optional] addSpdxPackageSecurityAdvisories.ts                │
 │        → queries GHSA GraphQL API per package-manager ecosystem      │
 │        → adds `externalRefs` (Security/Advisory + Security/Url)      │
 │        → bumps spdxVersion to 2.3 if any advisories were added       │
 │     4. addAttachment('spdx.json', ..., manifest.spdx.json)  ─────┐   │
 │     5. [optional] convertSpdxToXlsxAsync()  → manifest.xlsx      │   │
 │     6. [optional] convertSpdxToSvgAsync()   → manifest.svg       │   │
 │        addAttachment('spdx.svg', ..., manifest.svg)  ────────────┤   │
 └────────────────────────────────────────────────────────────────────┘   │
                                                                           │  build timeline
                                                                           │  attachments
 Build results page, "SBOM" tab (ui/sbom-report-tab.tsx)                  │
 ┌─────────────────────────────────────────────────────────────────────┐  │
 │ SDK.init() → BuildRestClient.getAttachments(type='spdx.json')  ←────┘  │
 │            → BuildRestClient.getAttachments(type='spdx.svg')   ←──────┘
 │ parse each spdx.json → IDocument[]
 │ if >1 manifest → mergeSpdxDocuments() → synthetic "All Manifests" tab
 │ render via SbomDocumentPage (Summary/Files/Packages/Licenses/Suppliers/
 │            Security Advisories/Relationship View tabs)
 └─────────────────────────────────────────────────────────────────────┘
```

Key point: the UI never reads build **artifacts**/files directly — it only reads build **timeline
attachments** of type `spdx.json`/`spdx.svg`, via a hand-written `BuildRestClient`
(`ui/clients/azureDevOpsWebApi/build.tsx`) because the published `azure-devops-extension-api`
client doesn't expose attachment-download by URL. If the task's `addAttachment(...)` calls in
`task/utils/sbomTool.ts` ever change type names, the UI's `SPDX_JSON_ATTACHMENT_TYPE` /
`SPDX_SVG_ATTACHMENT_TYPE` constants in `ui/sbom-report-tab.tsx` must change too.

## Multi-manifest handling

`buildSourcePath` (a task input) can be a directory, or a glob matching several directories — each
match produces its **own** SBOM manifest (see `task/index.ts`, which loops
`packageSourcePaths`). When the report tab finds more than one `spdx.json` attachment for a build,
it synthesizes an extra "All Manifests" document by calling `shared/spdx/mergeSpdxDocuments.ts`,
which:

- renames each document's root package + files to avoid SPDX-ID collisions,
- concatenates `files`/`packages`/`relationships`/`externalDocumentRefs`/`documentDescribes`,
- de-dupes packages by `SPDXID`.

## Extension manifest & contributions

`vss-extension.json` declares two contributions:

- `ms.vss-distributed-task.task` → the pipeline task, pointed at `task/dist` (see `task/task.json`
  for the task's own id/inputs/version).
- `ms.vss-build-web.build-results-tab` → the "SBOM" tab, pointed at
  `ui/sbom-report-tab.html`, restricted to builds that ran task id
  `79d7e0df-bd9a-4658-9897-ae059fc992c5` (`task/task.json`'s `id`) via `supportsTasks`.

See [Building and Packaging](Building-and-Packaging.md) for the manifest variants and versioning
model, and [Task Reference](Task-Reference.md) for the full input list.

## Notable third-party pieces

- `sbom-tool` itself is **not vendored** — the task installs it on the agent at run time (brew /
  winget / raw GitHub-release download via curl or PowerShell), unless it's already on `PATH` or in
  `Agent.ToolsDirectory`.
- `@vizdom/vizdom-ts-node` (WASM) renders the relationship graph to SVG **on the agent**, inside
  `task/utils/spdx/convertSpdxToSvg.ts` — there's a `TODO` in the code to eventually move this to
  the browser instead (the UI's "Relationship View" tab currently just displays the pre-rendered SVG
  with pan/zoom via `react-zoom-pan-pinch`, it doesn't render the graph itself).
- `azure-devops-ui` / `azure-devops-extension-sdk` / `azure-devops-extension-api` are Microsoft's
  official Azure DevOps extension SDK/UI kit — see the
  [`azure-devops-extension-sample`](https://github.com/Microsoft/azure-devops-extension-sample) repo
  for the canonical reference if you need SDK API docs beyond what's used here.

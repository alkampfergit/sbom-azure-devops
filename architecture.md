# Architecture

This document describes the SBOM Tool Azure DevOps extension in layers. Read the first two sections
for the big picture, then open only the sections you need. Each `<details>` block goes one level
deeper and points at the source files involved.

## Level 0: What it is

An unofficial Azure DevOps extension that wraps Microsoft's
[`sbom-tool`](https://github.com/microsoft/sbom-tool). It does two things:

1. **Pipeline task** (`task/`): runs during a build, generates an SPDX SBOM for the build's sources
   and artifacts, optionally enriches it with vulnerability data, and attaches it to the build.
2. **Build results tab** (`ui/`): adds an "SBOM" tab to the build results page that reads those
   attachments and shows packages, files, licenses, suppliers, security advisories and a
   relationship graph.

```
 Pipeline run                                   Build results page
 ┌──────────────────────────┐   attachments    ┌──────────────────────────┐
 │ task/  (Node 20 task)    │ ───────────────► │ ui/  (React tab)         │
 │  sbom-tool → SPDX JSON   │  spdx.json       │  parse SPDX, render      │
 │  + advisories / vulns    │  spdx.svg        │  tables and graph        │
 │  + XLSX / SVG exports    │                  │                          │
 └──────────────────────────┘                  └──────────────────────────┘
            both build from shared/
```

## Level 1: Components

| Area      | Role                                                                                                                      | Runs on                               | Build output                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| `task/`   | Azure Pipelines task `sbom-tool` (id `79d7e0df-bd9a-4658-9897-ae059fc992c5`). Runs `sbom-tool` and post-processes output. | Agent (`Node20_1`)                    | `task/dist/task/` (`index.js`, `task.json`, …) |
| `ui/`     | React build-results tab built on `azure-devops-ui`.                                                                       | Browser, inside Azure DevOps (iframe) | `ui/dist/ui/` (`sbom-report-tab.js` + `.html`) |
| `shared/` | SPDX 2.3 model types, SPDX→XLSX and SPDX merge logic, GitHub Advisory client, small prototype extensions.                 | Compiled into both `task/` and `ui/`  | None; consumed as source                       |
| `tests/`  | Fixture SPDX document only.                                                                                               | n/a                                   | n/a                                            |

Other top-level pieces: `vss-extension.json` (extension manifest), `build.ps1` (local and CI build),
`.github/workflows/` (CI), `docs/wiki/` (end-user and contributor wiki).

<details>
<summary><strong>Level 2: How the pieces are wired together</strong></summary>

- `shared/` is **not** an npm package. `task/` and `ui/` import its files with relative paths such as
  `../../shared/spdx/models/2.3/document`. Each side's webpack config compiles those `.ts`/`.tsx`
  files into its own bundle.
- The root `package.json` has no dependencies. Its `postinstall` runs `npm install` in `shared/`,
  `task/` and `ui/`, so one root `npm install` sets up everything.
- `ui/` and `task/` do not talk to each other directly. The only contract between them is the
  build's attachment list, identified by two type names: `spdx.json` and `spdx.svg`.
  - Producer: `task/utils/sbomTool.ts` (`addAttachment(...)` calls).
  - Consumer: `ui/sbom-report-tab.tsx` (`SPDX_JSON_ATTACHMENT_TYPE`, `SPDX_SVG_ATTACHMENT_TYPE`).
  - If one side renames a type, the other must change too.

</details>

## Level 1: Data flow

<details>
<summary><strong>Level 2: Generate path (pipeline task)</strong></summary>

Entry point: `task/index.ts` (`run()`). It reads the `command` input and switches on it:

| `command`  | Behavior                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `generate` | Runs `sbom-tool` for each source path matched by `buildSourcePath`. Multi-source runs produce one manifest per source path. |
| `import`   | Takes an existing SPDX 2.x file (`importManifestFilePath`) and skips `sbom-tool` entirely.                                  |
| `validate` | Stub: throws `Not implemented`.                                                                                             |
| `redact`   | Stub: throws `Not implemented`.                                                                                             |

`SbomTool` (`task/utils/sbomTool.ts`) owns the work:

1. **Locate or install `sbom-tool`.** Order: `PATH`, then `Agent.ToolsDirectory`, then install.
   Install uses `brew` or `winget` if present, and falls back to a direct download from the
   microsoft/sbom-tool GitHub releases with `curl` or `Invoke-WebRequest`.
2. **Run `sbom-tool generate`** with the mapped arguments (`-bc`, `-b`, `-bl`, `-pn`, `-pv`, `-ps`,
   `-nsb`, and optional flags such as `-li`, `-pm`, `-di`, `-cd`, `-er`). Large file lists go through
   a temp file (`-bl`) to avoid command-line length limits.
3. **Locate the output** at `_manifest/spdx_2.2/manifest.spdx.json` under the manifest output path.
   Multi-source runs rename files with a prefix first.
4. **Post-process** (shared by `generate` and `import`, in `postProcessManifestAsync`):
   - Security advisories from GitHub (`fetchSecurityAdvisories`).
   - Vulnerabilities from local files (`vulnerabilitiesSource`).
   - Attach `spdx.json` to the build timeline.
   - Write a `.sha256` file next to the manifest.
   - Optional XLSX export (`enableManifestSpreadsheetGeneration`).
   - Optional SVG graph, attached as `spdx.svg` (`enableManifestGraphGeneration`).

Failures on one source path are recorded and the task finishes `SucceededWithIssues`. Only a
top-level failure fails the task.

</details>

<details>
<summary><strong>Level 2: Enrichment (vulnerabilities)</strong></summary>

Two independent sources. Either or both can run.

- **GitHub Advisory Database** (`fetchSecurityAdvisories` + `gitHubConnection` / `gitHubAccessToken`).
  - `task/utils/spdx/addSpdxPackageSecurityAdvisories.ts` maps each package's `purl` to a GitHub
    ecosystem, then groups packages by ecosystem.
  - `shared/ghsa/client.ts` (`GitHubGraphClient`) queries the GitHub GraphQL API in batches of 100.
  - Results go into the package as `externalRefs` (Security / Advisory and Security / Url).
- **Local vulnerabilities file** (`vulnerabilitiesSource`, a glob).
  - Each file is a JSON array of `IExternalVulnerability`. Use it when the GitHub connection can't
    fetch data, or when another scanner supplies the data.
  - Handled by `task/utils/spdx/addSpdxPackageVulnerabilitiesFromFile.ts`. A JSON schema lives in `docs/schemas/`.

Both paths write the same `externalRefs` shape, so the UI does not need to know the source.

</details>

<details>
<summary><strong>Level 2: Display path (build results tab)</strong></summary>

Entry point: `ui/sbom-report-tab.tsx` (`Root`).

1. `SDK.init()` and `SDK.ready()` from `azure-devops-extension-sdk`.
2. Get the project and build IDs from `IProjectPageService` and `IBuildPageDataService`.
3. Query attachments with `BuildRestClient` (`ui/clients/azureDevOpsWebApi/build.tsx`). This is a
   hand-written client because the published API client does not expose attachment streams. It
   downloads each attachment through its `_links.self.href`, which the code parses with a regex.
4. Parse each `spdx.json` into an `IDocument`. Pair it with its `spdx.svg` if one exists.
5. If there is more than one manifest, build an "All Manifests" document with
   `shared/spdx/mergeSpdxDocuments.ts`.
6. Render one `SbomDocumentPage` per selected manifest.

The UI never reads build artifacts or files. It reads only build attachments.

**Manual load:** `SbomDocumentHeader` has an "Upload SPDX" control. It adds a manifest from a local
file, so an externally generated SBOM can be viewed without running the task.

</details>

## Level 1: Module boundaries

<details>
<summary><strong>Level 2: <code>shared/</code></strong></summary>

| Path                                               | Contents                                                                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/spdx/models/2.3/`                          | SPDX 2.3 types and helpers: `document`, `package`, `file`, `relationship`, `externalRef`, `license`, `checksum`, `creationInfo`. Used for both 2.2 and 2.3 input. |
| `shared/spdx/convertSpdxToXlsx.ts`                 | SPDX → XLSX workbook (used by the task; has a unit test).                                                                                                         |
| `shared/spdx/convertSpdxToSvg.ts`                  | Shared SVG helper. The graph itself is rendered in `task/utils/spdx/convertSpdxToSvg.ts`.                                                                         |
| `shared/spdx/mergeSpdxDocuments.ts`                | Merges several documents into one summary document. Renames IDs to avoid collisions.                                                                              |
| `shared/spdx/parseSpdxLegacySecurityAdvisories.ts` | Reads advisories stored in an older format, so older manifests still display.                                                                                     |
| `shared/ghsa/`                                     | GitHub Advisory client and models (`client.ts`, `models/`). `licenses.json` holds the license list.                                                               |
| `shared/models/`                                   | Small models shared by the UI and task (`sbomBuildArtifact`, `severity`, `color`).                                                                                |
| `shared/extensions/`                               | `Array`, `Number` and `String` prototype helpers. Imported for side effects, so they must be loaded before use.                                                   |

Dependency direction: `shared/` depends on nothing in `task/` or `ui/`. The other two depend on it.

</details>

<details>
<summary><strong>Level 2: <code>task/</code></strong></summary>

| Path                                        | Role                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `task/index.ts`                             | Entry point and command dispatch.                                                                    |
| `task/task.json`                            | Task manifest: id, inputs, execution (`Node20_1`), version.                                          |
| `task/utils/sbomTool.ts`                    | `SbomTool` class: install, run, post-process, attach.                                                |
| `task/utils/globs.ts`                       | Glob resolution for source, artifact and vulnerability paths.                                        |
| `task/utils/azurePipelines/accessTokens.ts` | Resolves the GitHub token from the service connection.                                               |
| `task/utils/azurePipelines/commands.ts`     | Log grouping helpers (`group`, `section`, `endgroup`).                                               |
| `task/utils/spdx/`                          | Post-processing: advisories, vulnerability files, SVG rendering.                                     |
| `task/webpack.config.js`                    | `target: 'node'`, `ts-loader`, Terser. Copies `*.wasm`, `icon.png` and `task.json` into `dist/task`. |

`convertSpdxToSvg` uses `@vizdom/vizdom-ts-node`, a WebAssembly build. The `getrandom` shim at the
top of that file must run before the import. The file has a TODO to move rendering into the browser.

Task inputs (from `task/task.json`): `command`, `buildSourcePath`, `buildArtifactPath`,
`buildDockerImagesToScan`, `importManifestFilePath`, `manifestOutputPath`, the `enable*` / `fetch*`
flags, `gitHubConnection`, `gitHubAccessToken`, `vulnerabilitiesSource`, the `package*` metadata
inputs, `additionalComponentDetectorArgs`, and `externalDocumentReferenceList`.

</details>

<details>
<summary><strong>Level 2: <code>ui/</code></strong></summary>

| Path                                             | Role                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `ui/sbom-report-tab.tsx` / `.html`               | Tab entry point. Loads attachments, merges summary, selects the manifest tab.                         |
| `ui/clients/azureDevOpsWebApi/build.tsx`         | Hand-written Build REST client for attachment listing and download.                                   |
| `ui/components/sbom/documentPage.tsx`            | One manifest's page. Computes packages, licenses, suppliers and advisories, and shows tabs.           |
| `ui/components/sbom/*Card.tsx`                   | Table and summary cards: files, packages, licenses, suppliers, security, relationship graph, summary. |
| `ui/components/sbom/vulnerabilityAggregation.ts` | Groups and counts advisories for the badge and summary.                                               |
| `ui/components/charts/`                          | Bar, pie and tile charts, plus a color palette.                                                       |
| `ui/components/expandableList.tsx`               | Shared list component.                                                                                |

Tabs on a manifest page: Summary, Files, Packages, Licenses, Suppliers, Security Advisories
(shown only when there are advisories) and Relationship View (shown only when the SVG exists).
The Relationship View displays the pre-rendered SVG with pan and zoom (`react-zoom-pan-pinch`).
It does not lay out the graph itself.

Performance: the UI computes derived data (`getDerivedStateFromProps`) once per manifest and reuses
it, and filters with `azure-devops-ui`'s `Filter`. `ui/test/` holds a perf harness and fixture
generator for large SBOMs.

</details>

## Level 1: Packaging and build

<details>
<summary><strong>Level 2: Manifest and contributions</strong></summary>

`vss-extension.json` declares:

- `ms.vss-distributed-task.task`: the task, from `task/dist`.
- `ms.vss-build-web.build-results-tab`: the "SBOM" tab, at `ui/sbom-report-tab.html`. It appears only on builds
  that ran the task (`supportsTasks`).
- `files`: `images/`, `ui/dist` (addressable, at package root) and `task/dist`.

Three variants share the base manifest, each with an override file:

| Variant | Override file                       | Extension id      | `baseUri`                 |
| ------- | ----------------------------------- | ----------------- | ------------------------- |
| local   | none (base manifest)                | `sbom-tool-local` | `https://localhost:3000/` |
| dev     | `vss-extension.overrides.dev.json`  | `sbom-tool-dev`   | `null` (self-contained)   |
| prod    | `vss-extension.overrides.prod.json` | `sbom-tool-dev`   | `null` (self-contained)   |

Note: the prod override currently uses the `sbom-tool-dev` id (see the latest commit on this branch).

With `baseUri` set, the tab loads its UI from that URL, so UI edits show up with no repackage. The
task is always packaged in full.

</details>

<details>
<summary><strong>Level 2: Build and CI</strong></summary>

- **Local build:** `npm install` then `npm run build` (`build:task` and `build:ui`, both production
  webpack). `npm test` runs Jest with two projects: `default` (`shared/` and `task/` tests) and `ui`
  (`ui/` tests, with its own TypeScript config).
- **Package:** `npm run package`, `package:dev` or `package:prod` runs `tfx-cli extension create`.
- **Versioning:** `build.ps1` runs GitVersion for `MajorMinorPatch`, then replaces the
  `#{MAJOR_MINOR_PATCH}#.#{BUILD_NUMBER}#` placeholders in the override files and updates
  `task/task.json`. It then runs install, build, test and both package steps. CI calls the same
  script, so local and CI builds match.
- **CI workflows** (`.github/workflows/`):
  - `build.yml`: install, build, test, on push and PR to `main`.
  - `prettier.yml`: `npm run format:check`.
  - `codespell.yml`: spell check.
  - `tfx-extension.yml`: runs `build.ps1` on push to `main` and on tags. Uploads the `dist/` artifact.
    On a tag, it also creates a GitHub release.
- **Pre-commit:** Husky runs `pretty-quick --staged` and `codespell`.

</details>

<details>
<summary><strong>Level 2: External dependencies</strong></summary>

| Dependency                                                                         | Used by | Why                                                                           |
| ---------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `sbom-tool` (Microsoft CLI, not vendored)                                          | task    | Generates the SPDX manifest. Installed at run time on the agent.              |
| `azure-pipelines-task-lib`                                                         | task    | Inputs, variables, attachments, logging, tool execution.                      |
| `@vizdom/vizdom-ts-node` (WASM)                                                    | task    | Renders the relationship graph to SVG.                                        |
| GitHub GraphQL API (`api.github.com/graphql`)                                      | task    | Security advisories by package.                                               |
| `azure-devops-extension-sdk`, `azure-devops-extension-api`, `azure-devops-ui`      | ui      | Host integration, REST clients and UI components.                             |
| `react-zoom-pan-pinch`                                                             | ui      | Pan and zoom for the relationship graph.                                      |
| `json-as-xlsx` (via `shared/`)                                                     | task    | XLSX export (`shared/spdx/convertSpdxToXlsx.ts`).                             |
| `axios`, `semver`, `packageurl-js`, `spdx-expression-parse`, `md5` (via `shared/`) | both    | GitHub API calls, version ranges, package URLs, license expressions, hashing. |

</details>

## Level 1: Known gaps and design decisions

<details>
<summary><strong>Level 2: Decisions worth knowing before changing things</strong></summary>

- **The UI reads attachments, not artifacts.** The Build REST API does not expose attachment streams
  in the published client, so `ui/clients/azureDevOpsWebApi/build.tsx` makes raw calls. The attachment
  URL format is parsed with a regex and has a TODO.
- **SBOM version.** The task always writes SPDX 2.2 (`MANIFEST_VERSION` in `sbomTool.ts`). The
  advisory code moves a document to 2.3, which is the first version with the external-ref shape the
  UI needs for advisories.
- **Rendering split.** Graph rendering happens on the agent with WASM (`convertSpdxToSvg.ts`), and the
  browser only displays the result. This is a deliberate shortcut with a TODO to move it.
- **`validate` and `redact` are stubs.** The inputs and branches exist, but they throw `Not implemented`.
- **Test coverage is thin.** The unit tests are `shared/spdx/convertSpdxToXlsx.test.ts`,
  `shared/spdx/models/2.3/document.test.ts`, `shared/spdx/models/2.3/externalRef.test.ts` and
  `task/utils/spdx/addSpdxPackageVulnerabilitiesFromFile.test.ts`. There are no UI component tests.
- **Failure policy.** One failing source path does not fail the whole task. Those failures are
  recorded and the task finishes `SucceededWithIssues`.

</details>

## Where to go next

- Setup and daily commands: [`AGENTS.md`](AGENTS.md)
- Full input reference: [`docs/wiki/Task-Reference.md`](docs/wiki/Task-Reference.md)
- Data model: [`docs/wiki/SPDX-and-Data-Model.md`](docs/wiki/SPDX-and-Data-Model.md)
- Build and packaging: [`docs/wiki/Building-and-Packaging.md`](docs/wiki/Building-and-Packaging.md)
- UI details: [`docs/wiki/UI-Report-Tab.md`](docs/wiki/UI-Report-Tab.md)
- Extending: [`docs/wiki/Extending-the-Extension.md`](docs/wiki/Extending-the-Extension.md)

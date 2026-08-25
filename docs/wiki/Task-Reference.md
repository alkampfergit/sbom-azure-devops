# Task Reference (`sbom-tool@1`)

Source of truth: `task/task.json` (schema-validated inputs) and `task/index.ts` (what actually
consumes them). Task id `79d7e0df-bd9a-4658-9897-ae059fc992c5`, friendly name "SBOM Tool",
`minimumAgentVersion: 3.232.1`, runtime handler `Node20_1`.

## Command support

| `command` value | Status |
|---|---|
| `generate` | ✅ implemented (the only option currently exposed in the `command` pickList) |
| `validate` | ❌ stub — `task/index.ts` throws `Not implemented` |
| `redact` | ❌ stub — `task/index.ts` throws `Not implemented` |

## Inputs

### Package Information group

| Name | Type | Default | Notes |
|---|---|---|---|
| `packageName` | string | `$(Build.Repository.Name)` | Defaults to the repo name for a single `buildSourcePath`; when `buildSourcePath` is a glob matching multiple directories, each one is named from its own directory basename instead. |
| `packageVersion` | string | `$(Build.BuildNumber)` | Falls through to `'0.0.0'` if neither the input nor `Build.BuildNumber` resolve. |
| `packageSupplier` | string | `$(System.CollectionId)` | Falls through to `'Unknown'`. Also used to derive the default namespace URI hostname (see below). |
| `packageNamespaceUriBase` | string | *(empty)* | Defaults to `https://{supplierHostnameified}.com` — the supplier string has whitespace turned into dashes, non-alphanumerics stripped, lowercased. |
| `packageNamespaceUriUniquePart` | string | *(empty)* | Appended to the SPDX namespace URI; should be globally unique if set. |

### Main / `command=generate` inputs

| Name | Type | Default | Notes |
|---|---|---|---|
| `buildSourcePath` | multiLine | `$(Build.SourcesDirectory)` | One glob per line. Each **resolved directory** produces its own SBOM. A file match is treated as its containing directory. |
| `buildArtifactPath` | multiLine | `$(Build.ArtifactStagingDirectory)` | One glob per line, resolved relative to each `buildSourcePath` match. If more than one path resolves, the task passes an explicit file list (`-bl`) to `sbom-tool` instead of a single artifact root (`-b`). |
| `buildDockerImagesToScan` | string | *(empty)* | Comma-separated image names or hashes, e.g. `ubuntu:16.04, 56bab49e...`. |
| `manifestOutputPath` | string | *(empty)* | Where the `_manifest/` folder is written. Defaults to `buildArtifactPath`. When multiple `buildSourcePath` matches exist *and* this is set, generated file names get a `{packageName}.` prefix to avoid collisions. |
| `enableManifestSpreadsheetGeneration` | boolean | `false` | Generates `manifest.xlsx` next to the SPDX JSON, via `shared/spdx/convertSpdxToXlsx.ts`. |
| `enableManifestGraphGeneration` | boolean | `false` | Generates `manifest.svg` (relationship graph), via `task/utils/spdx/convertSpdxToSvg.ts` (renders with `@vizdom/vizdom-ts-node`, WASM, runs on the agent). |
| `enablePackageMetadataParsing` | boolean | `false` | Passed to `sbom-tool` as `-pm true`; attempts to parse license/supplier from each package manager's own metadata file. |
| `fetchLicenseInformation` | boolean | `false` | Passed to `sbom-tool` as `-li true`; fetches license info from [ClearlyDefined](https://clearlydefined.io/). |
| `licenseInformationTimeoutInSeconds` | string | *(empty → sbom-tool's own default of 30)* | Passed as `-lto`. Negative = infinite timeout. Only meaningful with `fetchLicenseInformation=true`. |
| `fetchSecurityAdvisories` | boolean | `false` | If true, enriches the manifest with GitHub Advisory Database results (see below). Requires `gitHubConnection` or `gitHubAccessToken`. Any advisories found bump the SPDX document to version **2.3** (minimum version with an advisory-shaped external ref). |
| `gitHubConnection` | connectedService (`github`: OAuth/PAT/InstallationToken/Token) | *(empty)* | Visible only when `fetchSecurityAdvisories=true`. |
| `gitHubAccessToken` | string | *(empty)* | Alternative to `gitHubConnection` — use when a service connection isn't practical. Visible only when `fetchSecurityAdvisories=true`. Resolution order in `task/utils/azurePipelines/accessTokens.ts`: `gitHubAccessToken` input wins if set, else the token is extracted from the `gitHubConnection` endpoint (supports `PersonalAccessToken`/`OAuth`/`Token` auth schemes). |

### Advanced group

| Name | Type | Default | Notes |
|---|---|---|---|
| `additionalComponentDetectorArgs` | string | *(empty)* | Passed straight through as extra `--key value` pairs to [Component Detector](https://github.com/microsoft/component-detection) (see its [detector-arguments docs](https://github.com/microsoft/component-detection/blob/main/docs/detector-arguments.md)). |
| `externalDocumentReferenceList` | string | *(empty)* | One external SPDX 2.x SBOM path per line, included as external document references. **Note:** `task.json`'s input name is `externalDocumentReferenceList`, but `task/index.ts` reads `externalDocumentReferenceListFile` — check current source before relying on this input; see [Troubleshooting](Troubleshooting.md#task-reference-mismatches). |

## sbom-tool auto-install behavior

`SbomTool.getToolPathAsync()` in `task/utils/sbomTool.ts` resolution order:
1. `sbom-tool` already on `PATH` (via `which`).
2. Already present at `{Agent.ToolsDirectory}/sbom-tool` (Linux/macOS) or
   `{Agent.ToolsDirectory}\sbom-tool.exe` (Windows).
3. Otherwise, install it:
   - **Linux/macOS**: `brew install sbom-tool[@version]` if Homebrew is present, else download the
     matching `sbom-tool-linux-{arch}` binary from the
     [microsoft/sbom-tool releases](https://github.com/microsoft/sbom-tool/releases) via `curl`
     and `chmod +x` it.
   - **Windows**: `winget install Microsoft.SbomTool [--version x]` if winget is present, else
     download `sbom-tool-win-{arch}.exe` via PowerShell `Invoke-WebRequest`.

The task's `version` input (not shown above — it's read directly via `getInput('version', false)`
in `task/index.ts`, not declared as a distinct entry in `task.json`'s `inputs`) pins the
`sbom-tool` CLI version to install/use.

## YAML examples

Minimal:
```yaml
- task: sbom-tool@1
  displayName: 'Generate project SBOM manifest'
  inputs:
    command: 'generate'
```

Full, matching the [`README.md`](../../README.md) example (spreadsheet + graph + license +
security-advisory enrichment):
```yaml
- task: sbom-tool@1
  displayName: 'Generate project SBOM manifest'
  inputs:
    command: 'generate'
    buildSourcePath: '$(Build.SourcesDirectory)'
    buildArtifactPath: '$(Build.ArtifactStagingDirectory)'
    enableManifestSpreadsheetGeneration: true
    enableManifestGraphGeneration: true
    enablePackageMetadataParsing: true
    fetchLicenseInformation: true
    fetchSecurityAdvisories: true
    gitHubConnection: 'GitHub Advisory Database Connection'
    packageSupplier: 'MyOrganisation'
    packageName: 'MyPackage'
    packageVersion: '$(Build.BuildNumber)'
```

Multiple source directories (one SBOM per match), each artifact directory resolved relative to its
own source directory:
```yaml
- task: sbom-tool@1
  inputs:
    command: 'generate'
    buildSourcePath: |
      $(Build.SourcesDirectory)/services/*
    buildArtifactPath: |
      $(Build.ArtifactStagingDirectory)/**
    manifestOutputPath: '$(Build.ArtifactStagingDirectory)'
```

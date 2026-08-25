# Troubleshooting

## Build / local dev

**`npm install` doesn't seem to install `task`/`ui`/`shared` dependencies.**
Root `package.json` has no dependencies itself — installation of the sub-projects happens via the
`postinstall` script. If it didn't run (e.g. `npm install --ignore-scripts`), run
`npm --prefix shared install && npm --prefix task install && npm --prefix ui install` manually.

**Pre-commit hook rejects my commit.**
`.husky/pre-commit` runs `pretty-quick --staged` then `codespell`. Run `npm run format`, fix any
flagged words, re-stage, and commit again. See [Local Development](Local-Development.md#format--lint).

**`npm run start:ui` shows a certificate warning.**
Expected — `webpack-dev-server` uses a self-signed HTTPS cert (Azure DevOps requires HTTPS for
extension iframes). Visit `https://localhost:3000/` directly once and accept the warning before
relying on it inside an installed extension's iframe.

## Task reference mismatches

`task/task.json` declares an input named **`externalDocumentReferenceList`**, but
`task/index.ts` reads it via `getInput('externalDocumentReferenceListFile', false)`. Because the
names don't match, the pipeline-supplied value never reaches the task — `externalDocumentReferenceListFile`
always resolves `undefined`, silently. If you rely on this input, or you're fixing it, decide
whether to rename the `task.json` input to match the code, or fix the code to read
`externalDocumentReferenceList` — then update [Task Reference](Task-Reference.md) and the README
accordingly. This class of bug (declared input name ≠ `getInput(...)` argument) has no compiler or
runtime check, so it's worth grepping for whenever you touch `task.json`:

```bash
# sanity-check every task.json input name is actually read somewhere in task/index.ts or task/utils/**
```

## Packaging / install

**`tfx-cli extension create`/`publish` fails with an invalid version error.**
You're almost certainly packaging `vss-extension.overrides.dev.json` or `.prod.json` without
resolving the `#{MAJOR_MINOR_PATCH}#.#{BUILD_NUMBER}#` placeholder — that token substitution only
happens in CI (GitVersion + `cschleiden/replace-tokens`). Hand-edit the override file's `version`
to a real value first, or use plain `npm run package` (base manifest, auto-bumped). See
[Building and Packaging § Versioning](Building-and-Packaging.md#versioning--three-numbers-that-can-drift-independently).

**Upload to the Marketplace management portal fails with a publisher/permission error.**
The `.vsix`'s `publisher` field must match a Marketplace publisher account you're a member of.
Either get added to the `rhyskoedijk` publisher, or change `"publisher"` in `vss-extension.json`
(and probably `"id"`) to your own publisher before packaging. See
[Manual Private Install § Prerequisite](Manual-Private-Install.md#prerequisite-a-marketplace-publisher-you-control).

**`tfx-cli extension publish` fails with an auth error.**
Your PAT needs the **Marketplace (publish)** scope specifically (not just "read"), created from
`https://dev.azure.com/{org}/_usersSettings/tokens`, or use a Microsoft Entra token as described in
Microsoft's [publish-from-the-command-line docs](https://learn.microsoft.com/azure/devops/extend/publish/command-line).

**Extension installs, but I don't see the "SBOM" tab on a build.**

- Confirm the build actually ran the `sbom-tool` task (contribution's `supportsTasks` restricts the
  tab to builds that ran task id `79d7e0df-bd9a-4658-9897-ae059fc992c5`).
- Confirm the task run actually attached files — check the build log for the `addAttachment(...)`
  calls in `task/utils/sbomTool.ts` (search the log for `Generate SBOM for`); if `sbom-tool
generate` itself failed, no attachment is created and the tab will show "No artifacts found."
- If you're on the `sbom-tool-local` variant (`baseUri: https://localhost:3000/`) and aren't running
  `npm run start:ui` on the viewing machine, the tab iframe has nothing to load from — use the
  `dev`/`prod` variant instead for anyone besides your own dev machine. See
  [Manual Private Install](Manual-Private-Install.md).

**`sbom-tool` fails to install on the agent.**
`SbomTool.getToolPathAsync()` (`task/utils/sbomTool.ts`) tries brew/winget first, then falls back
to downloading directly from
[microsoft/sbom-tool releases](https://github.com/microsoft/sbom-tool/releases) via curl/PowerShell.
Failures here are usually: no outbound internet access from the agent (self-hosted, locked-down
network), an unsupported `Agent.OSArchitecture`, or a pinned `version` input that doesn't exist as
a release asset. Check `Agent.OS`/`Agent.OSArchitecture` and try installing that exact
release/architecture combination manually on the agent to confirm.

**GitHub Advisory (GHSA) enrichment finds nothing / errors out.**

- `fetchSecurityAdvisories: true` requires a working `gitHubConnection` or `gitHubAccessToken` — see
  `task/utils/azurePipelines/accessTokens.ts` for how the token is resolved; a misconfigured
  service connection scheme (anything other than `PersonalAccessToken`/`OAuth`/`Token`) throws.
  Only Advisory Database read access is needed on the token (public GHSA data), no repo scopes.
- A whole ecosystem's packages silently get **no** advisory lookup if their PURL type isn't mapped
  in `getGhsaEcosystemFromPackageUrl` — see
  [SPDX and Data Model § GitHub Advisory enrichment](SPDX-and-Data-Model.md#github-advisory-ghsa-enrichment).
- Partial GraphQL batch failures are logged as a `console.warn` and skipped rather than failing the
  task (`GitHubGraphClient.batchGraphQueryAsync`) — check the pipeline log for
  `Request batch [...] failed` if advisory data looks incomplete rather than absent.

## UI

**Relationship View tab doesn't appear.**
It only renders when the artifact has a matching `spdx.svg` build attachment — which requires
`enableManifestGraphGeneration: true` on the task **and** a build that actually reached the SVG
generation step (it runs after XLSX generation, near the end of `SbomTool.generateAsync`).

**A manifest looks fine in the JSON but licenses/suppliers/advisories are missing from their tabs.**
Those tabs are populated by `SbomDocumentPage.getDerivedStateFromProps`
(`ui/components/sbom/documentPage.tsx`), which reads specific external-ref shapes/expressions —
check the SPDX package's `licenseConcluded`/`licenseDeclared` expression parses cleanly via
`getLicensesFromExpression`, and that any security advisory external ref matches either the
current (`Security`/`Url`, base64 JSON) or legacy encoding
(`parseSpdxLegacySecurityAdvisories`) — see [SPDX and Data Model](SPDX-and-Data-Model.md).

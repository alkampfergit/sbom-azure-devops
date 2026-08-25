# UI Report Tab ("SBOM" build-results tab)

Entry point: `ui/sbom-report-tab.tsx` (webpack entry `sbom-report-tab`, HTML shell
`ui/sbom-report-tab.html`). Registered in `vss-extension.json` as contribution
`sbom-tool-build-results-tab` (type `ms.vss-build-web.build-results-tab`), restricted via
`supportsTasks: ["79d7e0df-bd9a-4658-9897-ae059fc992c5"]` to builds that ran this extension's task.

## Bootstrap sequence

1. `SDK.init()` / `SDK.ready()` (from `azure-devops-extension-sdk`) — establishes the iframe↔host
   handshake with the Azure DevOps page hosting the tab.
2. Resolve the current project (`IProjectPageService.getProject()`) and current build
   (`IBuildPageDataService.getBuildPageData()`) via `azure-devops-extension-api`'s
   `CommonServiceIds`/`BuildServiceIds`.
3. Fetch build-timeline attachments of type `spdx.json` and `spdx.svg` for that build, using a
   **hand-rolled** REST client: `ui/clients/azureDevOpsWebApi/build.tsx`'s `BuildRestClient`
   (extends `RestClientBase`, API version `5.0`). This exists because the published
   `azure-devops-extension-api` Build client doesn't expose a way to download an individual
   attachment's byte stream by URL — `getAttachment(...)` here parses the attachment's `_links.self.href`
   with a regex to pull out `{projectId}/{buildId}/{timelineId}/{recordId}/{type}/{name}` and issues
   the request itself (`httpResponseType: 'application/octet-stream'`).
4. For each `spdx.json` attachment: download it, `JSON.parse` as `IDocument`, and look for a
   matching `spdx.svg` attachment (same name with `spdx.json` → `spdx.svg`) to lazily load later
   (`loadSvgDocumentAsync`, only invoked if/when the "Relationship View" tab is opened).
5. If more than one manifest was found, synthesize an extra "All Manifests" entry via
   `mergeSpdxDocuments` (see [SPDX and Data Model](SPDX-and-Data-Model.md)) and default the
   selected tab to it; otherwise default to the single manifest.

## Manual upload fallback

Independently of build attachments, `Root.loadSbomArtifactsFromFileUpload(files)` lets a user
upload their own SPDX JSON file(s) from disk, surfaced as an **"Upload SPDX"** command-bar item in
`SbomDocumentHeader` (`ui/components/sbom/documentHeader.tsx`, `getCommandBarItems`), threaded down
via the `onLoadArtifacts` prop through `SbomDocumentPage`. Useful for viewing a manifest that wasn't
produced by a build on this org (e.g. generated elsewhere, or from an older run) using the same
rendering UI.

Until recently this button only rendered when `window.location.hostname === 'localhost'` — i.e. it
was a debug-only affordance that never actually appeared for a real installed extension (only
during the maintainer's own `sbom-tool-local` + `start:ui` loopback dev loop). That gate has been
removed, so the button is now generally available. Two caveats remain:

- It's still only reachable once at least one artifact is already loaded — `SbomDocumentHeader`
  (and its command bar) only renders once `state.artifacts.length >= 1` in `documentPage.tsx`. The
  "SBOM" tab itself is still gated by `supportsTasks` (see [Architecture](Architecture.md)), so a
  build that never ran this task still won't show the tab at all — uploading a file only helps once
  you're already looking at _some_ artifact.
- For a build-integrated (no manual clicking) way to attach an externally-generated SBOM, prefer
  the task's `import` command instead — see
  [Task Reference § Import command](Task-Reference.md#import-command).

## Component tree

```
Root (sbom-report-tab.tsx)
 └─ if multiple artifacts: TabList (one Tab per artifact + "All Manifests") + TabContent
     └─ SbomDocumentPage (documentPage.tsx)                       — one per selected artifact
         ├─ SbomDocumentHeader (documentHeader.tsx)                — title, file-upload button
         └─ TabBar: Summary / Files / Packages / Licenses / Suppliers / Security Advisories / Relationship View
             ├─ SpdxSummaryCard        (spdxSummaryCard.tsx)       — counts + charts (bar/pie/tile, ui/components/charts/*)
             ├─ SpdxFileTableCard      (spdxFileTableCard.tsx)
             ├─ SpdxPackageTableCard   (spdxPackageTableCard.tsx)   — also surfaces packageAncestorPathsDialog.tsx (dependency chain)
             ├─ SpdxLicenseTableCard   (spdxLicenseTableCard.tsx)
             ├─ SpdxSupplierTableCard  (spdxSupplierTableCard.tsx)
             ├─ SpdxSecurityTableCard  (spdxSecurityTableCard.tsx)   — + vulnerabilitiesSummaryBadge.tsx
             └─ SpdxRelationshipCard   (spdxRelationshipCard.tsx)    — pan/zoom SVG viewer (react-zoom-pan-pinch)
```

All built with Microsoft's `azure-devops-ui` component kit (`Page`, `TabBar`, `Tab`, `Filter`

- `InlineKeywordFilterBarItem` for the shared keyword filter bar across table tabs,
  `ObservableValue`/`Observer` for the tab-selection state pattern used throughout).

`SbomDocumentPage.getDerivedStateFromProps` is where most of the per-artifact derived data is
computed once per artifact change:

- `packages` — all SPDX packages **excluding** the document's own root/described package
  (`isPackageRootLevel`).
- `securityAdvisories` — for each package, tries the new-style `externalRefs`
  (`Security`/`Url`, base64 JSON — see [SPDX and Data Model](SPDX-and-Data-Model.md)) first, falls
  back to `parseSpdxLegacySecurityAdvisories(pkg)` for older manifests, de-duped by advisory
  permalink.
- `licenses` — every package's resolved license **expression** parsed into individual `ILicense`
  entries (`getLicensesFromExpression`), de-duped by license id.
- `suppliers` — every package's supplier organization, de-duped.

Tab visibility is data-driven: the Licenses/Suppliers/Security Advisories tabs (and their badge
counts) only render when that derived array is non-empty; the Relationship View tab only renders
when the artifact actually has a `loadSvgDocumentAsync` (i.e. a matching `spdx.svg` attachment was
found).

## Styling

Each component generally pairs with a co-located `.scss` file (e.g. `bar.scss`, `pie.scss`,
`tile.scss`, `vulnerabilitiesSummaryBadge.scss`, `expandableList.scss`, top-level
`sbom-report-tab.scss`), compiled via `sass-loader`/`css-loader`/`style-loader` in
`ui/webpack.config.js`. There's no shared design-token file beyond what `azure-devops-ui`'s own
Bolt CSS classes (`bolt-*`, `flex-*`, `margin-*`) already provide — new components should reuse
those utility classes where possible rather than inventing new spacing conventions.

## Extending this tab

See [Extending the Extension § Add a new UI table/card](Extending-the-Extension.md#add-a-new-ui-tablecard-to-the-report-tab)
for a concrete walkthrough.

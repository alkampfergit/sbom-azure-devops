# Extending the Extension

Practical walkthroughs for the kinds of changes you're likely to make. Read
[Architecture](Architecture.md) first if you haven't — these all assume that mental model.

## Add a new task input

1. Declare it in `task/task.json`'s `inputs` array — pick a `groupName` (`package` or `advanced`,
   or add a new group), set `type`/`label`/`defaultValue`/`required`/`helpMarkDown`, and a
   `visibleRule` if it should only show under certain conditions (e.g. `command=generate`, or
   `visibleRule: 'someOtherInput=true'`).
2. Read it in `task/index.ts` with `getInput('yourInputName', required)` /
   `getBoolInput(...)` / `getInput(...)` as appropriate, and thread it into
   `SbomToolGenerateArgs` (`task/utils/sbomTool.ts`) if it affects SBOM generation, or handle it
   inline in `index.ts` if it's orchestration-only.
3. **Double-check the input name matches exactly between `task.json` and every `getInput(...)`
   call** — a mismatch fails silently (the value is always `undefined`, no error). See
   [Troubleshooting § Task reference mismatches](Troubleshooting.md#task-reference-mismatches) for
   a real example already in this codebase.
4. If it maps to an `sbom-tool` CLI flag, push it onto `sbomToolArguments` in
   `SbomTool.generateAsync` (`task/utils/sbomTool.ts`) — check the
   [sbom-tool CLI arguments doc](https://github.com/microsoft/sbom-tool/blob/main/docs/sbom-tool-arguments.md)
   for the right flag.
5. Add a line to the README's YAML example if it's a commonly-used input, and to
   [Task Reference](Task-Reference.md)'s tables here.
6. Rebuild (`npm run build:task`) and either run a real pipeline against a private build (see
   [Manual Private Install](Manual-Private-Install.md)) or sanity-check with
   `npm run start:task` + hand-set `INPUT_*` env vars.

## Add a new SPDX post-processing step (task side)

Follow the existing pattern in `task/utils/spdx/` (e.g. `addSpdxPackageSecurityAdvisories.ts`):
write an `async function yourStepAsync(spdxFilePath: string, ...): Promise<void>` that reads the
JSON, mutates it, and writes it back — then call it from `SbomTool.generateAsync` in
`task/utils/sbomTool.ts`, gated behind a new boolean task input if it's optional/expensive. If your
step needs a strongly-typed view of the document rather than loose `JSON.parse` + `as any`, prefer
importing the `IDocument`/`IPackage`/etc. types from `shared/spdx/models/2.3/` (relative import,
same pattern used throughout `task/`).

If the step adds information the UI should render, also add a small parser/accessor to
`shared/spdx/` (so both `task/` and `ui/` can use the exact same logic) rather than duplicating
parsing logic on the UI side — see how `externalRef.ts`'s `parseExternalRefsAs<T>()` is shared this
way between the task's writer and the UI's reader.

## Add a new UI table/card to the report tab

1. Create `ui/components/sbom/yourCard.tsx` (+ a co-located `.scss` if it needs custom styling),
   modeled on an existing one like `spdxLicenseTableCard.tsx` or `spdxSupplierTableCard.tsx`
   (simplest examples) or `spdxSecurityTableCard.tsx` (more involved: badges, filtering).
2. Compute whatever derived data your card needs inside
   `SbomDocumentPage.getDerivedStateFromProps` (`ui/components/sbom/documentPage.tsx`) if it's
   derived from the raw SPDX document (follow the existing `files`/`packages`/`licenses`/etc.
   pattern), and add it to `State`.
3. Add a new `<Tab id="yourTab" .../>` to the `TabBar` in `documentPage.tsx`'s `render()` —
   conditionally rendered (`this.state.yourData.length ? <Tab .../> : null`) if it should hide when
   empty, following the existing tabs.
4. Add the corresponding `case 'yourTab': return <YourCard .../>` to the `Observer` switch in the
   same file.
5. Reuse the shared `Filter`/`InlineKeywordFilterBarItem` instance (`this.filter`, already wired
   into the `TabBar`'s `renderAdditionalContent`) if your card is a filterable table, so the
   keyword filter bar works consistently across tabs.
6. Rebuild (`npm run build:ui`) and iterate with the `sbom-tool-local` + `start:ui` loop (see
   [Manual Private Install § Faster inner loop](Manual-Private-Install.md#faster-inner-loop-sbom-tool-local-variant-ui-only-iteration))
   rather than repackaging on every change.

## Add a whole new build-results tab / contribution

Add a new entry to `vss-extension.json`'s `contributions` array (see the existing
`sbom-tool-build-results-tab` entry for the shape), point its `uri` at a new HTML file, and add a
matching webpack `entry` in `ui/webpack.config.js` (webpack already supports multiple entries; the
existing config only declares one). Give the new HTML file its own `CopyWebpackPlugin` pattern if
it doesn't share `ui/sbom-report-tab.html`'s template.

## Extend GHSA ecosystem coverage

If `sbom-tool`/Component Detector starts reporting a package-manager ecosystem that isn't
recognized yet, extend the `switch` in `getGhsaEcosystemFromPackageUrl`
(`task/utils/spdx/addSpdxPackageSecurityAdvisories.ts`) — map the PURL type to
[GitHub's `SecurityAdvisoryEcosystem` enum](https://docs.github.com/en/graphql/reference/enums#securityadvisoryecosystem)
values. Unrecognized types are silently skipped today (no advisory lookup, no error) — that's
probably still the right default when adding new mappings, but be aware it means a typo in a new
mapping fails silently too.

## General checklist before opening a PR

- `npm run format` (or let the pre-commit hook catch it).
- `npm test` — and add a test under `shared/` if you touched SPDX model/merge/conversion logic
  (that's where the existing, thin test coverage lives).
- `npm run build` — confirm both `task` and `ui` still compile.
- If you changed `task/task.json`'s inputs, sanity-check the YAML in `README.md` and
  [Task Reference](Task-Reference.md) still matches.
- Don't commit a version bump from a local `npm run package` run unless that's actually intended
  (see [Building and Packaging § Versioning](Building-and-Packaging.md#versioning--three-numbers-that-can-drift-independently)) —
  check `git status`/`git diff` on `task/task.json` and `vss-extension.json` before committing.

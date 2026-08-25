# SBOM Tool Azure DevOps Extension — Wiki

Developer/contributor wiki for this repository. This is the **source of truth**; it is authored
under `docs/wiki/` in the main repo (reviewed via PR like any other code) and mirrored to the
[GitHub Wiki](../../wiki) for browsing. If you're only looking for _end-user_ install/usage
instructions (the marketplace listing content), see [`README.md`](../../README.md) instead — this
wiki is for people building, packaging, installing privately, or extending the extension.

> Editing note: to change the published GitHub Wiki, edit the pages here under `docs/wiki/` and
> open a PR — don't edit pages directly on the wiki, they'll be overwritten on the next mirror sync.
> See [Contributing and CI](Contributing-and-CI.md#syncing-docswiki-to-the-github-wiki) for the sync
> procedure.

## Pages

- **[Architecture](Architecture.md)** — repo layout, the 3 sub-projects (`shared`/`task`/`ui`), how
  data flows from `sbom-tool` CLI output to the build-results tab.
- **[Local Development](Local-Development.md)** — prerequisites, bootstrapping, build/test/format
  commands, the UI hot-reload dev loop, running the task binary standalone.
- **[Building and Packaging](Building-and-Packaging.md)** — the 3 manifest variants
  (local/dev/prod), how versioning works (`GitVersion`, `task.json`, token placeholders), producing
  a `.vsix` with `tfx-cli`.
- **[Manual Private Install](Manual-Private-Install.md)** — step-by-step: build locally and get the
  extension running in _your own_ Azure DevOps org without a public Marketplace listing.
- **[Task Reference](Task-Reference.md)** — every `sbom-tool` pipeline task input, defaults,
  visibility rules, and YAML examples.
- **[SPDX and Data Model](SPDX-and-Data-Model.md)** — SPDX 2.2/2.3 models, multi-manifest merging,
  GitHub Advisory (GHSA) enrichment, XLSX/SVG generation.
- **[UI Report Tab](UI-Report-Tab.md)** — how the "SBOM" build-results tab discovers, loads, and
  renders manifests.
- **[Extending the Extension](Extending-the-Extension.md)** — practical how-tos for adding task
  inputs, SPDX processing steps, and UI views.
- **[Troubleshooting](Troubleshooting.md)** — common failure modes and fixes.
- **[Contributing and CI](Contributing-and-CI.md)** — GitHub Actions workflows, Dependabot, release
  process, wiki-sync procedure.

## 30-second orientation

This extension wraps [`microsoft/sbom-tool`](https://github.com/microsoft/sbom-tool) as an Azure
Pipelines task. The task runs `sbom-tool generate` on your build agent, optionally enriches the
resulting SPDX manifest with license data, GitHub security advisories, an XLSX workbook, and an SVG
relationship graph, then attaches everything to the build timeline. A companion React "SBOM"
build-results tab reads those attachments back out over the Build REST API and renders them.

```
repo root
├─ shared/   TypeScript source shared by task+ui (not a package; imported by relative path)
├─ task/     the pipeline task (Node20_1, bundled with webpack --target node)
├─ ui/       the build-results tab (React, bundled with webpack --target web)
└─ vss-extension*.json  extension manifest + dev/prod overrides
```

See [Architecture](Architecture.md) for the full picture.

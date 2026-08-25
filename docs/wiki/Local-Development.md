# Local Development

## Prerequisites

- Node.js **20.1.x** (matches CI — see `.github/workflows/build.yml`; the task's runtime handler
  is also `Node20_1`, so staying close to this version avoids surprises).
- Nothing else is required to build — `sbom-tool` itself is downloaded by the task at *pipeline
  run* time, not at build time, so you don't need it installed to develop/build/test this repo.

## Bootstrap

```bash
git clone https://github.com/<you>/sbom-azure-devops.git
cd sbom-azure-devops
npm install
```

`npm install` at the root triggers `scripts.postinstall`, which runs `npm install` inside `shared/`,
`task/`, and `ui/` as well — one command bootstraps all four `node_modules` trees. If you only
change one sub-project's `package.json`, you can re-run `npm --prefix <shared|task|ui> install`
directly instead of a full root install.

## Build

```bash
npm run build          # = build:task && build:ui
npm run build:task      # cd task && webpack --mode development  -> task/dist/task/
npm run build:ui        # cd ui   && webpack --mode development  -> ui/dist/ui/
```

Both webpack configs always minify with `TerserPlugin` (even in `development` mode — see
`task/webpack.config.js` / `ui/webpack.config.js`), and strip comments from the output. `--mode
development` mainly affects webpack's own logging/optimizations, not minification here.

Outputs:
- `task/dist/task/index.js` + copied `task/task.json`, `images/icon.png`, and the
  `@vizdom/vizdom-ts-node` `*.wasm` file (via `CopyWebpackPlugin`).
- `ui/dist/ui/sbom-report-tab.js` + `sbom-report-tab.html`.

These `dist/` folders are what `vss-extension.json`'s `files` entries package into the `.vsix` — see
[Building and Packaging](Building-and-Packaging.md).

## Test

```bash
npm test        # npx jest — matches **/*.test.ts anywhere in the repo, transformed with ts-jest
```

Coverage today is thin: only `shared/spdx/convertSpdxToXlsx.test.ts` and
`shared/spdx/models/2.3/document.test.ts`. `jest.config.js` sits at the repo root and covers all
three sub-projects (no per-project jest config).

## Format & lint

```bash
npm run format         # prettier --write '**/*.{js,ts,tsx,scss,json,yaml,yml,md,html}'
npm run format:check   # prettier --check ...   <- this is what CI runs (.github/workflows/prettier.yml)
```

Prettier config: `.prettierrc.yml` (single quotes, 120 print width, `prettier-plugin-organize-imports`
auto-sorts/cleans imports on format).

There's also a spelling check (`.codespellrc`, run by `.github/workflows/codespell.yml` and locally
via the pre-commit hook below) — it skips `node_modules`, `package-lock.json`, and `*.js`.

## Pre-commit hook

Husky's `.husky/pre-commit` runs:

```
pretty-quick --staged
codespell
```

Expect a commit to be rejected if staged files aren't Prettier-formatted or contain a flagged
misspelling — run `npm run format` and/or fix the typo, then re-stage.

## Running the task standalone

```bash
npm run start:task   # node task/dist/task/index.js   (after npm run build:task)
```

This runs the compiled task entry point directly under plain Node, **outside** an actual Azure
Pipelines agent. `azure-pipelines-task-lib`'s `getInput`/`getVariable`/etc. read from
`INPUT_*`/pipeline environment variables, so without an agent context most inputs resolve to
empty/undefined — useful mainly for quick sanity checks (e.g. does it crash on load) or for
setting the right `INPUT_*`/`BUILD_*`/`AGENT_*` env vars yourself to simulate a real run. For a
faithful end-to-end test, it's usually faster to package the extension and run it in a real
pipeline (see [Manual Private Install](Manual-Private-Install.md)).

## Running the UI standalone (hot-reload dev loop)

```bash
npm run start:ui   # cd ui && webpack serve --mode development
```

Starts `webpack-dev-server` on `https://localhost:3000` (self-signed cert — Azure DevOps requires
HTTPS for extension iframes) and opens `/ui/sbom-report-tab.html`. On its own, outside of an actual
Azure DevOps build page, `SDK.init()`/`SDK.ready()` will fail (there's no ADO host frame to talk
to) — so this is primarily useful in combination with the `sbom-tool-local` manifest variant's
`baseUri: https://localhost:3000/`, which makes a *real, installed* extension load its UI from this
dev server instead of from packaged files. See
[Manual Private Install § Faster inner loop](Manual-Private-Install.md#faster-inner-loop-sbom-tool-local-variant-ui-only-iteration)
for the full loop.

Alternatively, for pure component work you don't need SDK/ADO context for, you can temporarily
mount an individual component (e.g. one of the `ui/components/sbom/*.tsx` cards) with fixture data
from `tests/spdx/manifest.spdx.json` in a scratch entry point — there's no existing harness for
this in the repo, so you'd wire it up ad hoc.

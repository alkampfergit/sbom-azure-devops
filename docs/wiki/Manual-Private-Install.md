# Manual Private Install (build locally, run in your own org, skip the public Marketplace listing)

This walks through building the extension yourself and getting it running in an Azure DevOps org
without ever making it a public Marketplace listing — the same approach the maintainer uses (as
the `dev` manifest variant) to test a build before promoting it to the public `prod` listing.

## The one thing to know going in

**For Azure DevOps _Services_ (`dev.azure.com`, the cloud product), there's no way to sideload a
`.vsix` straight into an org.** Every install — even a fully private, unlisted one — goes through
the Visual Studio Marketplace _publisher_ pipeline. "Private" just means you leave `public: false`
in the manifest and _share_ the extension with your org instead of listing it publicly; the
extension is never visible to anyone else, but the upload step itself is still a Marketplace
action. (Azure DevOps _Server_, the on-prem product, is different — see
[On-prem alternative](#on-prem-alternative-azure-devops-server) below.)

## Prerequisite: a Marketplace publisher you control

`vss-extension.json`'s `publisher` field is `rhyskoedijk`. Unless you're added as a member of that
publisher account, you can't upload under it. Either:

- ask the current publisher to add you as a member, **or**
- register your own publisher for free at https://marketplace.visualstudio.com/manage (needs a
  Microsoft/Azure DevOps account, accepting the
  [Marketplace Publisher Agreement](https://aka.ms/vsmarketplace-agreement)), then change
  `"publisher"` in `vss-extension.json` (and, to avoid colliding with the upstream listing,
  probably `"id"` too) to your own publisher id before packaging.

## Recommended: fully self-contained private build (the `dev` variant)

Use this when you want a real, portable `.vsix` that works without your dev machine running
anything — good for "install it in the org and just use it" testing, including by teammates.

1. Edit `vss-extension.overrides.dev.json` and replace the CI-only version placeholder with a real
   value (see [Building and Packaging § Versioning](Building-and-Packaging.md#versioning--three-numbers-that-can-drift-independently)
   for why this is necessary locally):
   ```json
   { "id": "sbom-tool-dev", "name": "SBOM Tool [DEV]", "version": "0.1.0", "public": false, "baseUri": null }
   ```
2. Bootstrap and build:
   ```bash
   npm install
   npm run build
   ```
3. Package it:
   ```bash
   npm run package:dev
   # -> dist/dev/<publisher>.sbom-tool-dev-0.1.0.vsix
   ```
4. Get it into the Marketplace **privately**, either in one shot from the CLI, or via the web UI.

   **CLI, one shot** (packages + uploads + shares in a single command). You'll need a personal
   access token with **Marketplace (publish)** scope (create one under
   `https://dev.azure.com/{your-org}/_usersSettings/tokens`, or use a Microsoft Entra token —
   preferred by Microsoft's current guidance over PATs where available):

   ```bash
   npx tfx-cli extension publish \
     --manifests vss-extension.json --overrides-file vss-extension.overrides.dev.json \
     --auth-type pat --token <PAT> \
     --share-with <your-org-name>
   ```

   This is literally the same shape of command the repo's own CI uses for its `dev` channel (see
   `.github/workflows/tfx-extension.yml`'s "Publish to marketplace (dev)" step) — just run from
   your machine instead of GitHub Actions, and sharing with your own org instead of the
   maintainer's.

   **Web UI** (if you'd rather not create a PAT, or want to eyeball the listing before it goes
   anywhere):
   1. Go to https://marketplace.visualstudio.com/manage → select your publisher.
   2. **New extension → Azure DevOps** → upload the `.vsix` from step 3. It appears in your
      publisher's list — at this point it's visible to **only you**, not shared with anyone.
   3. Right-click it → **Share/Unshare** → enter your organization's name (the `{organization}` in
      `https://dev.azure.com/{organization}`) → Enter.

5. Install it into the org:
   - Sign in to `https://dev.azure.com/{your-org}` → **Organization Settings → Extensions →
     Browse Marketplace**, find it (it'll show as shared-with-you rather than in public search) →
     **Get it free** → **Install**.
6. Verify: add the `sbom-tool` task to a pipeline, run it, then open the build's **SBOM** results
   tab.

### Updating later

Rebuild, bump the version (hand-edit it again, or pass `--rev-version` to `tfx-cli
extension create`/`publish` to auto-increment the patch and write it back to the manifest), then
re-run the same `publish` command or re-upload via **Update** on the existing extension in the
management portal (not delete-and-recreate). Azure DevOps auto-upgrades every org that already has
it installed.

## Faster inner loop: `sbom-tool-local` variant (UI-only iteration)

Use this while actively iterating on the **report tab UI** and you don't need a portable artifact —
skips the version-placeholder edit entirely since the base manifest already has a real version.

1. `npm run start:ui` — leave it running. Serves the UI on `https://localhost:3000` with a
   self-signed cert.
2. In another terminal:
   ```bash
   npm install
   npm run build
   npm run package
   # -> dist/sbom-tool-local-0.0.<patch>.vsix
   ```
3. Upload/share/install exactly as in steps 4–5 above (publisher, `--share-with`/Share, install
   from Organization Settings).
4. Because this manifest's `baseUri` is `https://localhost:3000/`, the installed extension's report
   tab iframe loads live from your dev machine. Edit files under `ui/`, refresh the ADO browser tab
   — no repackage, re-upload, or reinstall needed.

Caveats:

- Only works in a browser running on (or able to reach) the machine that has `start:ui` running,
  and only after you accept the self-signed localhost cert in that browser (visit
  `https://localhost:3000/` directly once and click through the warning).
- The **task** (`task/dist`) is always fully packaged regardless of `baseUri` — only the UI's
  `ui/dist` files are redirected. If you're iterating on `task/` code, you still need to rebuild +
  repackage + reinstall (or just re-run `npm run start:task`/a real pipeline for quicker feedback —
  see [Local Development](Local-Development.md)).
- Not suitable for anyone but you to test with, since it depends on your machine.

## On-prem alternative (Azure DevOps Server)

If your target is Azure DevOps **Server** (self-hosted/on-prem) rather than the cloud service, this
is genuinely different: a member of the **Team Foundation Administrators** group with **Edit
instance-level information** permission can upload a `.vsix` directly to the server through its own
admin page — no Marketplace publisher, no sharing step, no public/private distinction at all. This
is the closest thing to a true "sideload" and doesn't apply to `dev.azure.com` orgs.

## Troubleshooting this flow

See [Troubleshooting](Troubleshooting.md#packaging--install) for: invalid-version errors from
`tfx-cli`, publisher/permission errors on upload, the extension installing but the SBOM tab not
appearing, and localhost-cert issues with the `sbom-tool-local` variant.

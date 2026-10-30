// Standalone entry point for local UI render-performance testing (see measureRenderPerf.js and
// ../../.claude/skills/sbom-render-perf/SKILL.md). Mounts the real SbomDocumentPage component --
// the same one sbom-report-tab.tsx renders -- with a locally-fetched SPDX file, bypassing the
// Azure DevOps extension SDK entirely (SDK.init()/SDK.ready() only resolve inside a real ADO host
// iframe, so sbom-report-tab.tsx itself can't be driven standalone). NOT part of the production
// extension bundle -- built only by webpack.perf.config.js, never by webpack.config.js.
import * as React from 'react';
import * as ReactDOM from 'react-dom';

import '../../shared/extensions/array';
import '../../shared/extensions/number';
import '../../shared/extensions/string';

import { ISbomBuildArtifact } from '../../shared/models/sbomBuildArtifact';
import { IDocument } from '../../shared/spdx/models/2.3/document';
import { SbomDocumentPage } from '../components/sbom/documentPage';

// Same global stylesheet the real sbom-report-tab.tsx loads (azure-devops-ui base theme/reset +
// the app's own flex/layout utility classes) -- without it the page renders completely unstyled.
import '../sbom-report-tab.scss';

declare global {
  interface Window {
    __perfHarness?: { status: string; timings: Record<string, number>; error?: string };
  }
}

function renderArtifact(artifact: ISbomBuildArtifact, onRendered?: () => void) {
  ReactDOM.render(
    <SbomDocumentPage artifact={artifact} onLoadArtifacts={() => {}} />,
    document.getElementById('root')!,
    onRendered,
  );
}

async function main() {
  const root = document.getElementById('root')!;
  window.__perfHarness = { status: 'fetching', timings: {} };

  try {
    // `?partial=1` starts from the vulnerable-only copy of the manifest, like sbom-report-tab.tsx does when a build has
    // one, and loads the full manifest on demand by re-rendering with it
    const partialMode = new URLSearchParams(window.location.search).get('partial') === '1';
    const fetchStart = performance.now();
    const response = await fetch(partialMode ? 'large-manifest.vulnerable.spdx.json' : 'large-manifest.spdx.json');
    if (!response.ok) {
      throw new Error(`Failed to fetch fixture: ${response.status} ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    window.__perfHarness.timings.fetchMs = performance.now() - fetchStart;

    const parseStart = performance.now();
    const spdxDocument = JSON.parse(new TextDecoder().decode(buffer)) as IDocument;
    window.__perfHarness.timings.parseMs = performance.now() - parseStart;
    window.__perfHarness.status = 'parsed';

    const loadFullArtifactAsync = async (): Promise<ISbomBuildArtifact> => {
      const fullResponse = await fetch('large-manifest.spdx.json');
      if (!fullResponse.ok) {
        throw new Error(`Failed to fetch full fixture: ${fullResponse.status} ${fullResponse.statusText}`);
      }
      const fullBuffer = await fullResponse.arrayBuffer();
      const fullDocument = JSON.parse(new TextDecoder().decode(fullBuffer)) as IDocument;
      const fullArtifact: ISbomBuildArtifact = {
        id: fullDocument.documentNamespace,
        spdxDocument: fullDocument,
        spdxJsonDocument: fullBuffer,
      };
      renderArtifact(fullArtifact);
      return fullArtifact;
    };

    const artifact: ISbomBuildArtifact = {
      id: spdxDocument.documentNamespace,
      spdxDocument,
      spdxJsonDocument: buffer,
      isPartial: partialMode || undefined,
      loadFullArtifactAsync: partialMode ? loadFullArtifactAsync : undefined,
    };

    const renderStart = performance.now();
    renderArtifact(artifact, () => {
      window.__perfHarness!.timings.initialRenderMs = performance.now() - renderStart;
      window.__perfHarness!.status = 'ready';
    });
  } catch (error) {
    window.__perfHarness.status = 'error';
    window.__perfHarness.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

main();

import { EOL } from 'os';

// `getrandom` does not directly support ES Modules running on Node.js.
// However, we can get it to work by adding a shim to the Web Cryptography API:
// See: https://docs.rs/getrandom/latest/getrandom/#nodejs-es-module-support
import { webcrypto } from 'node:crypto';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

// Vizdom must be imported AFTER the getrandom shim above, else it will throw an error
import { DirectedGraph, EdgeStyle, Shape, VertexWeakRef } from '@vizdom/vizdom-ts-node';

import { SecurityAdvisorySeverity } from '../../../shared/ghsa/models/securityAdvisory';

import { NOASSERTION } from '../../../shared/spdx/models/2.3/constants';
import { IDocument } from '../../../shared/spdx/models/2.3/document';
import { ExternalRefCategory, ExternalRefSecurityType } from '../../../shared/spdx/models/2.3/externalRef';

const VERTEX_DOC_FILL_COLOR = '#E0E0E0';
const VERTEX_PKG_FILL_COLOR = '#E0E0E0';
const VERTEX_REF_FILL_COLOR = '#FAFAFA';
const VERTEX_CRITICAL_FILL_COLOR = '#E57373';
const VERTEX_HIGH_FILL_COLOR = '#FF8A65';
const VERTEX_MODERATE_FILL_COLOR = '#FFB74D';
const VERTEX_LOW_FILL_COLOR = '#64B5F6';

/**
 * Convert an SPDX document to SVG graph diagram
 * @param spdxJson The SPDX document
 * @return The SPDX as SVG buffer
 */
export async function convertSpdxToSvgAsync(spdx: IDocument): Promise<Buffer> {
  let checkpoint = Date.now();
  const elapsed = () => {
    const now = Date.now();
    const seconds = ((now - checkpoint) / 1000).toFixed(2);
    checkpoint = now;
    return `${seconds}s`;
  };

  // Create a new graph
  const graph = new DirectedGraph();
  const vertices = new Map<string, VertexWeakRef>();

  // Create a vertex for the document itself
  console.info(`Generating graph vertex for document root`);
  const spdxProperties = [
    `SPDX Version: ${spdx.spdxVersion || NOASSERTION}`,
    `Data License: ${spdx.dataLicense || NOASSERTION}`,
  ];
  vertices.set(
    spdx.SPDXID,
    graph.new_vertex({
      render: {
        shape: Shape.Circle,
        label: spdx.name,
        tooltip: ((spdx.creationInfo?.creators as string[]) || []).concat(spdxProperties).join(EOL),
        fill_color: VERTEX_DOC_FILL_COLOR,
      },
    }),
  );

  // Create vertices for each package
  console.info(`Generating graph vertices and edges for ${spdx.packages?.length || 0} packages`);
  for (const pkg of spdx.packages) {
    const pkgProperties = [`${pkg.supplier}`, `License: ${pkg.licenseConcluded || pkg.licenseDeclared || NOASSERTION}`];
    const pkgVertex = graph.new_vertex({
      render: {
        label: `${pkg.name} v${pkg.versionInfo}`,
        tooltip: pkgProperties.join(EOL),
        fill_color: VERTEX_PKG_FILL_COLOR,
      },
    });

    vertices.set(pkg.SPDXID, pkgVertex);

    // Note: individual files are deliberately not graphed here. For large SBOMs, files vastly
    // outnumber packages/relationships and dominate both graph construction and layout time,
    // while producing a diagram too dense to be readable anyway. Full file-level detail is
    // still available in the XLSX/JSON exports; this graph focuses on package relationships.

    // Create vertices and edges for each external reference in the package
    if (pkg.externalRefs) {
      for (const externalRef of pkg.externalRefs) {
        let referenceVertex = vertices.get(externalRef.referenceLocator);
        if (referenceVertex === undefined) {
          let referenceId = externalRef.referenceLocator;
          let referenceProperties = undefined;
          let referenceUrl = undefined;
          let referenceShape = undefined;
          let referenceFillColour = VERTEX_REF_FILL_COLOR;
          switch (externalRef.referenceCategory) {
            case ExternalRefCategory.PackageManager:
              continue;
            case ExternalRefCategory.Security:
              const advisory = parseSecurityAdvisory(externalRef);
              if (!advisory) {
                continue;
              }
              referenceId = `${advisory.cveId || advisory.ghsaId || externalRef.referenceLocator} [${advisory.severity}]`;
              referenceProperties = [
                `CVE: ${advisory.cveId || NOASSERTION}`,
                `GHSA: ${advisory.ghsaId || NOASSERTION}`,
                `Severity: ${advisory.severity || NOASSERTION}`,
                `Summary: ${advisory.summary || NOASSERTION}`,
              ];
              referenceUrl = externalRef.referenceLocator;
              referenceShape = Shape.Diamond;
              switch (advisory.severity) {
                case SecurityAdvisorySeverity.Critical:
                  referenceFillColour = VERTEX_CRITICAL_FILL_COLOR;
                  break;
                case SecurityAdvisorySeverity.High:
                  referenceFillColour = VERTEX_HIGH_FILL_COLOR;
                  break;
                case SecurityAdvisorySeverity.Moderate:
                  referenceFillColour = VERTEX_MODERATE_FILL_COLOR;
                  break;
                case SecurityAdvisorySeverity.Low:
                  referenceFillColour = VERTEX_LOW_FILL_COLOR;
                  break;
              }
              break;
          }
          referenceVertex = graph.new_vertex({
            render: {
              label: referenceId,
              tooltip: referenceProperties?.join(EOL),
              url: referenceUrl,
              shape: referenceShape,
              fill_color: referenceFillColour,
            },
          });
          vertices.set(referenceId, referenceVertex);
        }
        if (referenceVertex) {
          graph.new_edge(pkgVertex, referenceVertex, {
            render: {
              label: normaliseEdgeLabel(`${externalRef.referenceCategory} ${externalRef.referenceType}`),
              style: EdgeStyle.Dashed,
            },
          });
        }
      }
    }
  }

  console.info(`Generated graph vertices and edges for ${spdx.packages?.length || 0} packages (${elapsed()})`);

  // Create edges for each relationship
  console.info(`Generating graph edges for ${spdx.relationships?.length || 0} relationships`);
  for (const relationship of spdx.relationships) {
    const sourceVertex = vertices.get(relationship.spdxElementId);
    const targetVertex = vertices.get(relationship.relatedSpdxElement);
    if (sourceVertex && targetVertex) {
      graph.new_edge(sourceVertex, targetVertex, {
        render: {
          label: normaliseEdgeLabel(relationship.relationshipType),
        },
      });
    }
  }
  console.info(`Generated graph edges (${elapsed()}); ${vertices.size} vertices total`);

  // Position the graph; for very large graphs (tens/hundreds of thousands of vertices) this
  // layout step is typically the dominant cost, since layout algorithms are superlinear in the
  // number of vertices/edges.
  console.info('Positioning graph layout');
  const positioned = graph.layout();
  console.info(`Positioned graph layout (${elapsed()})`);

  // Export the graph as SVG text
  console.info('Writing SVG image');
  const svg = Buffer.from(positioned.to_svg().to_string(), 'utf8');
  console.info(`Wrote SVG image (${elapsed()})`);
  return svg;
}

function parseSecurityAdvisory(externalRef: any): any {
  if (
    externalRef.referenceCategory !== ExternalRefCategory.Security ||
    externalRef.referenceType !== ExternalRefSecurityType.Advisory
  ) {
    return undefined;
  }
  return {
    ghsaId: externalRef.referenceLocator?.match(/GHSA-[0-9a-z-]+/i)?.[0],
    cveId: externalRef.comment?.match(/CVE-[0-9-]+/i)?.[0],
    severity: externalRef.comment?.match(/^\[(\w+)\]/)?.[1]?.toUpperCase(),
    summary: externalRef.comment?.match(/^\[(\w+)\](.*)$/)?.[2]?.trim(),
  };
}

function normaliseEdgeLabel(label: string): string {
  return label?.replace(/[_-]/g, ' ')?.toUpperCase()?.trim();
}

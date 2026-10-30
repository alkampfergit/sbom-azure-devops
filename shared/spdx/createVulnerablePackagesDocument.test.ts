import { expect } from '@jest/globals';

import { createVulnerablePackagesDocument } from './createVulnerablePackagesDocument';
import { DocumentVersion, getPackageAncestorDependencyPaths, IDocument } from './models/2.3/document';
import { IPackage } from './models/2.3/package';
import { RelationshipType } from './models/2.3/relationship';

// An advisory as the task writes it: a data URI holding the advisory JSON
function advisoryExternalRef(permalink: string) {
  const advisory = { package: { name: 'vulnerable' }, advisory: { severity: 'HIGH', permalink } };
  return {
    referenceCategory: 'SECURITY',
    referenceType: 'Url',
    referenceLocator: `data:text/json;base64,${Buffer.from(JSON.stringify(advisory)).toString('base64')}`,
  };
}

function buildPackage(id: string, externalRefs: any[] = []): IPackage {
  return { SPDXID: id, name: id, versionInfo: '1.0.0', externalRefs, hasFiles: [`SPDXRef-File-${id}`] } as any;
}

function buildDocument(vulnerablePackageId: string | undefined): IDocument {
  return {
    SPDXID: 'SPDXRef-DOCUMENT',
    spdxVersion: DocumentVersion.SPDX_2_3,
    name: 'test',
    dataLicense: 'CC0-1.0',
    documentNamespace: 'https://example.com/test',
    creationInfo: { created: '2024-01-01T00:00:00Z', creators: ['Tool: test'] },
    documentDescribes: ['SPDXRef-Root'],
    externalDocumentRefs: [],
    // Root -> A -> B, plus an unrelated branch Root -> C -> D
    relationships: [
      { spdxElementId: 'SPDXRef-Root', relatedSpdxElement: 'SPDXRef-A', relationshipType: RelationshipType.DependsOn },
      { spdxElementId: 'SPDXRef-A', relatedSpdxElement: 'SPDXRef-B', relationshipType: RelationshipType.DependsOn },
      { spdxElementId: 'SPDXRef-Root', relatedSpdxElement: 'SPDXRef-C', relationshipType: RelationshipType.DependsOn },
      { spdxElementId: 'SPDXRef-C', relatedSpdxElement: 'SPDXRef-D', relationshipType: RelationshipType.DependsOn },
      {
        spdxElementId: 'SPDXRef-Root',
        relatedSpdxElement: 'SPDXRef-File-Root',
        relationshipType: RelationshipType.Contains,
      },
    ],
    files: [{ SPDXID: 'SPDXRef-File-B', fileName: 'b.txt' } as any],
    packages: [
      buildPackage('SPDXRef-Root'),
      buildPackage('SPDXRef-A'),
      buildPackage('SPDXRef-B', vulnerablePackageId === 'SPDXRef-B' ? [advisoryExternalRef('https://b')] : []),
      buildPackage('SPDXRef-C'),
      buildPackage('SPDXRef-D', vulnerablePackageId === 'SPDXRef-D' ? [advisoryExternalRef('https://d')] : []),
    ],
  };
}

describe('createVulnerablePackagesDocument', () => {
  it('should return undefined when no package has security advisories', () => {
    expect(createVulnerablePackagesDocument(buildDocument(undefined))).toBeUndefined();
  });

  it('should keep the vulnerable package, its ancestors up to the root, and the root', () => {
    const slim = createVulnerablePackagesDocument(buildDocument('SPDXRef-B'))!;

    expect(slim.packages.map((p) => p.SPDXID)).toEqual(['SPDXRef-Root', 'SPDXRef-A', 'SPDXRef-B']);
    expect(slim.documentDescribes).toEqual(['SPDXRef-Root']);
    expect(slim.relationships.map((r) => `${r.spdxElementId}->${r.relatedSpdxElement}`)).toEqual([
      'SPDXRef-Root->SPDXRef-A',
      'SPDXRef-A->SPDXRef-B',
    ]);
  });

  it('should drop files and the package file references', () => {
    const slim = createVulnerablePackagesDocument(buildDocument('SPDXRef-B'))!;

    expect(slim.files).toEqual([]);
    expect(slim.packages.every((p) => p.hasFiles === undefined)).toBe(true);
  });

  it('should give the same ancestor dependency paths as the full document', () => {
    const full = buildDocument('SPDXRef-B');
    const slim = createVulnerablePackagesDocument(full)!;
    const toIds = (paths: { dependencyPath: IPackage[] }[]) =>
      paths.map((path) => path.dependencyPath.map((p) => p.SPDXID));

    expect(toIds(getPackageAncestorDependencyPaths(slim, 'SPDXRef-B'))).toEqual(
      toIds(getPackageAncestorDependencyPaths(full, 'SPDXRef-B')),
    );
  });

  it('should keep the other vulnerable package and its path when several packages are vulnerable', () => {
    const full = buildDocument('SPDXRef-D');
    full.packages = full.packages.map((p) =>
      p.SPDXID === 'SPDXRef-B' ? ({ ...p, externalRefs: [advisoryExternalRef('https://b')] } as IPackage) : p,
    );
    const slim = createVulnerablePackagesDocument(full)!;

    expect(slim.packages.map((p) => p.SPDXID)).toEqual([
      'SPDXRef-Root',
      'SPDXRef-A',
      'SPDXRef-B',
      'SPDXRef-C',
      'SPDXRef-D',
    ]);
  });
});

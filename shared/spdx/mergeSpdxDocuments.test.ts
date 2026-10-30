import { expect } from '@jest/globals';

import { DocumentVersion, IDocument } from './models/2.3/document';

import { mergeSpdxDocuments } from './mergeSpdxDocuments';

import '../extensions/array';

function buildDocument(namespace: string, packageName: string): IDocument {
  return {
    SPDXID: 'SPDXRef-DOCUMENT',
    spdxVersion: DocumentVersion.SPDX_2_3,
    name: packageName,
    dataLicense: 'CC0-1.0',
    documentNamespace: namespace,
    creationInfo: { created: '2024-01-01T00:00:00Z', creators: ['Tool: test'] },
    documentDescribes: ['SPDXRef-RootPackage'],
    externalDocumentRefs: [],
    relationships: [],
    files: [
      { SPDXID: 'SPDXRef-File-a.txt', fileName: 'a.txt' } as any,
      { SPDXID: 'SPDXRef-File-b.txt', fileName: 'b.txt' } as any,
    ],
    packages: [
      { SPDXID: 'SPDXRef-RootPackage', name: packageName, hasFiles: ['SPDXRef-File-a.txt'] } as any,
      {
        SPDXID: 'SPDXRef-Dep',
        name: `dep-${packageName}`,
        hasFiles: ['SPDXRef-File-b.txt', 'SPDXRef-File-a.txt'],
      } as any,
    ],
  };
}

describe('mergeSpdxDocuments', () => {
  it('should give every file a unique ID and point package references at the renamed files', () => {
    const merged = mergeSpdxDocuments('All', '1.0', [
      buildDocument('https://example.com/one', 'first'),
      buildDocument('https://example.com/two', 'second'),
    ]);

    const fileIds = merged.files.map((f) => f.SPDXID);
    expect(new Set(fileIds).size).toBe(fileIds.length);

    for (const pkg of merged.packages) {
      for (const fileId of pkg.hasFiles || []) {
        expect(fileIds).toContain(fileId);
      }
    }
  });
});

describe('distinctBy', () => {
  it('should keep the first item for each key, in order', () => {
    const items = [
      { id: 1, value: 'a' },
      { id: 2, value: 'b' },
      { id: 3, value: 'a' },
    ];
    expect(items.distinctBy((i: { id: number; value: string }) => i.value)).toEqual([
      { id: 1, value: 'a' },
      { id: 2, value: 'b' },
    ]);
  });
});

import md5 from 'md5';

import { getCreatorOrganization } from '../spdx/models/2.3/creationInfo';
import { DocumentVersion, IDocument } from '../spdx/models/2.3/document';
import { IPackage } from '../spdx/models/2.3/package';

const SpdxRefPrefix = 'SPDXRef';
const SpdxDocumentId = `${SpdxRefPrefix}-DOCUMENT`;
const SpdxRootPackageId = `${SpdxRefPrefix}-RootPackage`;

/**
 * Merge multiple SPDX documents to a single SPDX document
 * @param packageName The name of the merged ackage
 * @param packageVersion The version of the merged package
 * @param sourceDocuments The source SPDX documents to be merged
 * @return The merged SPDX document
 */
export function mergeSpdxDocuments(
  packageName: string | undefined,
  packageVersion: string | undefined,
  sourceDocuments: IDocument[],
): IDocument {
  const packageGuid = crypto.randomUUID();
  const rootDocument = sourceDocuments[0];
  const rootNamespaceUri = new URL(rootDocument.documentNamespace);
  const rootOrganisation = getCreatorOrganization(rootDocument.creationInfo);

  // Because each document likely has a "root package" with the same id, we first need to rename them to avoid conflicts
  sourceDocuments.forEach((doc) => {
    renamePackageId(
      doc,
      SpdxRootPackageId,
      (p) => `${SpdxRefPrefix}-Package-${p.name.replace(/[^a-zA-Z0-9]+/g, '')}-${crypto.randomUUID()}`,
    );
  });

  // Files with the same path will share the same SPDX ID, so we need to rename them to avoid conflicts
  sourceDocuments.forEach((doc) => renameFileIds(doc));

  // Merge the documents
  return {
    SPDXID: SpdxDocumentId,
    spdxVersion: DocumentVersion.SPDX_2_3,
    name: `${packageName} ${packageVersion}`.trim(),
    dataLicense: rootDocument.dataLicense || 'CC0-1.0',
    documentNamespace: `${rootNamespaceUri.protocol}//${rootNamespaceUri.host}/${packageName}/${packageVersion}/${packageGuid}`,
    creationInfo: {
      created: new Date().toISOString(),
      creators: [`Organization: ${rootOrganisation}`, `Tool: rhyskoedijk/sbom-azure-devops`],
    },
    files: sourceDocuments.flatMap((d) => d.files),
    packages: sourceDocuments.flatMap((d) => d.packages).distinctBy((p) => p.SPDXID),
    externalDocumentRefs: sourceDocuments.flatMap((d) => d.externalDocumentRefs),
    relationships: sourceDocuments.flatMap((d) => d.relationships),
    documentDescribes: sourceDocuments.flatMap((d) => d.documentDescribes),
  };
}

/**
 * Rename the package ID in the SPDX document
 * @param document The SPDX document
 * @param packageId The package ID to be renamed
 * @param packageIdBuilder The function to build the new package ID
 * @returns The SPDX document with the renamed package ID
 */
function renamePackageId(document: IDocument, packageId: string, packageIdBuilder: (p: IPackage) => string): IDocument {
  // Find the package
  const pkg = document.packages.find((p) => p.SPDXID === packageId);
  if (pkg) {
    // Rename the package
    const oldId = pkg.SPDXID;
    const newId = packageIdBuilder(pkg);
    pkg.SPDXID = newId;

    // Update all references to the package
    document.documentDescribes = document.documentDescribes.map((id) => (id == oldId ? newId : id));
    document.relationships.forEach((r) => {
      if (r.spdxElementId == oldId) {
        r.spdxElementId = newId;
      }
      if (r.relatedSpdxElement == oldId) {
        r.relatedSpdxElement = newId;
      }
    });
  }

  return document;
}

/**
 * Rename the file IDs in the SPDX document, so they don't clash with files from other documents.
 * Works in linear passes over the document using lookup tables. Searching the files and packages
 * again for every file was quadratic, which made merging large manifests take many seconds.
 * @param document The SPDX document
 * @returns The SPDX document with renamed file IDs
 */
function renameFileIds(document: IDocument): IDocument {
  const namespaceHash = md5(document.documentNamespace).substring(0, 10);

  // The first package that lists each file names it
  const packageNameByFileId = new Map<string, string | undefined>();
  for (const pkg of document.packages) {
    for (const fileId of pkg.hasFiles || []) {
      if (!packageNameByFileId.has(fileId)) {
        packageNameByFileId.set(fileId, pkg.name);
      }
    }
  }

  // Rename the files
  const newFileIdByOldId = new Map<string, string>();
  for (const file of document.files) {
    const oldId = file.SPDXID;
    const packageName = packageNameByFileId.get(oldId);
    const oldPrefix = `${SpdxRefPrefix}-File-`;
    const newPrefix = `${SpdxRefPrefix}-File-${packageName?.replace(/[^a-zA-Z0-9]+/g, '') || namespaceHash}`;
    const newId = oldId.startsWith(newPrefix) ? oldId : oldId.replace(oldPrefix, newPrefix);
    file.SPDXID = newId;
    newFileIdByOldId.set(oldId, newId);
  }

  // Update all references to the renamed files
  for (const pkg of document.packages) {
    if (pkg.hasFiles?.some((id) => newFileIdByOldId.has(id))) {
      pkg.hasFiles = pkg.hasFiles.map((id) => newFileIdByOldId.get(id) ?? id);
    }
  }

  return document;
}

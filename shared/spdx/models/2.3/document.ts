import { spdxConstantsAreEqual } from './constants';
import { ICreationInfo } from './creationInfo';
import { IFile } from './file';
import { IPackage } from './package';
import { IRelationship, RelationshipType } from './relationship';

import '../../../extensions/array';

/**
 * https://spdx.github.io/spdx-spec/v2.3/document-creation-information/
 */
export interface IDocument {
  files: IFile[];
  packages: IPackage[];
  externalDocumentRefs: any[];
  relationships: IRelationship[];
  spdxVersion: DocumentVersion | string;
  dataLicense: DocumentDataLicense | string;
  SPDXID: string;
  name: string;
  documentNamespace: string;
  creationInfo: ICreationInfo;
  documentDescribes: string[];
}

export enum DocumentVersion {
  SPDX_2_2 = 'SPDX-2.2',
  SPDX_2_3 = 'SPDX-2.3',
}

export enum DocumentDataLicense {
  CC0_1_0 = 'CC0-1.0',
}

export interface IPackageDependencyPath {
  dependencyPath: IPackage[];
}

export function getDisplayNameForDocument(document: IDocument): string | undefined {
  const describesPackageIds = document.documentDescribes;
  const packages = document.packages?.filter((p) => describesPackageIds.includes(p.SPDXID))?.map((p) => p.name);
  if (packages?.length > 1) {
    return `${packages[0]} + ${packages.length - 1} package(s)`;
  } else if (packages?.length == 1) {
    return packages[0] || '';
  }
}

/**
 * Lookup tables derived from a document, built once per document instead of once per call. Callers
 * such as the package table ask about every package, so rebuilding these tables per call made the
 * whole pass O(packages x relationships).
 */
interface IDocumentIndex {
  // Source arrays and their lengths at build time, used to detect that the document was edited
  packages: IPackage[];
  relationships: IRelationship[];
  documentDescribes: string[];
  counts: [number, number, number];
  rootPackageIds: Set<string>;
  // Packages that the ancestor walk can reach (the document's root package is excluded when it is the only root)
  packagesById: Map<string, IPackage>;
  // "DependsOn" relationships keyed by their dependency (relatedSpdxElement) side, de-duplicated
  dependsOnRelationshipsByRelatedElement: Map<string, IRelationship[]>;
  // Packages that a root package directly depends on
  topLevelPackageIds: Set<string>;
}

const documentIndexCache = new WeakMap<IDocument, IDocumentIndex>();

// Documents can be edited in place (mergeSpdxDocuments renames IDs on its inputs), so the index is
// only reused while the source arrays are the same objects with the same lengths. Anything that
// changes a document's packages, relationships or documentDescribes must replace the array or change
// its length, or the index will be stale.
function getDocumentIndex(document: IDocument): IDocumentIndex {
  const packages = document.packages || [];
  const relationships = document.relationships || [];
  const documentDescribes = document.documentDescribes || [];
  const cached = documentIndexCache.get(document);
  if (
    cached &&
    cached.packages === packages &&
    cached.relationships === relationships &&
    cached.documentDescribes === documentDescribes &&
    cached.counts[0] === packages.length &&
    cached.counts[1] === relationships.length &&
    cached.counts[2] === documentDescribes.length
  ) {
    return cached;
  }

  const hasMultipleRootPackages = documentDescribes.length > 1;
  const rootPackageIds = new Set(documentDescribes);
  const packagesById = new Map(
    packages
      .filter((p) => hasMultipleRootPackages || !rootPackageIds.has(p.SPDXID))
      .map((p) => [p.SPDXID, p] as [string, IPackage]),
  );

  const dependsOnRelationshipsByRelatedElement = new Map<string, IRelationship[]>();
  const topLevelPackageIds = new Set<string>();
  for (const r of relationships) {
    if (!spdxConstantsAreEqual(r.relationshipType, RelationshipType.DependsOn)) {
      continue;
    }
    if (rootPackageIds.has(r.spdxElementId)) {
      topLevelPackageIds.add(r.relatedSpdxElement);
    }
    const existing = dependsOnRelationshipsByRelatedElement.get(r.relatedSpdxElement);
    if (existing) {
      existing.push(r);
    } else {
      dependsOnRelationshipsByRelatedElement.set(r.relatedSpdxElement, [r]);
    }
  }
  // Same de-duplication the ancestor walk applies to each lookup, done once up front
  for (const [key, list] of dependsOnRelationshipsByRelatedElement) {
    dependsOnRelationshipsByRelatedElement.set(
      key,
      list.distinctBy((r: IRelationship) => r.spdxElementId + r.relatedSpdxElement),
    );
  }

  const index: IDocumentIndex = {
    packages,
    relationships,
    documentDescribes,
    counts: [packages.length, relationships.length, documentDescribes.length],
    rootPackageIds,
    packagesById,
    dependsOnRelationshipsByRelatedElement,
    topLevelPackageIds,
  };
  documentIndexCache.set(document, index);
  return index;
}

export function getPackageAncestorDependencyPaths(document: IDocument, packageId: string): IPackageDependencyPath[] {
  const index = getDocumentIndex(document);
  const { packagesById, dependsOnRelationshipsByRelatedElement } = index;

  const currentPackage = packagesById.get(packageId);
  if (!currentPackage) {
    return [];
  }

  // Walk the dependency tree via all "DependsOn" relationships with the package to discover all possible package dependency paths
  const ancestorDependencyReleationships = dependsOnRelationshipsByRelatedElement.get(packageId) || [];
  const ancestorDependencyPaths = ancestorDependencyReleationships.flatMap((relationship) =>
    getPackageAncestorPathsRecursive(
      dependsOnRelationshipsByRelatedElement,
      packagesById,
      relationship.spdxElementId,
      [currentPackage],
      1,
    ),
  );

  // Ensure there is only one ancestor dependency path per top-level package (prefer the longest path if multiple)
  const shortestUniqueAncestorDependencyPaths: Record<string, IPackageDependencyPath> = {};
  for (const path of ancestorDependencyPaths) {
    const topLevelPackage = path.dependencyPath[0];
    if (
      !shortestUniqueAncestorDependencyPaths[topLevelPackage.SPDXID] ||
      shortestUniqueAncestorDependencyPaths[topLevelPackage.SPDXID].dependencyPath.length < path.dependencyPath.length
    ) {
      shortestUniqueAncestorDependencyPaths[topLevelPackage.SPDXID] = path;
    }
  }

  return Object.values(shortestUniqueAncestorDependencyPaths);
}

function getPackageAncestorPathsRecursive(
  dependsOnRelationshipsByRelatedElement: Map<string, IRelationship[]>,
  packagesById: Map<string, IPackage>,
  packageId: string,
  pathSoFar: IPackage[],
  depth: number,
): IPackageDependencyPath[] {
  const currentPackage = packagesById.get(packageId);
  if (!currentPackage) {
    return [{ dependencyPath: pathSoFar }];
  }
  if (depth > 30) {
    console.warn(
      `Maximum depth of 30 reached while resolving package ancestor paths for '${pathSoFar.map((p) => p.name).join(' -> ')}'`,
    );
    return [{ dependencyPath: pathSoFar }];
  }

  const newPath = [currentPackage, ...pathSoFar].filter((p) => p !== undefined);
  const ancestorDependencyPaths: IPackageDependencyPath[] = [];
  const ancestorDependencyReleationships = dependsOnRelationshipsByRelatedElement.get(packageId) || [];
  if (ancestorDependencyReleationships.length > 0) {
    for (const relationship of ancestorDependencyReleationships) {
      ancestorDependencyPaths.push(
        ...getPackageAncestorPathsRecursive(
          dependsOnRelationshipsByRelatedElement,
          packagesById,
          relationship.spdxElementId,
          newPath,
          depth + 1,
        ),
      );
    }
  } else {
    ancestorDependencyPaths.push({ dependencyPath: newPath });
  }

  return ancestorDependencyPaths;
}

export function getPackageLevelName(document: IDocument, packageId: string): string {
  if (isPackageRootLevel(document, packageId)) {
    return 'Root';
  } else if (isPackageTopLevel(document, packageId)) {
    return 'Top';
  } else {
    return 'Transitive';
  }
}

export function isPackageRootLevel(document: IDocument, packageId: string): boolean {
  return getDocumentIndex(document).rootPackageIds.has(packageId);
}

export function isPackageTopLevel(document: IDocument, packageId: string): boolean {
  return getDocumentIndex(document).topLevelPackageIds.has(packageId);
}

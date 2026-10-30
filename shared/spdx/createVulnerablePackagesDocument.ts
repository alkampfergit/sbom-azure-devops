import { getPackageSecurityAdvisories } from './getPackageSecurityAdvisories';
import { spdxConstantsAreEqual } from './models/2.3/constants';
import { IDocument } from './models/2.3/document';
import { IRelationship, RelationshipType } from './models/2.3/relationship';

/**
 * Builds a smaller copy of an SPDX document that holds only the vulnerable packages, plus the packages
 * on their dependency paths up to the root. The report tab uses it for its first view, so it can show
 * the vulnerable packages without downloading the whole manifest.
 *
 * Every package the vulnerable-packages view reads (its level, its ancestor paths) is kept, and the
 * "DependsOn" relationships between kept packages too, so that view shows the same rows as the full
 * document. Files and other relationships are left out.
 * @param document The full SPDX document
 * @returns The vulnerable-only document, or undefined when no package has security advisories
 */
export function createVulnerablePackagesDocument(document: IDocument): IDocument | undefined {
  const packages = document.packages || [];
  const packageIds = new Set(packages.map((p) => p.SPDXID));
  const rootPackageIds = new Set(document.documentDescribes || []);

  // Same packages the report tab counts as vulnerable: root packages are never listed in its package table
  const vulnerablePackageIds = packages
    .filter((p) => !rootPackageIds.has(p.SPDXID) && getPackageSecurityAdvisories(p).length > 0)
    .map((p) => p.SPDXID);
  if (vulnerablePackageIds.length === 0) {
    return undefined;
  }

  // For each package, the packages that depend on it, so the walk can go from a vulnerable package up to the root
  const dependsOn = (document.relationships || []).filter((r) =>
    spdxConstantsAreEqual(r.relationshipType, RelationshipType.DependsOn),
  );
  const dependentIdsByPackageId = new Map<string, string[]>();
  for (const r of dependsOn) {
    const dependents = dependentIdsByPackageId.get(r.relatedSpdxElement) || [];
    dependents.push(r.spdxElementId);
    dependentIdsByPackageId.set(r.relatedSpdxElement, dependents);
  }

  // Keep every package that a vulnerable package can reach by walking up its dependents
  const keptPackageIds = new Set<string>();
  const pending = [...vulnerablePackageIds];
  while (pending.length > 0) {
    const packageId = pending.pop()!;
    if (keptPackageIds.has(packageId)) {
      continue;
    }
    keptPackageIds.add(packageId);
    for (const dependentId of dependentIdsByPackageId.get(packageId) || []) {
      if (packageIds.has(dependentId)) {
        pending.push(dependentId);
      }
    }
  }
  for (const rootPackageId of rootPackageIds) {
    if (packageIds.has(rootPackageId)) {
      keptPackageIds.add(rootPackageId);
    }
  }

  return {
    ...document,
    files: [],
    packages: packages.filter((p) => keptPackageIds.has(p.SPDXID)).map((p) => ({ ...p, hasFiles: undefined })),
    relationships: dependsOn.filter(
      (r: IRelationship) => keptPackageIds.has(r.spdxElementId) && keptPackageIds.has(r.relatedSpdxElement),
    ),
  };
}

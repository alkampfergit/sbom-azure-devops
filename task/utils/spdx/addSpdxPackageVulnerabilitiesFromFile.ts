import { existsSync as fileExistsSync } from 'fs';
import * as fs from 'fs/promises';

import { IExternalVulnerability } from '../../../shared/ghsa/models/externalVulnerability';
import { SecurityAdvisoryIdentifierType } from '../../../shared/ghsa/models/securityAdvisory';
import { ISecurityVulnerability } from '../../../shared/ghsa/models/securityVulnerability';

import { DocumentVersion } from '../../../shared/spdx/models/2.3/document';
import { ExternalRefCategory } from '../../../shared/spdx/models/2.3/externalRef';

import { addSecurityAdvisoryExternalRefsToPackage } from './addSpdxPackageSecurityAdvisories';

/**
 * Apply vulnerability data from one or more locally supplied JSON files to an SPDX document, as an
 * alternative to fetching advisories from the GitHub Advisory Database (`fetchSecurityAdvisories`).
 * Each file must contain a JSON array of `IExternalVulnerability` entries. This is useful when the
 * GitHub connection can't be used to fetch advisories (e.g. an `InstallationToken`-based service
 * connection), or when vulnerability data comes from another scanner entirely (Trivy, `npm audit`,
 * `dotnet list package --vulnerable`, etc), converted to this format by the caller.
 * @param spdxFilePath The path to the SPDX file
 * @param vulnerabilitiesFilePaths One or more paths to `IExternalVulnerability[]` JSON files
 */
export async function addSpdxPackageVulnerabilitiesFromFileAsync(
  spdxFilePath: string,
  vulnerabilitiesFilePaths: string[],
): Promise<void> {
  if (!fileExistsSync(spdxFilePath)) {
    throw new Error(`SPDX file not found: ${spdxFilePath}`);
  }

  // Read and merge all vulnerability source files
  const externalVulnerabilities: IExternalVulnerability[] = [];
  for (const vulnerabilitiesFilePath of vulnerabilitiesFilePaths) {
    if (!fileExistsSync(vulnerabilitiesFilePath)) {
      throw new Error(`Vulnerabilities source file not found: '${vulnerabilitiesFilePath}'`);
    }
    const parsed = JSON.parse(await fs.readFile(vulnerabilitiesFilePath, 'utf-8'));
    if (!Array.isArray(parsed)) {
      throw new Error(`Vulnerabilities source file must contain a JSON array: '${vulnerabilitiesFilePath}'`);
    }
    externalVulnerabilities.push(...(parsed as IExternalVulnerability[]));
  }
  if (externalVulnerabilities.length === 0) {
    console.info('No vulnerabilities found in vulnerabilities source file(s)');
    return;
  }

  // Read the SPDX file
  const sbom = JSON.parse(await fs.readFile(spdxFilePath, 'utf-8'));

  // Index SBOM packages by lower-cased name for fast lookup
  const packagesByName = new Map<string, any[]>();
  for (const pkg of sbom.packages as any[]) {
    const name = (pkg.name as string | undefined)?.toLowerCase();
    if (!name) {
      continue;
    }
    const existing = packagesByName.get(name);
    if (existing) {
      existing.push(pkg);
    } else {
      packagesByName.set(name, [pkg]);
    }
  }

  // Match each external vulnerability to SBOM package(s) by name (and version, if specified), and
  // add the same security advisory external references that the GHSA-fetch path would have added.
  let matchedVulnerabilityCount = 0;
  let unmatchedVulnerabilityCount = 0;
  for (const externalVulnerability of externalVulnerabilities) {
    const candidatePackages = packagesByName.get(externalVulnerability.packageName?.toLowerCase()) || [];
    const matchingPackages = externalVulnerability.packageVersion
      ? candidatePackages.filter((p) => p.versionInfo === externalVulnerability.packageVersion)
      : candidatePackages;
    if (matchingPackages.length === 0) {
      unmatchedVulnerabilityCount++;
      continue;
    }
    matchedVulnerabilityCount++;
    for (const pkg of matchingPackages) {
      const packageReferenceLocator = (pkg.externalRefs as any[])?.find(
        (r) => r.referenceCategory === ExternalRefCategory.PackageManager,
      )?.referenceLocator;
      addSecurityAdvisoryExternalRefsToPackage(
        pkg,
        toSecurityVulnerability(externalVulnerability, pkg, packageReferenceLocator),
      );
    }
  }

  console.info(
    `Applied ${matchedVulnerabilityCount} vulnerabilities from vulnerabilities source file(s) to SBOM packages` +
      (unmatchedVulnerabilityCount
        ? `; ${unmatchedVulnerabilityCount} did not match any package by name${
            externalVulnerabilities.some((v) => v.packageVersion) ? '/version' : ''
          }`
        : ''),
  );
  if (matchedVulnerabilityCount === 0) {
    return;
  }

  // Bump the SPDX document version to 2.3; This is minimum version that supports security advisory/url external references
  // https://spdx.github.io/spdx-spec/v2.3/diffs-from-previous-editions/
  if (sbom.spdxVersion !== DocumentVersion.SPDX_2_3) {
    console.info(`Upgrading SDPX version from ${sbom.spdxVersion} to ${DocumentVersion.SPDX_2_3}`);
    sbom.spdxVersion = DocumentVersion.SPDX_2_3;
  }

  // Write changes to the SPDX file
  console.info(`Enriching SDPX with security advisory external references from vulnerabilities source file(s)`);
  await fs.writeFile(spdxFilePath, JSON.stringify(sbom, null, 2), 'utf-8');
}

/**
 * Convert a flat `IExternalVulnerability` entry into the same `ISecurityVulnerability` shape used by
 * the GHSA-fetch path, so both paths can share `addSecurityAdvisoryExternalRefsToPackage`.
 */
function toSecurityVulnerability(
  external: IExternalVulnerability,
  pkg: any,
  packageReferenceLocator: string | undefined,
): ISecurityVulnerability {
  const permalink = external.url || deriveAdvisoryPermalink(external);

  const identifiers: { type: SecurityAdvisoryIdentifierType | string; value: string }[] = [];
  if (external.cveId) {
    identifiers.push({ type: SecurityAdvisoryIdentifierType.Cve, value: external.cveId });
  }
  if (external.id && external.id !== external.cveId) {
    identifiers.push({
      type: external.id.toUpperCase().startsWith('GHSA-') ? SecurityAdvisoryIdentifierType.Ghsa : 'OTHER',
      value: external.id,
    });
  }

  return {
    ecosystem: '',
    package: {
      id: packageReferenceLocator || external.packageName,
      name: pkg.name,
      version: pkg.versionInfo,
    },
    advisory: {
      identifiers,
      severity: external.severity,
      summary: external.summary || external.id,
      description: external.description || '',
      references: external.url ? [external.url] : [],
      cvss: {
        score: external.cvssScore || 0,
        vectorString: '',
      },
      epss: {
        percentage: 0,
        percentile: 0,
      },
      cwes: [],
      publishedAt: external.publishedAt || '',
      updatedAt: external.publishedAt || '',
      withdrawnAt: '',
      permalink,
    },
    vulnerableVersionRange: external.vulnerableVersionRange || '',
    firstPatchedVersion: external.fixedVersion || '',
  };
}

/**
 * Best-effort advisory URL for a vulnerability that didn't specify one. Also used as the dedup key
 * for the security advisories list in the SBOM tab (see `documentPage.tsx`), so it must be unique
 * per distinct vulnerability even when no real URL is known.
 */
function deriveAdvisoryPermalink(external: IExternalVulnerability): string {
  if (external.cveId) {
    return `https://nvd.nist.gov/vuln/detail/${external.cveId}`;
  }
  if (external.id?.toUpperCase().startsWith('GHSA-')) {
    return `https://github.com/advisories/${external.id}`;
  }
  return `urn:vulnerability:${external.packageName}:${external.packageVersion || ''}:${external.id}`;
}

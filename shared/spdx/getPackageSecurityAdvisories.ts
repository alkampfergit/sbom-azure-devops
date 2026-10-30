import { ISecurityVulnerability } from '../ghsa/models/securityVulnerability';
import { ExternalRefCategory, ExternalRefSecurityType, parseExternalRefsAs } from './models/2.3/externalRef';
import { IPackage } from './models/2.3/package';
import { parseSpdxLegacySecurityAdvisories } from './parseSpdxLegacySecurityAdvisories';

/**
 * The security advisories recorded on a package. Shared by the task (which decides what counts as a
 * vulnerable package) and the UI (which filters and counts them), so the two always agree.
 * @param pkg The SPDX package
 * @returns The advisories, or an empty array when the package has none
 */
export function getPackageSecurityAdvisories(pkg: IPackage): ISecurityVulnerability[] {
  return (
    parseExternalRefsAs<ISecurityVulnerability>(
      pkg.externalRefs || [],
      ExternalRefCategory.Security,
      ExternalRefSecurityType.Url,
    ) ||
    parseSpdxLegacySecurityAdvisories(pkg) ||
    []
  );
}

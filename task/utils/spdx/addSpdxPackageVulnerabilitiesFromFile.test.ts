import { expect } from '@jest/globals';
import * as fs from 'fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'path';

import { IExternalVulnerability } from '../../../shared/ghsa/models/externalVulnerability';
import { SecurityAdvisorySeverity } from '../../../shared/ghsa/models/securityAdvisory';
import { ExternalRefCategory, ExternalRefSecurityType } from '../../../shared/spdx/models/2.3/externalRef';

import { addSpdxPackageVulnerabilitiesFromFileAsync } from './addSpdxPackageVulnerabilitiesFromFile';

async function writeTempJsonFile(name: string, content: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'vuln-source-test-'));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, JSON.stringify(content), 'utf-8');
  return filePath;
}

function buildSpdxDocument() {
  return {
    spdxVersion: 'SPDX-2.2',
    packages: [
      {
        SPDXID: 'SPDXRef-Package-left-pad',
        name: 'left-pad',
        versionInfo: '1.3.0',
        externalRefs: [
          {
            referenceCategory: ExternalRefCategory.PackageManager,
            referenceType: 'purl',
            referenceLocator: 'pkg:npm/left-pad@1.3.0',
          },
        ],
      },
      {
        SPDXID: 'SPDXRef-Package-lodash',
        name: 'lodash',
        versionInfo: '4.17.15',
        externalRefs: [
          {
            referenceCategory: ExternalRefCategory.PackageManager,
            referenceType: 'purl',
            referenceLocator: 'pkg:npm/lodash@4.17.15',
          },
        ],
      },
      {
        SPDXID: 'SPDXRef-Package-lodash-old',
        name: 'lodash',
        versionInfo: '3.0.0',
      },
    ],
  };
}

describe('addSpdxPackageVulnerabilitiesFromFileAsync', () => {
  it('applies vulnerabilities matched by package name only', async () => {
    const spdxFilePath = await writeTempJsonFile('manifest.spdx.json', buildSpdxDocument());
    const vulnerabilities: IExternalVulnerability[] = [
      {
        packageName: 'left-pad',
        id: 'GHSA-test-0001',
        severity: SecurityAdvisorySeverity.High,
        summary: 'Test vulnerability in left-pad',
      },
    ];
    const vulnerabilitiesFilePath = await writeTempJsonFile('vulns.json', vulnerabilities);

    await addSpdxPackageVulnerabilitiesFromFileAsync(spdxFilePath, [vulnerabilitiesFilePath]);

    const sbom = JSON.parse(await fs.readFile(spdxFilePath, 'utf-8'));
    expect(sbom.spdxVersion).toBe('SPDX-2.3');

    const leftPad = sbom.packages.find((p: any) => p.name === 'left-pad');
    const securityRefs = leftPad.externalRefs.filter((r: any) => r.referenceCategory === ExternalRefCategory.Security);
    expect(securityRefs).toHaveLength(2);
    expect(securityRefs.find((r: any) => r.referenceType === ExternalRefSecurityType.Advisory)?.comment).toContain(
      'left-pad',
    );

    // Packages that weren't matched are left untouched
    const untouched = sbom.packages.filter((p: any) => p.name === 'lodash');
    for (const pkg of untouched) {
      expect((pkg.externalRefs || []).some((r: any) => r.referenceCategory === ExternalRefCategory.Security)).toBe(
        false,
      );
    }
  });

  it('applies vulnerabilities to only the matching version when packageVersion is specified', async () => {
    const spdxFilePath = await writeTempJsonFile('manifest.spdx.json', buildSpdxDocument());
    const vulnerabilities: IExternalVulnerability[] = [
      {
        packageName: 'lodash',
        packageVersion: '4.17.15',
        id: 'GHSA-test-0002',
        severity: SecurityAdvisorySeverity.Critical,
      },
    ];
    const vulnerabilitiesFilePath = await writeTempJsonFile('vulns.json', vulnerabilities);

    await addSpdxPackageVulnerabilitiesFromFileAsync(spdxFilePath, [vulnerabilitiesFilePath]);

    const sbom = JSON.parse(await fs.readFile(spdxFilePath, 'utf-8'));
    const newLodash = sbom.packages.find((p: any) => p.SPDXID === 'SPDXRef-Package-lodash');
    const oldLodash = sbom.packages.find((p: any) => p.SPDXID === 'SPDXRef-Package-lodash-old');
    expect((newLodash.externalRefs || []).some((r: any) => r.referenceCategory === ExternalRefCategory.Security)).toBe(
      true,
    );
    expect((oldLodash.externalRefs || []).some((r: any) => r.referenceCategory === ExternalRefCategory.Security)).toBe(
      false,
    );
  });

  it('merges vulnerabilities from multiple source files', async () => {
    const spdxFilePath = await writeTempJsonFile('manifest.spdx.json', buildSpdxDocument());
    const file1 = await writeTempJsonFile('vulns1.json', [
      { packageName: 'left-pad', id: 'GHSA-test-0001', severity: SecurityAdvisorySeverity.Low },
    ] as IExternalVulnerability[]);
    const file2 = await writeTempJsonFile('vulns2.json', [
      { packageName: 'lodash', id: 'GHSA-test-0002', severity: SecurityAdvisorySeverity.Moderate },
    ] as IExternalVulnerability[]);

    await addSpdxPackageVulnerabilitiesFromFileAsync(spdxFilePath, [file1, file2]);

    const sbom = JSON.parse(await fs.readFile(spdxFilePath, 'utf-8'));
    const leftPad = sbom.packages.find((p: any) => p.name === 'left-pad');
    const lodash = sbom.packages.find((p: any) => p.SPDXID === 'SPDXRef-Package-lodash');
    expect((leftPad.externalRefs || []).some((r: any) => r.referenceCategory === ExternalRefCategory.Security)).toBe(
      true,
    );
    expect((lodash.externalRefs || []).some((r: any) => r.referenceCategory === ExternalRefCategory.Security)).toBe(
      true,
    );
  });

  it('does not modify the SPDX file when no vulnerabilities match any package', async () => {
    const spdxFilePath = await writeTempJsonFile('manifest.spdx.json', buildSpdxDocument());
    const originalContent = await fs.readFile(spdxFilePath, 'utf-8');
    const vulnerabilities: IExternalVulnerability[] = [
      { packageName: 'not-a-real-package', id: 'GHSA-test-9999', severity: SecurityAdvisorySeverity.Low },
    ];
    const vulnerabilitiesFilePath = await writeTempJsonFile('vulns.json', vulnerabilities);

    await addSpdxPackageVulnerabilitiesFromFileAsync(spdxFilePath, [vulnerabilitiesFilePath]);

    const contentAfter = await fs.readFile(spdxFilePath, 'utf-8');
    expect(contentAfter).toBe(originalContent);
  });

  it('throws if the vulnerabilities source file does not exist', async () => {
    const spdxFilePath = await writeTempJsonFile('manifest.spdx.json', buildSpdxDocument());
    await expect(addSpdxPackageVulnerabilitiesFromFileAsync(spdxFilePath, ['/does/not/exist.json'])).rejects.toThrow();
  });

  it('throws if the vulnerabilities source file is not a JSON array', async () => {
    const spdxFilePath = await writeTempJsonFile('manifest.spdx.json', buildSpdxDocument());
    const vulnerabilitiesFilePath = await writeTempJsonFile('vulns.json', { not: 'an array' });
    await expect(addSpdxPackageVulnerabilitiesFromFileAsync(spdxFilePath, [vulnerabilitiesFilePath])).rejects.toThrow();
  });
});

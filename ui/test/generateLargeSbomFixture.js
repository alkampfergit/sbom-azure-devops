#!/usr/bin/env node
// Generates a large, synthetic-but-schema-valid SPDX 2.3 document for local UI performance
// testing (see measureRenderPerf.js). Modeled on tests/spdx/manifest.spdx.json's shape --
// re-read that file if this generator ever needs to change, rather than guessing the schema.
//
// Usage: node ui/test/generateLargeSbomFixture.js [outPath] [packageCount] [fileCount] [vulnerabilityCount] [vulnerablePackageCount] [supplierCount]
// Defaults are shaped to match a real large SBOM seen in production use: most packages are NOT
// vulnerable and share only a handful of suppliers/managers -- vulnerabilities and suppliers are
// both concentrated in a minority of packages, not spread near-uniformly across all of them.

const fs = require('fs');
const path = require('path');

const outPath = process.argv[2] || path.join(__dirname, '.generated', 'large-manifest.spdx.json');
const packageCount = parseInt(process.argv[3] || '2000', 10);
const fileCount = parseInt(process.argv[4] || '130000', 10);
const vulnerabilityCount = parseInt(process.argv[5] || '1000', 10);
const vulnerablePackageCount = parseInt(process.argv[6] || '200', 10);
const supplierCount = parseInt(process.argv[7] || '200', 10);

const PACKAGE_MANAGERS = ['npm', 'nuget', 'pypi', 'golang', 'maven', 'cargo', 'gem', 'composer'];
const SEVERITIES = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

function pseudoRandom(seed) {
  // Deterministic (no Math.random dependency on run order) so repeated generations are diffable.
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function buildPackages() {
  const packages = [];
  for (let i = 0; i < packageCount; i++) {
    const manager = PACKAGE_MANAGERS[i % PACKAGE_MANAGERS.length];
    const name = `synthetic-package-${i}`;
    // maven purls require a namespace (groupId) component, e.g. pkg:maven/group/artifact@version;
    // every other manager here is fine without one.
    const purlName = manager === 'maven' ? `synthetic-group/${name}` : name;
    packages.push({
      name,
      SPDXID: `SPDXRef-Package-synthetic-${i}`,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'MIT',
      licenseDeclared: 'MIT',
      copyrightText: 'NOASSERTION',
      versionInfo: '1.0.0',
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: `pkg:${manager}/${purlName}@1.0.0`,
        },
      ],
      supplier: `Organization: Synthetic Supplier ${i % supplierCount}`,
    });
  }
  return packages;
}

function buildFiles() {
  const files = [];
  for (let i = 0; i < fileCount; i++) {
    files.push({
      fileName: `./synthetic/file-${i}.txt`,
      SPDXID: `SPDXRef-File-synthetic-${i}`,
      checksums: [
        { algorithm: 'SHA256', checksumValue: (i.toString(16).padStart(8, '0') + '0'.repeat(56)).slice(0, 64) },
      ],
      licenseConcluded: 'NOASSERTION',
      licenseInfoInFiles: ['NOASSERTION'],
      copyrightText: 'NOASSERTION',
    });
  }
  return files;
}

// Mirrors task/utils/spdx/addSpdxPackageSecurityAdvisories.ts's addSecurityAdvisoryExternalRefsToPackage --
// keep in sync with that function if the security external-ref shape ever changes.
function addVulnerability(pkg, index) {
  const severity = SEVERITIES[index % SEVERITIES.length];
  const advisoryId = `GHSA-synthetic-${index.toString(36)}`;
  const vulnerability = {
    ecosystem: '',
    package: { id: pkg.externalRefs[0].referenceLocator, name: pkg.name, version: pkg.versionInfo },
    advisory: {
      identifiers: [{ type: 'GHSA', value: advisoryId }],
      severity,
      summary: `Synthetic ${severity.toLowerCase()} vulnerability #${index}`,
      description: 'Synthetic vulnerability generated for local UI performance testing.',
      references: [],
      cvss: { score: 0, vectorString: '' },
      epss: { percentage: 0, percentile: 0 },
      cwes: [{ id: `CWE-${100 + (index % 50)}`, name: 'Synthetic Weakness', description: '' }],
      publishedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      withdrawnAt: '',
      permalink: `https://example.invalid/advisories/${advisoryId}`,
    },
    vulnerableVersionRange: '<= 1.0.0',
    firstPatchedVersion: '1.0.1',
  };

  pkg.externalRefs.push({
    referenceCategory: 'SECURITY',
    referenceType: 'advisory',
    referenceLocator: vulnerability.advisory.permalink,
    comment: `[${severity}] ${vulnerability.advisory.summary}; Affects ${pkg.name} v${pkg.versionInfo}`,
  });
  pkg.externalRefs.push({
    referenceCategory: 'SECURITY',
    referenceType: 'url',
    referenceLocator: `data:text/json;base64,${Buffer.from(JSON.stringify(vulnerability)).toString('base64')}`,
    comment: `Security vulnerability details for ${advisoryId} encoded as Base64 JSON text`,
  });
}

function main() {
  const packages = buildPackages();
  const files = buildFiles();

  // Pick a fixed subset of packages to be "the vulnerable ones" -- most real SBOMs have vulnerabilities
  // concentrated in a small minority of packages, not spread near-uniformly across all of them.
  const vulnerablePackages = [];
  for (let i = 0; i < Math.min(vulnerablePackageCount, packages.length); i++) {
    vulnerablePackages.push(packages[Math.floor(pseudoRandom(i * 7919 + 1) * packages.length)]);
  }

  for (let i = 0; i < vulnerabilityCount; i++) {
    const pkg = vulnerablePackages[Math.floor(pseudoRandom(i + 1) * vulnerablePackages.length)];
    addVulnerability(pkg, i);
  }

  const rootPackage = {
    name: 'Synthetic Root Package',
    SPDXID: 'SPDXRef-RootPackage',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    versionInfo: '1.0.0',
    externalRefs: [],
    supplier: 'Organization: Synthetic',
  };

  const relationships = [
    { relationshipType: 'DESCRIBES', spdxElementId: 'SPDXRef-DOCUMENT', relatedSpdxElement: 'SPDXRef-RootPackage' },
  ];
  for (const pkg of packages) {
    relationships.push({
      relationshipType: 'DEPENDS_ON',
      spdxElementId: 'SPDXRef-RootPackage',
      relatedSpdxElement: pkg.SPDXID,
    });
  }

  const document = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: 'Synthetic Large Package',
    documentNamespace: `https://example.invalid/synthetic-large-package/${Date.now()}`,
    creationInfo: {
      created: '2026-01-01T00:00:00Z',
      creators: ['Organization: Synthetic', 'Tool: generateLargeSbomFixture.js'],
    },
    documentDescribes: ['SPDXRef-RootPackage'],
    files,
    packages: [rootPackage, ...packages],
    relationships,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(document));
  const stats = fs.statSync(outPath);
  const distinctVulnerable = new Set(vulnerablePackages.map((p) => p.SPDXID)).size;
  console.log(
    `Wrote ${outPath} (${(stats.size / 1024 / 1024).toFixed(1)} MiB): ${packages.length} packages (${distinctVulnerable} vulnerable, ${supplierCount} suppliers), ${files.length} files, ${vulnerabilityCount} vulnerabilities`,
  );
}

main();

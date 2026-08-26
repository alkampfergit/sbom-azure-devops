import { expect } from '@jest/globals';

import {
  ExternalRefCategory,
  ExternalRefPackageManagerType,
  getExternalRefPackageManagerName,
  getExternalRefPackageManagerUrl,
  IExternalRef,
} from './externalRef';

describe('getExternalRefPackageManagerName', () => {
  it('returns the package manager name for a well-formed purl', () => {
    const refs: IExternalRef[] = [
      {
        referenceCategory: ExternalRefCategory.PackageManager,
        referenceType: ExternalRefPackageManagerType.PackageUrl,
        referenceLocator: 'pkg:npm/left-pad@1.3.0',
      },
    ];
    expect(getExternalRefPackageManagerName(refs)).toBe('Npm');
  });

  it('returns undefined instead of throwing for a malformed purl (invalid percent-encoding)', () => {
    const refs: IExternalRef[] = [
      {
        referenceCategory: ExternalRefCategory.PackageManager,
        referenceType: ExternalRefPackageManagerType.PackageUrl,
        referenceLocator: 'pkg:npm/%zzinvalid-name',
      },
    ];
    expect(() => getExternalRefPackageManagerName(refs)).not.toThrow();
    expect(getExternalRefPackageManagerName(refs)).toBeUndefined();
  });
});

describe('getExternalRefPackageManagerUrl', () => {
  it('returns a link for a well-formed npm purl', () => {
    const refs: IExternalRef[] = [
      {
        referenceCategory: ExternalRefCategory.PackageManager,
        referenceType: ExternalRefPackageManagerType.PackageUrl,
        referenceLocator: 'pkg:npm/left-pad@1.3.0',
      },
    ];
    expect(getExternalRefPackageManagerUrl(refs)).toBe('https://www.npmjs.com/package/left-pad/v/1.3.0');
  });

  it('returns undefined instead of throwing for a malformed purl (invalid percent-encoding)', () => {
    const refs: IExternalRef[] = [
      {
        referenceCategory: ExternalRefCategory.PackageManager,
        referenceType: ExternalRefPackageManagerType.PackageUrl,
        referenceLocator: 'pkg:npm/%zzinvalid-name',
      },
    ];
    expect(() => getExternalRefPackageManagerUrl(refs)).not.toThrow();
    expect(getExternalRefPackageManagerUrl(refs)).toBeUndefined();
  });
});

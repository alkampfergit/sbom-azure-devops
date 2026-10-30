import { IDocument } from '../spdx/models/2.3/document';

export interface ISbomBuildArtifact {
  id: string;
  spdxDocument: IDocument;
  spdxJsonDocument: ArrayBuffer;
  loadSvgDocumentAsync?: () => Promise<ArrayBuffer>;
  // Set when `spdxDocument` only holds the vulnerable packages (see createVulnerablePackagesDocument), which is
  // enough for the first view. `spdxJsonDocument` is then the bytes of that partial document too, so anything that
  // needs the full manifest (other views, exports, downloads) must first await `loadFullArtifactAsync`.
  isPartial?: boolean;
  // Loads the full manifest and resolves to the complete artifact; set only when `isPartial` is set
  loadFullArtifactAsync?: () => Promise<ISbomBuildArtifact>;
}

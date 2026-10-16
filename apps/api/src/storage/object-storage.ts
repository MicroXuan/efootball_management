export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export type StorageScope = 'league-images' | 'league-center-banners' | 'team-crests' | 'match-result-evidence';

export type EvidenceMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface DirectUploadGrant {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export interface StoredObjectMetadata {
  mimeType: string;
  size: number;
  /** Absent when inspection rejects size before downloading the object. */
  checksumSha256?: string;
}

export interface StoredUploadInput {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
  size: number;
}

export interface StoredObject {
  key: string;
  url: string;
  mimeType: StoredUploadInput['mimeType'];
  size: number;
}

export interface ReadableStoredObject {
  buffer: Buffer;
  mimeType: string;
  size: number;
}

export interface ObjectStorage {
  put(scope: StorageScope, file: StoredUploadInput): Promise<StoredObject>;
  putNamed?(scope: StorageScope, name: string, file: StoredUploadInput): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  read?(key: string): Promise<ReadableStoredObject | null>;
  createDirectUpload?(scope: StorageScope, name: string, mimeType: EvidenceMimeType): Promise<DirectUploadGrant>;
  temporaryReadUrl?(key: string, maxAgeSeconds: number): Promise<string>;
  inspect?(key: string): Promise<StoredObjectMetadata | null>;
  writePrivate?(key: string, body: Buffer, mimeType: string): Promise<void>;
  readPrivate?(key: string): Promise<ReadableStoredObject | null>;
  verifyPrivateRead?(key: string, expires: string, signature: string): boolean;
}

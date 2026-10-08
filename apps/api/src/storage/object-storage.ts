export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export type StorageScope = 'league-images' | 'league-center-banners' | 'team-crests';

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
}

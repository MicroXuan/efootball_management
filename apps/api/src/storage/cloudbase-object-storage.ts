import { randomUUID } from 'node:crypto';
import type { ObjectStorage, StorageScope, StoredObject, StoredUploadInput } from './object-storage.js';

export interface CloudBaseStorageClient {
  uploadFile(input: { cloudPath: string; fileContent: Buffer }): Promise<{ fileID: string }>;
  deleteFile(input: { fileList: string[] }): Promise<unknown>;
  downloadFile(input: { fileID: string }): Promise<{ fileContent: string | Buffer | undefined }>;
}

export class CloudBaseObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: CloudBaseStorageClient,
    private readonly publicBaseUrl?: string
  ) {}

  async put(scope: StorageScope, file: StoredUploadInput): Promise<StoredObject> {
    const cloudPath = `${scope}--${randomUUID()}.${file.extension}`;
    const result = await this.client.uploadFile({ cloudPath, fileContent: file.buffer });
    return {
      key: result.fileID,
      url: result.fileID,
      mimeType: file.mimeType,
      size: file.size
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.deleteFile({ fileList: [key] });
  }

  publicUrlFor(key: string): string {
    return this.publicBaseUrl
      ? `${this.publicBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(key)}`
      : key;
  }
}

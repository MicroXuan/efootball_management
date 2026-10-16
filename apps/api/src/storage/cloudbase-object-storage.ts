import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { MAX_RESULT_EVIDENCE_BYTES, validateResultEvidenceImage } from './image-validation.js';
import { EVIDENCE_TEMP_PREFIX, retainedEvidenceKey } from './evidence-object-keys.js';
import type { DirectUploadGrant, EvidenceMimeType, ObjectStorage, StorageScope, StoredObject, StoredObjectMetadata, StoredUploadInput } from './object-storage.js';

export interface CloudBaseStorageClient {
  uploadFile(input: { cloudPath: string; fileContent: Buffer }): Promise<{ fileID: string }>;
  deleteFile(input: { fileList: string[] }): Promise<unknown>;
  downloadFile(input: { fileID: string }): Promise<{ fileContent: string | Buffer | undefined }>;
  getUploadMetadata?(input: { cloudPath: string }): Promise<{ data: { url: string; token: string; authorization: string; fileId: string; cosFileId: string; download_url: string } }>;
  getTempFileURL?(input: { fileList: Array<{ fileID: string; maxAge: number }> }): Promise<{ fileList: Array<{ code: string; fileID: string; tempFileURL: string }> }>;
  getFileInfo?(input: { fileList: string[] }): Promise<{ fileList: Array<{ code: string; fileID: string; contentType?: string; mime?: string; size?: number }> }>;
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

  async putNamed(scope: StorageScope, name: string, file: StoredUploadInput): Promise<StoredObject> {
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(name)) throw new Error('Invalid storage object name');
    const cloudPath = `${scope}--${name}.${file.extension}`;
    const result = await this.client.uploadFile({ cloudPath, fileContent: file.buffer });
    return { key: result.fileID, url: result.fileID, mimeType: file.mimeType, size: file.size };
  }

  async delete(key: string): Promise<void> {
    const result = await this.client.deleteFile({ fileList: [key] }) as {
      code?: string; fileList?: Array<{ fileID: string; code: string }>;
    } | undefined;
    if (result?.code || !result?.fileList?.some((file) => file.fileID === key
      && ['SUCCESS', 'STORAGE_FILE_NONEXIST'].includes(file.code))) {
      throw new Error('CloudBase object deletion was not acknowledged');
    }
  }

  async createDirectUpload(scope: StorageScope, name: string, mimeType: EvidenceMimeType): Promise<DirectUploadGrant> {
    if (scope !== 'match-result-evidence' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(name)) {
      throw new Error('Invalid private storage object');
    }
    if (!this.client.getUploadMetadata) throw new Error('CloudBase direct upload is unavailable');
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
    const cloudPath = `${EVIDENCE_TEMP_PREFIX}${name}.${extension}`;
    const { data } = await this.client.getUploadMetadata({ cloudPath });
    return {
      key: data.fileId,
      uploadUrl: data.url,
      headers: {
        authorization: data.authorization,
        Signature: data.authorization,
        'x-cos-security-token': data.token,
        'x-cos-meta-fileid': data.cosFileId,
        key: encodeURIComponent(cloudPath),
        'content-type': mimeType
      }
    };
  }

  async temporaryReadUrl(key: string, maxAgeSeconds: number): Promise<string> {
    if (!this.client.getTempFileURL) throw new Error('CloudBase temporary reads are unavailable');
    const result = await this.client.getTempFileURL({ fileList: [{ fileID: key, maxAge: maxAgeSeconds }] });
    const file = result.fileList.find((entry) => entry.fileID === key && entry.code === 'SUCCESS');
    if (!file?.tempFileURL) throw new Error('CloudBase object is unavailable');
    return file.tempFileURL;
  }

  async inspect(key: string): Promise<StoredObjectMetadata | null> {
    if (!this.client.getFileInfo) throw new Error('CloudBase object inspection is unavailable');
    const result = await this.client.getFileInfo({ fileList: [key] });
    const file = result.fileList.find((entry) => entry.fileID === key && entry.code === 'SUCCESS');
    if (!file || !Number.isFinite(file.size)) return null;
    const mimeType = file.mime ?? file.contentType?.split(';')[0]?.trim() ?? '';
    if (file.size! > MAX_RESULT_EVIDENCE_BYTES) return { mimeType, size: file.size! };
    const downloaded = await this.client.downloadFile({ fileID: key });
    const bytes = Buffer.isBuffer(downloaded.fileContent)
      ? downloaded.fileContent
      : typeof downloaded.fileContent === 'string'
        ? Buffer.from(downloaded.fileContent, 'binary')
        : null;
    if (!bytes || bytes.length !== file.size) {
      throw new BadRequestException({ code: 'INVALID_RESULT_EVIDENCE', message: 'Stored evidence size could not be verified' });
    }
    const validated = validateResultEvidenceImage({ buffer: bytes, originalname: key, mimetype: mimeType, size: bytes.length });
    return { mimeType: validated.mimeType, size: validated.size, buffer: bytes,
      checksumSha256: createHash('sha256').update(bytes).digest('hex') };
  }

  async promoteEvidence(key: string, object: StoredObjectMetadata & { buffer: Buffer }): Promise<string> {
    const retainedKey = retainedEvidenceKey(key);
    const file = validateResultEvidenceImage({ buffer: object.buffer, size: object.size,
      mimetype: object.mimeType, originalname: key });
    if (createHash('sha256').update(file.buffer).digest('hex') !== object.checksumSha256) throw new Error('Evidence checksum changed');
    // Reuse verified bytes: the signed temporary PUT may still overwrite its source object.
    const result = await this.client.uploadFile({ cloudPath: retainedKey.replace(/^cloud:\/\/[^/]+\//, ''), fileContent: file.buffer });
    if (result.fileID !== retainedKey) throw new Error('Evidence promotion returned an unexpected key');
    return retainedKey;
  }

  publicUrlFor(key: string): string {
    return this.publicBaseUrl
      ? `${this.publicBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(key)}`
      : key;
  }
}

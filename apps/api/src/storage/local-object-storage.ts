import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type {
  ObjectStorage,
  DirectUploadGrant,
  EvidenceMimeType,
  StoredObjectMetadata,
  ReadableStoredObject,
  StorageScope,
  StoredObject,
  StoredUploadInput
} from './object-storage.js';

const SAFE_KEY = /^(?:league-images|league-center-banners|team-crests)--[0-9a-f-]+\.(?:jpg|png|webp)$/;
const PRIVATE_KEY = /^match-result-evidence--[a-z0-9][a-z0-9-]{0,127}\.(?:jpg|png|webp)$/;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

export class LocalObjectStorage implements ObjectStorage {
  private readonly publicBaseUrl: string;
  private readonly privateReadSecret = randomBytes(32);

  constructor(
    private readonly directory: string,
    publicBaseUrl: string
  ) {
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
  }

  async put(scope: StorageScope, file: StoredUploadInput): Promise<StoredObject> {
    await mkdir(this.directory, { recursive: true });
    const key = `${scope}--${randomUUID()}.${file.extension}`;
    await writeFile(this.pathFor(key), file.buffer, { flag: 'wx' });
    return {
      key,
      url: `${this.publicBaseUrl}/v1/media/${key}`,
      mimeType: file.mimeType,
      size: file.size
    };
  }

  async putNamed(scope: StorageScope, name: string, file: StoredUploadInput): Promise<StoredObject> {
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(name)) throw new Error('Invalid storage object name');
    await mkdir(this.directory, { recursive: true });
    const key = `${scope}--${name}.${file.extension}`;
    try {
      await writeFile(this.pathFor(key), file.buffer, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return { key, url: `${this.publicBaseUrl}/v1/media/${key}`, mimeType: file.mimeType, size: file.size };
  }

  async delete(key: string): Promise<void> {
    await rm(PRIVATE_KEY.test(key) ? this.privatePathFor(key) : this.pathFor(key), { force: true });
  }

  async read(key: string): Promise<ReadableStoredObject | null> {
    if (PRIVATE_KEY.test(key)) return null;
    try {
      const path = this.pathFor(key);
      const [buffer, metadata] = await Promise.all([readFile(path), stat(path)]);
      return {
        buffer,
        mimeType: MIME_BY_EXTENSION[extname(key)] ?? 'application/octet-stream',
        size: metadata.size
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async createDirectUpload(scope: StorageScope, name: string, mimeType: EvidenceMimeType): Promise<DirectUploadGrant> {
    if (scope !== 'match-result-evidence' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(name)) {
      throw new Error('Invalid private storage object');
    }
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp';
    const key = `${scope}--${name}.${extension}`;
    return { key, uploadUrl: `${this.publicBaseUrl}/v1/result-evidence/objects/${key}`, headers: { 'content-type': mimeType } };
  }

  async temporaryReadUrl(key: string, maxAgeSeconds: number): Promise<string> {
    this.privatePathFor(key);
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 600) {
      throw new Error('Invalid private read lifetime');
    }
    const expires = String(Date.now() + maxAgeSeconds * 1000);
    const signature = this.readSignature(key, expires);
    return `${this.publicBaseUrl}/v1/result-evidence/objects/${key}?expires=${expires}&signature=${signature}`;
  }

  verifyPrivateRead(key: string, expires: string, signature: string): boolean {
    if (!PRIVATE_KEY.test(key) || !/^\d{13}$/.test(expires) || Number(expires) <= Date.now() || !/^[a-f0-9]{64}$/.test(signature)) {
      return false;
    }
    const expected = Buffer.from(this.readSignature(key, expires), 'hex');
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  }

  async inspect(key: string): Promise<StoredObjectMetadata | null> {
    const object = await this.readPrivate(key);
    return object ? { mimeType: object.mimeType, size: object.size } : null;
  }

  async writePrivate(key: string, body: Buffer, mimeType: string): Promise<void> {
    const path = this.privatePathFor(key);
    if (MIME_BY_EXTENSION[extname(key)] !== mimeType) throw new Error('Private object MIME type mismatch');
    await mkdir(this.directory, { recursive: true });
    await writeFile(path, body, { flag: 'wx' });
  }

  async readPrivate(key: string): Promise<ReadableStoredObject | null> {
    try {
      const path = this.privatePathFor(key);
      const [buffer, metadata] = await Promise.all([readFile(path), stat(path)]);
      return { buffer, mimeType: MIME_BY_EXTENSION[extname(key)] ?? 'application/octet-stream', size: metadata.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error('Invalid storage key');
    return join(this.directory, key);
  }

  private privatePathFor(key: string): string {
    if (!PRIVATE_KEY.test(key)) throw new Error('Invalid private storage key');
    return join(this.directory, key);
  }

  private readSignature(key: string, expires: string): string {
    return createHmac('sha256', this.privateReadSecret).update(`${key}:${expires}`).digest('hex');
  }
}

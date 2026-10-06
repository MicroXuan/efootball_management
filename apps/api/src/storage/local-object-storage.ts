import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type {
  ObjectStorage,
  ReadableStoredObject,
  StorageScope,
  StoredObject,
  StoredUploadInput
} from './object-storage.js';

const SAFE_KEY = /^(?:league-images|league-center-banners|team-crests)--[0-9a-f-]+\.(?:jpg|png|webp)$/;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

export class LocalObjectStorage implements ObjectStorage {
  private readonly publicBaseUrl: string;

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

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async read(key: string): Promise<ReadableStoredObject | null> {
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

  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error('Invalid storage key');
    return join(this.directory, key);
  }
}

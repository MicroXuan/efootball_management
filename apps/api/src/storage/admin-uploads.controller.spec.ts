import { GUARDS_METADATA } from '@nestjs/common/constants';
import { jest } from '@jest/globals';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { validateEnvironment } from '../config/env.schema.js';
import { AdminUploadsController } from './admin-uploads.controller.js';
import { CloudBaseObjectStorage, type CloudBaseStorageClient } from './cloudbase-object-storage.js';
import { LocalObjectStorage } from './local-object-storage.js';
import type { ObjectStorage } from './object-storage.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('league image storage', () => {
  it('protects the upload controller with administrator authentication', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminUploadsController) as unknown[];
    expect(guards).toContain(AdminAuthGuard);
  });

  it('uploads a validated image through the provider boundary', async () => {
    const put = jest.fn(async () => ({
        key: 'league-images--opaque.png',
        url: 'http://127.0.0.1:3000/v1/media/league-images--opaque.png',
        mimeType: 'image/png' as const,
        size: png.length
      }));
    const storage: ObjectStorage = {
      put,
      delete: jest.fn(async () => undefined)
    };
    const controller = new AdminUploadsController(storage);

    await expect(controller.uploadLeagueImage({
      buffer: png,
      originalname: 'logo.png',
      mimetype: 'image/png',
      size: png.length
    })).resolves.toMatchObject({ key: 'league-images--opaque.png', mimeType: 'image/png' });
    expect(put).toHaveBeenCalledWith('league-images', expect.objectContaining({ extension: 'png' }));
  });

  it('stores local objects behind a stable public media URL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'efm-storage-'));
    try {
      const storage = new LocalObjectStorage(directory, 'http://127.0.0.1:3000');
      const stored = await storage.put('league-images', {
        buffer: png,
        mimeType: 'image/png',
        extension: 'png',
        size: png.length
      });

      expect(stored.url).toBe(`http://127.0.0.1:3000/v1/media/${stored.key}`);
      expect(await readFile(join(directory, stored.key))).toEqual(png);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires CloudBase credentials only when that provider is selected', () => {
    const base = {
      DATABASE_URL: 'mysql://root:password@127.0.0.1:3306/efm',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      REFRESH_TOKEN_PEPPER: 'b'.repeat(32),
      WECHAT_APP_ID: 'app',
      WECHAT_APP_SECRET: 'secret'
    };

    expect(validateEnvironment({ ...base, STORAGE_PROVIDER: 'local' }).STORAGE_PROVIDER).toBe('local');
    expect(() => validateEnvironment({ ...base, STORAGE_PROVIDER: 'cloudbase' })).toThrow();
  });

  it('maps opaque keys and public URLs through a mocked CloudBase client', async () => {
    const uploadFile = jest.fn(async () => ({ fileID: 'cloud://env/league-images--opaque.webp' }));
    const client: CloudBaseStorageClient = {
      uploadFile,
      deleteFile: jest.fn(async () => undefined),
      downloadFile: jest.fn(async () => ({ fileContent: undefined }))
    };
    const storage = new CloudBaseObjectStorage(client, 'https://api.example.test');

    const stored = await storage.put('league-images', {
      buffer: Buffer.from('RIFF0000WEBP'),
      mimeType: 'image/webp',
      extension: 'webp',
      size: 12
    });

    expect(stored.key).toBe('cloud://env/league-images--opaque.webp');
    expect(stored.url).toBe('cloud://env/league-images--opaque.webp');
    expect(uploadFile).toHaveBeenCalledWith({
      cloudPath: expect.stringMatching(/^league-images--[0-9a-f-]+\.webp$/),
      fileContent: expect.any(Buffer)
    });
  });
});

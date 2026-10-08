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
const pngWithDimensions = (width: number, height: number) => {
  const buffer = Buffer.alloc(24);
  png.copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

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

  it('stores the league center banner in its own cache-busting image scope', async () => {
    const put = jest.fn(async () => ({
      key: 'league-center-banners--opaque.png',
      url: 'https://media.example.com/league-center-banners--opaque.png',
      mimeType: 'image/png' as const,
      size: png.length,
    }));
    const storage: ObjectStorage = {
      put,
      delete: jest.fn(async () => undefined),
    };
    const controller = new AdminUploadsController(storage);

    await controller.uploadLeagueCenterBanner({
      buffer: png,
      originalname: 'banner.png',
      mimetype: 'image/png',
      size: png.length,
    });

    expect(put).toHaveBeenCalledWith(
      'league-center-banners',
      expect.objectContaining({ extension: 'png' }),
    );
  });

  it('uploads a dimension-checked team crest in its own storage scope', async () => {
    const crest = pngWithDimensions(256, 256);
    const put = jest.fn(async () => ({
      key: 'team-crests--opaque.png',
      url: 'https://media.example.com/team-crests--opaque.png',
      mimeType: 'image/png' as const,
      size: crest.length
    }));
    const storage: ObjectStorage = { put, delete: jest.fn(async () => undefined) };
    const controller = new AdminUploadsController(storage);

    await controller.uploadTeamCrest({ buffer: crest, originalname: 'ajax.png', mimetype: 'image/png', size: crest.length });

    expect(put).toHaveBeenCalledWith('team-crests', expect.objectContaining({ extension: 'png' }));
    expect(() => controller.uploadTeamCrest({
      buffer: pngWithDimensions(5000, 256),
      originalname: 'oversized.png',
      mimetype: 'image/png',
      size: 24
    })).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'INVALID_TEAM_CREST' }) }));
    expect(() => controller.uploadTeamCrest({
      buffer: Buffer.from('<html>not an image</html>'),
      originalname: 'fake.png',
      mimetype: 'image/png',
      size: 25
    })).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'INVALID_TEAM_CREST' }) }));
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

  it('serves locally uploaded league center banners through the public media endpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'efm-banner-storage-'));
    try {
      const storage = new LocalObjectStorage(directory, 'http://127.0.0.1:3000');
      const stored = await storage.put('league-center-banners', {
        buffer: png,
        mimeType: 'image/png',
        extension: 'png',
        size: png.length,
      });

      await expect(storage.read(stored.key)).resolves.toMatchObject({
        buffer: png,
        mimeType: 'image/png',
        size: png.length,
      });
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

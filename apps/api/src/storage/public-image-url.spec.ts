import { jest } from '@jest/globals';
import type { ObjectStorage } from './object-storage.js';
import { publicImageUrl } from './public-image-url.js';

describe('publicImageUrl', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('refreshes a CloudBase signed URL before its ten-minute expiry', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-17T12:00:00.000Z'));
    const temporaryReadUrl = jest.fn<() => Promise<string>>()
      .mockResolvedValueOnce('https://temporary.example/logo-1.png')
      .mockResolvedValueOnce('https://temporary.example/logo-2.png');
    const storage: ObjectStorage = {
      temporaryReadUrl,
      put: jest.fn(async () => { throw new Error('not used'); }),
      delete: jest.fn(async () => undefined),
    };
    const fileId = 'cloud://env/league-images--logo.png';

    await expect(publicImageUrl(storage, fileId)).resolves.toBe('https://temporary.example/logo-1.png');
    jest.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);
    await expect(publicImageUrl(storage, fileId)).resolves.toBe('https://temporary.example/logo-1.png');
    expect(temporaryReadUrl).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000 + 1);
    await expect(publicImageUrl(storage, fileId)).resolves.toBe('https://temporary.example/logo-2.png');
    expect(temporaryReadUrl).toHaveBeenCalledTimes(2);
    expect(temporaryReadUrl).toHaveBeenNthCalledWith(1, fileId, 600);
    expect(temporaryReadUrl).toHaveBeenNthCalledWith(2, fileId, 600);
  });

  it('coalesces concurrent requests for the same CloudBase file', async () => {
    let resolveUrl!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { resolveUrl = resolve; });
    const temporaryReadUrl = jest.fn(() => pending);
    const storage: ObjectStorage = {
      temporaryReadUrl,
      put: jest.fn(async () => { throw new Error('not used'); }),
      delete: jest.fn(async () => undefined),
    };
    const fileId = 'cloud://env/league-center-banners--banner.webp';

    const first = publicImageUrl(storage, fileId);
    const second = publicImageUrl(storage, fileId);
    expect(temporaryReadUrl).toHaveBeenCalledTimes(1);

    resolveUrl('https://temporary.example/banner.webp');
    await expect(Promise.all([first, second])).resolves.toEqual([
      'https://temporary.example/banner.webp',
      'https://temporary.example/banner.webp',
    ]);
  });
});

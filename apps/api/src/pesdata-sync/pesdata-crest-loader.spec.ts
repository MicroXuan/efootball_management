import type { TeamCatalogCandidate } from '@efm/contracts';
import { jest } from '@jest/globals';
import type { ObjectStorage, StoredObject, StoredUploadInput } from '../storage/object-storage.js';
import { PesdataCrestLoader } from './pesdata-crest-loader.js';

function png(width = 16, height = 16) {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const candidate: TeamCatalogCandidate = {
  sourceExternalId: '42', sourceLeagueExternalId: null, sourceLeagueName: null,
  nameZh: '阿贾克斯', nameEn: 'Ajax', nameJa: null, shortName: 'AJA',
  remoteLogoUrl: 'https://images.pesdata.example/ajax.png', storedLogoUrl: null, sourceUpdatedAt: null
};

class StorageSpy implements ObjectStorage {
  named: Array<{ scope: string; name: string; file: StoredUploadInput }> = [];
  put(): Promise<StoredObject> { throw new Error('random put must not be used'); }
  delete(): Promise<void> { return Promise.resolve(); }
  putNamed(scope: 'team-crests', name: string, file: StoredUploadInput): Promise<StoredObject> {
    this.named.push({ scope, name, file });
    return Promise.resolve({ key: `${scope}--${name}.${file.extension}`, url: `https://assets.example/${name}.${file.extension}`, mimeType: file.mimeType, size: file.size });
  }
}

describe('PesdataCrestLoader', () => {
  it('stores a valid image with a deterministic content hash and reuses that hash', async () => {
    const storage = new StorageSpy();
    const fetcher = jest.fn(async () => new Response(png(), { status: 200, headers: { 'content-type': 'image/png' } }));
    const loader = new PesdataCrestLoader(storage, fetcher as typeof fetch);

    const first = await loader.load(candidate);
    const second = await loader.load(candidate);
    expect(first).toEqual(second);
    expect(first.logoChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(storage.named[0]?.name).toBe(first.logoChecksum);
    expect(storage.named).toHaveLength(2);
  });

  it.each([
    ['HTML disguised as an image', async () => new Response('<html>no</html>', { headers: { 'content-type': 'image/png' } })],
    ['oversized body', async () => new Response(Buffer.alloc(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })],
    ['unsupported signature', async () => new Response(Buffer.from('GIF89a'), { headers: { 'content-type': 'image/gif' } })],
    ['non-HTTPS redirect', async () => new Response(null, { status: 302, headers: { location: 'http://images.example/crest.png' } })]
  ])('rejects %s without writing storage', async (_label, response) => {
    const storage = new StorageSpy();
    const loader = new PesdataCrestLoader(storage, jest.fn(response) as typeof fetch);
    await expect(loader.load(candidate)).rejects.toMatchObject({ code: 'PESDATA_CREST_INVALID' });
    expect(storage.named).toHaveLength(0);
  });

  it('rejects redirect loops before writing storage', async () => {
    const storage = new StorageSpy();
    const fetcher = jest.fn(async () => new Response(null, { status: 302, headers: { location: '/loop' } }));
    const loader = new PesdataCrestLoader(storage, fetcher as typeof fetch);
    await expect(loader.load({ ...candidate, remoteLogoUrl: 'https://images.example/loop' })).rejects.toMatchObject({ code: 'PESDATA_CREST_INVALID' });
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(storage.named).toHaveLength(0);
  });
});

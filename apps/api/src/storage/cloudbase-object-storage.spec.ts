import { jest } from '@jest/globals';
import { CloudBaseObjectStorage, type CloudBaseStorageClient } from './cloudbase-object-storage.js';

const key = 'cloud://env/match-result-evidence--proof.png';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('CloudBase private evidence inspection', () => {
  it('rejects failed or unacknowledged deletes instead of allowing retention to erase its metadata', async () => {
    const deleteFile = jest.fn<CloudBaseStorageClient['deleteFile']>();
    const provider = new CloudBaseObjectStorage({ deleteFile } as never);
    for (const response of [{ code: 'ACCESS_DENIED' }, { fileList: [{ fileID: key, code: 'FAILED' }] }, undefined]) {
      deleteFile.mockResolvedValueOnce(response);
      await expect(provider.delete(key)).rejects.toThrow();
    }
    deleteFile.mockResolvedValueOnce({ fileList: [{ fileID: key, code: 'SUCCESS' }] });
    await expect(provider.delete(key)).resolves.toBeUndefined();
  });
  const downloadFile = jest.fn(async () => ({ fileContent: png }));
  const client: CloudBaseStorageClient = {
    uploadFile: jest.fn(async () => ({ fileID: key })),
    deleteFile: jest.fn(async () => undefined),
    downloadFile,
    getFileInfo: jest.fn(async () => ({ fileList: [{ code: 'SUCCESS', fileID: key, mime: 'image/png', size: png.length }] }))
  };
  const storage = new CloudBaseObjectStorage(client);

  afterEach(() => downloadFile.mockResolvedValue({ fileContent: png }));

  it('reports type and size only after checking downloaded image bytes', async () => {
    await expect(storage.inspect(key)).resolves.toEqual({ mimeType: 'image/png', size: png.length,
      checksumSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6' });
    expect(downloadFile).toHaveBeenCalledWith({ fileID: key });
  });

  it('rejects non-image bytes even when HEAD says image/png', async () => {
    downloadFile.mockResolvedValueOnce({ fileContent: Buffer.from('evilcode') });
    await expect(storage.inspect(key)).rejects.toMatchObject({ response: { code: 'INVALID_RESULT_EVIDENCE' } });
  });
});

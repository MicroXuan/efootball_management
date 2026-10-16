import { jest } from '@jest/globals';
import { CloudBaseObjectStorage, type CloudBaseStorageClient } from './cloudbase-object-storage.js';

const key = 'cloud://env/match-result-evidence--proof.png';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('CloudBase private evidence inspection', () => {
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
    await expect(storage.inspect(key)).resolves.toEqual({ mimeType: 'image/png', size: png.length });
    expect(downloadFile).toHaveBeenCalledWith({ fileID: key });
  });

  it('rejects non-image bytes even when HEAD says image/png', async () => {
    downloadFile.mockResolvedValueOnce({ fileContent: Buffer.from('evilcode') });
    await expect(storage.inspect(key)).rejects.toMatchObject({ response: { code: 'INVALID_RESULT_EVIDENCE' } });
  });
});

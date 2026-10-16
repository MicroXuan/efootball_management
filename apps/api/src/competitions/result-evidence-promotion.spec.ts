import { jest } from '@jest/globals';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalObjectStorage } from '../storage/local-object-storage.js';
import { CloudBaseObjectStorage, type CloudBaseStorageClient } from '../storage/cloudbase-object-storage.js';
import type { ObjectStorage, StoredObjectMetadata } from '../storage/object-storage.js';
import { ResultEvidenceStorageService } from './result-evidence-storage.service.js';
import { disputeFixture } from '../../test/helpers/match-result-disputes.js';
import { randomUUID } from 'node:crypto';
import { ResultEvidenceRetentionWorker } from './result-evidence-retention.worker.js';

const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const checksumSha256 = '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6';
const temporaryKey = 'match-result-evidence-temp--proof.png';
const retainedKey = 'match-result-evidence-retained--proof.png';
type Inspected = StoredObjectMetadata & { buffer: Buffer };
type Promoting = ObjectStorage & { promoteEvidence(key: string, object: Inspected): Promise<string> };
const inspected = () => ({ mimeType: 'image/png', size: 8, checksumSha256, buffer: Buffer.from(bytes) });

function completionFixture() {
  const upload = { id: 'upload', matchId: 'match', uploadedByUserId: 'user', objectKey: temporaryKey,
    mimeType: 'image/png', byteSize: 8, checksumSha256, status: 'PENDING', expiresAt: new Date(Date.now() + 600000) };
  const updateMany = jest.fn(async (args: { data: object }) => { Object.assign(upload, args.data); return { count: 1 }; });
  const tx = { $queryRaw: jest.fn(async () => []), matchResultEvidenceUpload: {
    findUnique: jest.fn(async () => ({ ...upload })), updateMany
  } };
  const prisma = { ...tx, $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    competitionMatch: { findUnique: async () => ({ id: 'match', version: 1,
      stage: { status: 'PUBLISHED', competition: { status: 'IN_PROGRESS', season: null } },
      homeParticipant: { individualUserId: 'user' }, awayParticipant: { individualUserId: 'opponent' }
    }) }
  };
  const storage = { inspect: jest.fn(async () => inspected()),
    promoteEvidence: jest.fn(async () => retainedKey), delete: jest.fn(async () => undefined) };
  const service = new ResultEvidenceStorageService(prisma as never, storage as never);
  const complete = () => service.completeUserUpload('user', 'match', 'upload', { expectedVersion: 1 });
  return { upload, updateMany, storage, complete };
}

describe('retained evidence promotion', () => {
  it('persists only the retained key and makes a completed retry idempotent', async () => {
    const { upload, storage, complete } = completionFixture();
    await complete();
    expect(upload).toMatchObject({ status: 'UPLOADED', objectKey: retainedKey });
    await complete();
    expect(storage.promoteEvidence).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(temporaryKey);
  });

  it('keeps failed promotion pending and retries the same deterministic destination', async () => {
    const { upload, storage, complete } = completionFixture();
    storage.promoteEvidence.mockRejectedValueOnce(new Error('copy failed'));
    await expect(complete()).rejects.toThrow('copy failed');
    expect(upload).toMatchObject({ status: 'PENDING', objectKey: temporaryKey });
    await complete();
    expect(upload.objectKey).toBe(retainedKey);
  });

  it('keeps the temporary reference after a failed CAS so promotion can retry or be collected', async () => {
    const { upload, storage, updateMany, complete } = completionFixture();
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(complete()).rejects.toThrow();
    expect(upload).toMatchObject({ status: 'PENDING', objectKey: temporaryKey });
    expect(storage.delete).not.toHaveBeenCalled();
    await complete();
    expect(storage.promoteEvidence).toHaveBeenNthCalledWith(1, temporaryKey, expect.objectContaining({ buffer: bytes }));
    expect(storage.promoteEvidence).toHaveBeenNthCalledWith(2, temporaryKey, expect.objectContaining({ buffer: bytes }));
    expect(upload.objectKey).toBe(retainedKey);
  });

  it('rejects missing checksum even when MIME and size match', async () => {
    const { upload, storage, complete } = completionFixture();
    storage.inspect.mockResolvedValueOnce({ ...inspected(), checksumSha256: undefined } as never);
    await expect(complete()).rejects.toMatchObject({ response: { code: 'INVALID_RESULT_EVIDENCE' } });
    expect(upload.status).toBe('PENDING');
    expect(storage.promoteEvidence).not.toHaveBeenCalled();
  });

  it('refuses a provider that returns the temporary source as the promoted key', async () => {
    const { upload, storage, complete } = completionFixture();
    storage.promoteEvidence.mockResolvedValueOnce(temporaryKey);
    await expect(complete()).rejects.toThrow();
    expect(upload).toMatchObject({ status: 'PENDING', objectKey: temporaryKey });
  });

  it('promotes local verified bytes to a separate private namespace and safely retries a write failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'efm-promotion-'));
    try {
      const provider = new LocalObjectStorage(directory, 'http://localhost:3000') as Promoting;
      const grant = await provider.createDirectUpload!('match-result-evidence', 'proof', 'image/png');
      expect(grant.key).toBe(temporaryKey);
      await provider.writePrivate!(grant.key, bytes, 'image/png');
      const object = await provider.inspect!(grant.key) as Inspected;
      // Simulate an unusable destination; a retry after storage repair must work.
      await mkdir(join(directory, retainedKey));
      await expect(provider.promoteEvidence(grant.key, object)).rejects.toThrow();
      await rm(join(directory, retainedKey), { recursive: true });
      expect(await provider.promoteEvidence(grant.key, object)).toBe(retainedKey);
      expect(await provider.promoteEvidence(grant.key, object)).toBe(retainedKey);
      expect(await provider.read!(retainedKey)).toBeNull();
      expect((await provider.readPrivate!(retainedKey))?.buffer).toEqual(bytes);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('promotes exactly the CloudBase bytes already inspected without a second download', async () => {
    const key = `cloud://env/${temporaryKey}`;
    const client = {
      uploadFile: jest.fn(async () => ({ fileID: `cloud://env/${retainedKey}` })),
      deleteFile: jest.fn(async () => ({ fileList: [{ fileID: key, code: 'SUCCESS' }] })),
      downloadFile: jest.fn(async () => ({ fileContent: Buffer.from(bytes) })),
      getFileInfo: jest.fn(async () => ({ fileList: [{ fileID: key, code: 'SUCCESS', mime: 'image/png', size: 8 }] })),
      getUploadMetadata: jest.fn(async () => ({ data: { fileId: key, url: 'https://cos.test/put', authorization: 'signed', token: 'token', cosFileId: 'cos', download_url: '' } }))
    } satisfies CloudBaseStorageClient;
    const provider = new CloudBaseObjectStorage(client) as Promoting;
    const grant = await provider.createDirectUpload!('match-result-evidence', 'proof', 'image/png');
    expect(client.getUploadMetadata).toHaveBeenCalledWith({ cloudPath: temporaryKey });
    const object = await provider.inspect!(grant.key) as Inspected;
    client.downloadFile.mockResolvedValue({ fileContent: Buffer.alloc(1_048_577) });
    client.uploadFile.mockRejectedValueOnce(new Error('copy failed'));
    await expect(provider.promoteEvidence(grant.key, object)).rejects.toThrow('copy failed');
    expect(await provider.promoteEvidence(grant.key, object)).toBe(`cloud://env/${retainedKey}`);
    expect(client.uploadFile).toHaveBeenLastCalledWith({ cloudPath: retainedKey, fileContent: bytes });
    expect(client.downloadFile).toHaveBeenCalledTimes(1);
  });
});

describe('participant retained evidence integration', () => {
  const { prisma, users, rejected, disputes } = disputeFixture();
  // Restrict cleanup scans to this fixture's records in the shared test database.
  const ownedMatches = { match: { stage: { competition: { createdById: { in: users } } } } };
  const scopedPrisma = prisma.$extends({ query: {
    matchResultEvidence: { findMany: ({ args, query }) => query({ ...args,
      where: { AND: [args.where ?? {}, ownedMatches] } }) },
    matchResultEvidenceUpload: { findMany: ({ args, query }) => query({ ...args,
      where: { AND: [args.where ?? {}, ownedMatches] } }) }
  } });

  async function consumedWithSource(provider: LocalObjectStorage, legacy: boolean) {
    const { match } = await rejected();
    const service = new ResultEvidenceStorageService(prisma, provider);
    const grant = await service.createUserUpload(users[0]!, match.id, {
      role: 'SUBMITTER', mimeType: 'image/png', byteSize: 8, checksumSha256, expectedVersion: 3
    });
    const source = legacy ? grant.objectKey.replace('-temp--', '--') : grant.objectKey;
    if (legacy) await prisma.matchResultEvidenceUpload.update({ where: { id: grant.id }, data: { objectKey: source } });
    await service.writeLocalObject(users[0]!, source, bytes, 'image/png');
    const deletion = jest.spyOn(provider, 'delete').mockRejectedValueOnce(new Error('source delete down'));
    await service.completeUserUpload(users[0]!, match.id, grant.id, { expectedVersion: 3 });
    await disputes.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: grant.id }, randomUUID());
    await prisma.matchResultEvidenceUpload.update({ where: { id: grant.id }, data: { createdAt: new Date(0), expiresAt: new Date(0) } });
    const evidence = await prisma.matchResultEvidence.findUniqueOrThrow({ where: { uploadId: grant.id } });
    expect((await provider.readPrivate(source))?.buffer).toEqual(bytes);
    expect(evidence).toMatchObject({ status: 'ACTIVE', deletedAt: null });
    return { match, grant, source, evidence, deletion };
  }

  it.each([false, true])('retries failed source deletion after formal consumption (legacy=%s) without touching retained evidence', async (legacy) => {
    const directory = await mkdtemp(join(tmpdir(), 'efm-consumed-source-'));
    try {
      const provider = new LocalObjectStorage(directory, 'http://localhost:3000');
      const { source, evidence, deletion } = await consumedWithSource(provider, legacy);
      const worker = new ResultEvidenceRetentionWorker(scopedPrisma as never, provider);
      // A worker failure must also remain retryable on a later run.
      deletion.mockImplementationOnce(async (key) => {
        if (key === source) throw new Error('source still unavailable');
        return LocalObjectStorage.prototype.delete.call(provider, key);
      });
      if (legacy) deletion.mockRejectedValueOnce(new Error('legacy source still unavailable'));
      await worker.cleanup();
      expect((await provider.readPrivate(source))?.buffer).toEqual(bytes);
      await worker.cleanup();
      expect(await provider.readPrivate(source)).toBeNull();
      await worker.cleanup();
      expect(await provider.readPrivate(source)).toBeNull();
      expect((await provider.readPrivate(evidence.objectKey))?.buffer).toEqual(bytes);
      expect(deletion).not.toHaveBeenCalledWith(evidence.objectKey);
      expect(await prisma.matchResultEvidence.findUnique({ where: { id: evidence.id } }))
        .toMatchObject({ status: 'ACTIVE', deletedAt: null });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(['evidence', 'upload'] as const)('preserves a source sibling referenced by another %s', async (reference) => {
    const directory = await mkdtemp(join(tmpdir(), 'efm-source-reference-'));
    try {
      const provider = new LocalObjectStorage(directory, 'http://localhost:3000');
      const { source, evidence, deletion } = await consumedWithSource(provider, false);
      const other = await rejected();
      const data = { matchId: other.match.id, role: 'SUBMITTER' as const, uploadedByUserId: users[0]!,
        objectKey: source, mimeType: 'image/png', byteSize: 8, checksumSha256 };
      const collision = reference === 'evidence'
        ? await prisma.matchResultEvidence.create({ data })
        : await prisma.matchResultEvidenceUpload.create({ data: { ...data, expiresAt: new Date(Date.now() + 600000) } });
      const worker = new ResultEvidenceRetentionWorker(scopedPrisma as never, provider);
      deletion.mockClear();
      await worker.cleanup();
      expect((await provider.readPrivate(source))?.buffer).toEqual(bytes);
      expect(deletion).not.toHaveBeenCalledWith(source);
      expect(deletion).not.toHaveBeenCalledWith(evidence.objectKey);
      // Removing only this test-owned reference makes the next daily pass eligible.
      if (reference === 'evidence') await prisma.matchResultEvidence.delete({ where: { id: collision.id } });
      else await prisma.matchResultEvidenceUpload.delete({ where: { id: collision.id } });
      await worker.cleanup();
      expect(await provider.readPrivate(source)).toBeNull();
      expect((await provider.readPrivate(evidence.objectKey))?.buffer).toEqual(bytes);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('attaches only the retained private object and survives removal of the temporary namespace', async () => {
    const { match } = await rejected();
    const directory = await mkdtemp(join(tmpdir(), 'efm-user-promotion-'));
    try {
      const provider = new LocalObjectStorage(directory, 'http://localhost:3000');
      const service = new ResultEvidenceStorageService(prisma, provider);
      const grant = await service.createUserUpload(users[0]!, match.id, {
        role: 'SUBMITTER', mimeType: 'image/png', byteSize: 8, checksumSha256, expectedVersion: 3
      });
      await service.writeLocalObject(users[0]!, grant.objectKey, bytes, 'image/png');
      await service.completeUserUpload(users[0]!, match.id, grant.id, { expectedVersion: 3 });
      await disputes.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: grant.id }, randomUUID());
      const evidence = await prisma.matchResultEvidence.findUniqueOrThrow({ where: { uploadId: grant.id } });
      expect(grant.objectKey).toMatch(/^match-result-evidence-temp--/);
      expect(evidence.objectKey).toMatch(/^match-result-evidence-retained--/);
      await provider.delete(grant.objectKey);
      expect((await provider.readPrivate(evidence.objectKey))?.buffer).toEqual(bytes);
      expect(await provider.read(evidence.objectKey)).toBeNull();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

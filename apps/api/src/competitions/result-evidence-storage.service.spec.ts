import { jest } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudBaseObjectStorage, type CloudBaseStorageClient } from '../storage/cloudbase-object-storage.js';
import { LocalObjectStorage } from '../storage/local-object-storage.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { ResultEvidenceStorageService } from './result-evidence-storage.service.js';

const matchId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const otherMatchId = '33333333-3333-4333-8333-333333333333';
const uploadId = '44444444-4444-4444-8444-444444444444';
const pngChecksum = '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6';
const input = { role: 'SUBMITTER' as const, mimeType: 'image/png' as const, byteSize: 8, checksumSha256: 'a'.repeat(64), expectedVersion: 1 };

function fixture(options: { archived?: boolean; deleted?: boolean; stageStatus?: string; competitionStatus?: string;
  matchStatus?: string; deadline?: Date | null; dispute?: { status: string; evidenceDeadlineAt: Date } | null;
  proposalSubmitterId?: string } = {}) {
  const match = {
    id: matchId, version: 1, status: options.matchStatus ?? 'AWAITING_RESULT',
    resultConfirmationDeadlineAt: options.deadline ?? null,
    stage: {
      status: options.stageStatus ?? 'PUBLISHED',
      competition: {
        status: options.competitionStatus ?? 'IN_PROGRESS',
        season: options.deleted ? { league: { isDeleted: true } } : null
      }
    },
    homeParticipant: { individualUserId: userId, seasonEntry: options.archived ? { ownerUserId: userId, leagueTeam: { status: 'ARCHIVED' } } : null },
    awayParticipant: { individualUserId: 'someone-else', seasonEntry: null }
  };
  const upload = { id: uploadId, matchId, uploadedByUserId: userId, objectKey: 'match-result-evidence--object.png', mimeType: 'image/png', byteSize: 8, checksumSha256: 'a'.repeat(64), status: 'PENDING', expiresAt: new Date(Date.now() + 600_000) };
  const prisma = {
    $queryRaw: jest.fn(async () => []),
    competitionMatch: { findUnique: jest.fn(async () => match) },
    matchResultEvidenceUpload: {
      create: jest.fn(async () => upload),
      findUnique: jest.fn(async () => upload),
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    matchResultEvidence: { create: jest.fn(async () => undefined), findUnique: jest.fn(async () => null) },
    matchResultDispute: { findUnique: jest.fn(async () => options.dispute ? {
      ...options.dispute, triggerResultVersion: { submittedById: options.proposalSubmitterId ?? userId }
    } : null) },
    matchResultVersion: { findFirst: jest.fn(async () => ({ submittedById: options.proposalSubmitterId ?? userId })) }
  };
  const storage: ObjectStorage = {
    put: jest.fn(async () => { throw new Error('unexpected'); }),
    delete: jest.fn(async () => undefined),
    createDirectUpload: jest.fn(async () => ({ key: upload.objectKey, uploadUrl: 'https://private.example/put', headers: { authorization: 'signed' } })),
    inspect: jest.fn(async () => ({ mimeType: 'image/png', size: 8, checksumSha256: 'a'.repeat(64),
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) })),
    promoteEvidence: jest.fn(async () => 'match-result-evidence-retained--object.png'),
    temporaryReadUrl: jest.fn(async () => 'https://private.example/read')
  };
  const transactional = Object.assign(prisma, {
    $transaction: async (callback: (client: typeof prisma) => Promise<unknown>) => callback(prisma)
  });
  return { match, upload, prisma: transactional, storage, service: new ResultEvidenceStorageService(transactional as never, storage) };
}

describe('private evidence providers', () => {
  it('maps CloudBase direct PUT metadata and ten minute reads', async () => {
    const getUploadMetadata = jest.fn(async () => ({ data: { url: 'https://cos.example/put', token: 'token', authorization: 'signature', fileId: 'cloud://env/private-file', cosFileId: 'cos-id', download_url: 'https://public.example/never-use' } }));
    const getTempFileURL = jest.fn(async () => ({ fileList: [{ code: 'SUCCESS', fileID: 'cloud://env/private-file', tempFileURL: 'https://cos.example/read' }] }));
    const client = { uploadFile: jest.fn(async () => ({ fileID: 'unused' })), deleteFile: jest.fn(async () => undefined), downloadFile: jest.fn(async () => ({ fileContent: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) })), getUploadMetadata, getTempFileURL, getFileInfo: jest.fn(async () => ({ fileList: [{ code: 'SUCCESS', fileID: 'cloud://env/private-file', tempFileURL: '', contentType: 'image/png', size: 8 }] })) } satisfies CloudBaseStorageClient;
    const storage = new CloudBaseObjectStorage(client);
    await expect(storage.createDirectUpload('match-result-evidence', 'object', 'image/png')).resolves.toEqual({
      key: 'cloud://env/private-file', uploadUrl: 'https://cos.example/put',
      headers: expect.objectContaining({ authorization: 'signature', 'x-cos-security-token': 'token', 'x-cos-meta-fileid': 'cos-id' })
    });
    expect(getUploadMetadata).toHaveBeenCalledWith({ cloudPath: 'match-result-evidence-temp--object.png' });
    await expect(storage.temporaryReadUrl('cloud://env/private-file', 600)).resolves.toBe('https://cos.example/read');
    expect(getTempFileURL).toHaveBeenCalledWith({ fileList: [{ fileID: 'cloud://env/private-file', maxAge: 600 }] });
    await expect(storage.inspect('cloud://env/private-file')).resolves.toMatchObject({ mimeType: 'image/png', size: 8, checksumSha256: pngChecksum });
    expect(client.downloadFile).toHaveBeenCalledWith({ fileID: 'cloud://env/private-file' });
  });

  it('rejects CloudBase bytes disguised by an image Content-Type before completion', async () => {
    const bytes = Buffer.from('evilcode');
    const client: CloudBaseStorageClient = {
      uploadFile: jest.fn(async () => ({ fileID: 'unused' })),
      deleteFile: jest.fn(async () => undefined),
      downloadFile: jest.fn(async () => ({ fileContent: bytes })),
      getFileInfo: jest.fn(async () => ({ fileList: [{ code: 'SUCCESS', fileID: 'match-result-evidence--object.png', contentType: 'image/png', size: bytes.length }] }))
    };
    const { prisma } = fixture();
    const storage = new CloudBaseObjectStorage(client);
    await expect(storage.inspect('match-result-evidence--object.png'))
      .rejects.toMatchObject({ response: { code: 'INVALID_RESULT_EVIDENCE' } });
    const actualService = new ResultEvidenceStorageService(prisma as never, storage);
    await expect(actualService.completeUserUpload(userId, matchId, uploadId, { expectedVersion: 1 }))
      .rejects.toMatchObject({ response: { code: 'INVALID_RESULT_EVIDENCE' } });
    expect(prisma.matchResultEvidenceUpload.updateMany).not.toHaveBeenCalled();
  });

  it('returns an authenticated API route for local direct upload', async () => {
    const storage = new LocalObjectStorage('/tmp/unused', 'http://127.0.0.1:3000');
    await expect(storage.createDirectUpload('match-result-evidence', 'object', 'image/png')).resolves.toEqual({
      key: 'match-result-evidence-temp--object.png',
      uploadUrl: 'http://127.0.0.1:3000/v1/result-evidence/objects/match-result-evidence-temp--object.png',
      headers: { 'content-type': 'image/png' }
    });
  });

  it('does not expose a locally uploaded private object through public media reads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'efm-private-evidence-'));
    try {
      const storage = new LocalObjectStorage(directory, 'http://127.0.0.1:3000');
      const grant = await storage.createDirectUpload('match-result-evidence', 'object', 'image/png');
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await storage.writePrivate(grant.key, bytes, 'image/png');
      await expect(storage.read(grant.key)).resolves.toBeNull();
      await expect(storage.inspect(grant.key)).resolves.toMatchObject({ mimeType: 'image/png', size: 8, checksumSha256: pngChecksum });
      const url = new URL(await storage.temporaryReadUrl(grant.key, 600));
      const expires = url.searchParams.get('expires') ?? '';
      const signature = url.searchParams.get('signature') ?? '';
      expect(storage.verifyPrivateRead(grant.key, expires, signature)).toBe(true);
      expect(storage.verifyPrivateRead(grant.key, String(Number(expires) + 60_000), signature)).toBe(false);
      expect(storage.verifyPrivateRead(grant.key, String(Date.now() - 1), signature)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('ResultEvidenceStorageService', () => {
  it('rejects a different image digest despite matching type and byte count', async () => {
    const { service, prisma, upload } = fixture();
    upload.checksumSha256 = 'b'.repeat(64);
    await expect(service.completeUserUpload(userId, matchId, uploadId, { expectedVersion: 1 }))
      .rejects.toMatchObject({ response: { code: 'INVALID_RESULT_EVIDENCE' } });
    expect(prisma.matchResultEvidenceUpload.updateMany).not.toHaveBeenCalled();
  });

  it('creates a pending session without evidence and uses the private scope', async () => {
    const { service, prisma, storage } = fixture();
    await expect(service.createUserUpload(userId, matchId, input)).resolves.toMatchObject({ id: uploadId, uploadUrl: 'https://private.example/put' });
    expect(storage.createDirectUpload).toHaveBeenCalledWith('match-result-evidence', expect.any(String), 'image/png');
    expect(prisma.matchResultEvidenceUpload.create).toHaveBeenCalledWith({ data: expect.objectContaining({ matchId, uploadedByUserId: userId, status: 'PENDING' }) });
    expect(prisma.matchResultEvidence.create).not.toHaveBeenCalled();
  });

  it('completes only a matching uploaded object after inspection', async () => {
    const { service, prisma, storage } = fixture();
    await service.completeUserUpload(userId, matchId, uploadId, { expectedVersion: 1 });
    expect(storage.inspect).toHaveBeenCalledWith('match-result-evidence--object.png');
    expect(prisma.matchResultEvidenceUpload.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: uploadId, matchId, status: 'PENDING' }), data: expect.objectContaining({ status: 'UPLOADED' }) });
    expect(prisma.matchResultEvidence.create).not.toHaveBeenCalled();
  });

  it('keeps a successful local PUT pending until the completion call', async () => {
    const { service, prisma, storage } = fixture();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    storage.writePrivate = jest.fn(async () => undefined);
    await service.writeLocalObject(userId, 'match-result-evidence--object.png', bytes, 'image/png');
    expect(storage.writePrivate).toHaveBeenCalledWith('match-result-evidence--object.png', bytes, 'image/png');
    expect(prisma.matchResultEvidenceUpload.updateMany).not.toHaveBeenCalled();
    expect(prisma.matchResultEvidence.create).not.toHaveBeenCalled();
  });

  it('rejects cross-match completion and oversized or wrong-type stored objects', async () => {
    const { service, prisma, storage } = fixture();
    await expect(service.completeUserUpload(userId, otherMatchId, uploadId, { expectedVersion: 1 })).rejects.toMatchObject({ response: { code: 'MATCH_NOT_FOUND' } });
    expect(prisma.matchResultEvidenceUpload.updateMany).not.toHaveBeenCalled();
    for (const metadata of [{ mimeType: 'image/png', size: 1_048_577 }, { mimeType: 'application/pdf', size: 8 }]) {
      (storage.inspect as jest.MockedFunction<NonNullable<ObjectStorage['inspect']>>).mockResolvedValueOnce(metadata);
      await expect(service.completeUserUpload(userId, matchId, uploadId, { expectedVersion: 1 })).rejects.toMatchObject({ response: { code: 'INVALID_RESULT_EVIDENCE' } });
    }
    expect(prisma.matchResultEvidenceUpload.updateMany).not.toHaveBeenCalled();
  });

  it('rejects archived teams and soft-deleted leagues', async () => {
    for (const options of [{ archived: true }, { deleted: true }]) {
      const { service } = fixture(options);
      await expect(service.createUserUpload(userId, matchId, input)).rejects.toMatchObject({ response: { code: expect.any(String) } });
    }
  });

  it('issues participant grants only for the role and deadline of a live result action', async () => {
    const pending = fixture({ matchStatus: 'PENDING_CONFIRMATION', deadline: new Date(Date.now() + 60_000) });
    await expect(pending.service.createUserUpload(userId, matchId, input))
      .rejects.toMatchObject({ response: { code: 'MATCH_RESULT_NOT_ALLOWED' } });

    const disputed = fixture({ matchStatus: 'DISPUTED', proposalSubmitterId: 'someone-else', dispute: {
      status: 'EVIDENCE_COLLECTION', evidenceDeadlineAt: new Date(Date.now() + 60_000)
    } });
    await expect(disputed.service.createUserUpload(userId, matchId, input))
      .rejects.toMatchObject({ response: { code: 'EVIDENCE_ROLE_INVALID' } });
    await expect(disputed.service.createUserUpload(userId, matchId, { ...input, role: 'OPPONENT' }))
      .resolves.toMatchObject({ id: uploadId });

    const reviewStarted = fixture({ matchStatus: 'DISPUTED', proposalSubmitterId: userId, dispute: {
      status: 'READY_FOR_REVIEW', evidenceDeadlineAt: new Date(Date.now() + 60_000)
    } });
    await expect(reviewStarted.service.createUserUpload(userId, matchId, input))
      .rejects.toMatchObject({ response: { code: 'MATCH_RESULT_NOT_ALLOWED' } });

    const expired = fixture({ matchStatus: 'DISPUTED', dispute: {
      status: 'EVIDENCE_COLLECTION', evidenceDeadlineAt: new Date(Date.now() - 1)
    } });
    await expect(expired.service.createUserUpload(userId, matchId, input))
      .rejects.toMatchObject({ response: { code: 'EVIDENCE_DEADLINE_EXPIRED' } });
  });

  it.each([
    { options: { stageStatus: 'DRAFT' }, label: 'unpublished stage' },
    { options: { competitionStatus: 'DRAFT' }, label: 'draft competition' },
    { options: { competitionStatus: 'CANCELLED' }, label: 'cancelled competition' }
  ])('blocks create, complete, and read for a $label', async ({ options }) => {
    const { service, prisma } = fixture(options);
    for (const action of [
      () => service.createUserUpload(userId, matchId, input),
      () => service.completeUserUpload(userId, matchId, uploadId, { expectedVersion: 1 }),
      () => service.userReadUrl(userId, matchId, '55555555-5555-4555-8555-555555555555')
    ]) {
      await expect(action()).rejects.toMatchObject({ response: { code: 'MATCH_RESULT_NOT_ALLOWED' } });
    }
    expect(prisma.matchResultEvidenceUpload.create).not.toHaveBeenCalled();
    expect(prisma.matchResultEvidenceUpload.updateMany).not.toHaveBeenCalled();
    expect(prisma.matchResultEvidence.findUnique).not.toHaveBeenCalled();
  });

  it('hides an unpublished match from nonparticipants across create, complete, and read', async () => {
    const outsiderId = '66666666-6666-4666-8666-666666666666';
    const { service, prisma } = fixture({ stageStatus: 'DRAFT' });
    for (const action of [
      () => service.createUserUpload(outsiderId, matchId, input),
      () => service.completeUserUpload(outsiderId, matchId, uploadId, { expectedVersion: 1 }),
      () => service.userReadUrl(outsiderId, matchId, '55555555-5555-4555-8555-555555555555')
    ]) {
      await expect(action()).rejects.toMatchObject({ status: 404, response: { code: 'MATCH_NOT_FOUND' } });
    }
    expect(prisma.matchResultEvidenceUpload.create).not.toHaveBeenCalled();
    expect(prisma.matchResultEvidenceUpload.findUnique).not.toHaveBeenCalled();
    expect(prisma.matchResultEvidence.findUnique).not.toHaveBeenCalled();
  });
});

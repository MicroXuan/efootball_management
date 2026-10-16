import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { disputeFixture } from '../../test/helpers/match-result-disputes.js';
import { ResultEvidenceRetentionWorker } from './result-evidence-retention.worker.js';

describe('evidence retention', () => {
  const { prisma, users, disputes, rejected, fixture, upload } = disputeFixture();
  const storage = { delete: jest.fn(async (_key: string) => {}) };
  const worker = new ResultEvidenceRetentionWorker(prisma, storage as never);
  beforeEach(() => storage.delete.mockClear());
  it('does not delete an orphan session when legacy evidence references its object without an upload relation', async () => {
    const { match } = await fixture();
    const session = await upload(match.id);
    const now = new Date();
    await prisma.matchResultEvidenceUpload.update({ where: { id: session.id }, data: { createdAt: new Date(0), expiresAt: new Date(0) } });
    await prisma.matchResultEvidence.create({ data: { matchId: match.id, role: 'SUBMITTER', uploadedByUserId: users[0]!,
      objectKey: session.objectKey, mimeType: 'image/png', byteSize: 8, checksumSha256: 'a'.repeat(64) } });
    await worker.cleanup(now);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(await prisma.matchResultEvidenceUpload.findUnique({ where: { id: session.id } })).toMatchObject({ status: 'UPLOADED' });
  });
  it('pages confirmed evidence by stable IDs and preserves upload sessions referenced by evidence', async () => {
    const { match, proposal } = await fixture();
    await prisma.matchResultVersion.update({ where: { id: proposal.id }, data: { status: 'OFFICIAL' } });
    await prisma.competitionMatch.update({ where: { id: match.id }, data: { status: 'CONFIRMED', officialResultVersionId: proposal.id } });
    const now = new Date();
    const session = await upload(match.id);
    await prisma.matchResultEvidenceUpload.update({ where: { id: session.id }, data: { status: 'UPLOADED', createdAt: new Date(0), expiresAt: new Date(0) } });
    await prisma.matchResultEvidence.createMany({ data: Array.from({ length: 101 }, (_, index) => ({
      matchId: match.id, resultVersionId: proposal.id, role: 'SUBMITTER' as const, uploadedByUserId: users[0]!,
      objectKey: `retention-${randomUUID()}`, mimeType: 'image/png', byteSize: 8, checksumSha256: 'a'.repeat(64),
      expiresAt: now, ...(index === 0 ? { uploadId: session.id } : {})
    })) });
    await worker.cleanup(new Date(now.getTime() - 1));
    expect(storage.delete).not.toHaveBeenCalled();
    await worker.cleanup(now);
    await worker.cleanup(now);
    expect(storage.delete).toHaveBeenCalledTimes(101);
    expect(await prisma.matchResultEvidence.count({ where: { matchId: match.id, status: 'DELETED' } })).toBe(101);
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'EVIDENCE_DELETED' } })).toBe(101);
    expect(await prisma.matchResultEvidenceUpload.findUnique({ where: { id: session.id } })).toMatchObject({ status: 'UPLOADED' });
  });
  it('never deletes unresolved evidence, then deletes expired resolved evidence exactly once', async () => {
    const { match } = await rejected();
    const image = await upload(match.id);
    await disputes.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: image.id }, randomUUID());
    const expiry = new Date('2027-01-01T00:00:00Z');
    await prisma.matchResultEvidence.update({ where: { uploadId: image.id }, data: { expiresAt: expiry } });
    await worker.cleanup(expiry);
    expect(storage.delete).not.toHaveBeenCalled();
    await prisma.matchResultDispute.update({ where: { activeKey: match.id }, data: { status: 'RESOLVED', activeKey: null } });
    await worker.cleanup(new Date(expiry.getTime() - 1));
    expect(storage.delete).not.toHaveBeenCalled();
    await worker.cleanup(expiry); await worker.cleanup(expiry);
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(await prisma.matchResultEvidence.findUnique({ where: { uploadId: image.id } })).toMatchObject({ status: 'DELETED', deletedAt: expiry });
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'EVIDENCE_DELETED' } })).toBe(1);
  });
  it('keeps failed deletions retryable and deletes only unreferenced 24-hour orphan uploads', async () => {
    const { match } = await rejected();
    const image = await upload(match.id);
    await disputes.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: image.id }, randomUUID());
    await prisma.matchResultEvidence.update({ where: { uploadId: image.id }, data: { status: 'PENDING_DELETE', expiresAt: new Date(0) } });
    await prisma.matchResultDispute.update({ where: { activeKey: match.id }, data: { status: 'RESOLVED', activeKey: null } });
    storage.delete.mockRejectedValueOnce(new Error('storage down'));
    const now = new Date();
    await worker.cleanup(now);
    expect(await prisma.matchResultEvidence.findUnique({ where: { uploadId: image.id } })).toMatchObject({ status: 'PENDING_DELETE', deletedAt: null });
    const orphan = await upload(match.id);
    await prisma.matchResultEvidenceUpload.update({ where: { id: orphan.id }, data: { createdAt: new Date(now.getTime() - 86_400_001), expiresAt: new Date(0) } });
    await worker.cleanup(now);
    expect(await prisma.matchResultEvidenceUpload.findUnique({ where: { id: orphan.id } })).toMatchObject({ status: 'EXPIRED' });
    expect(await prisma.matchResultEvidenceUpload.findUnique({ where: { id: image.id } })).toMatchObject({ status: 'CONSUMED' });
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'EVIDENCE_DELETED' } })).toBe(1);
  });
});

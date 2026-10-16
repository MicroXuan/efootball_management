import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { disputeFixture } from '../../test/helpers/match-result-disputes.js';
import { ResultEvidenceRetentionWorker } from './result-evidence-retention.worker.js';

describe('evidence retention', () => {
  const { prisma, users, disputes, rejected, fixture, upload } = disputeFixture();
  const storage = { delete: jest.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined) };
  // Worker scans must never expire another test's or a developer's evidence in the shared DB.
  const ownedMatches = { match: { stage: { competition: { createdById: { in: users } } } } };
  const scopedPrisma = prisma.$extends({ query: {
    matchResultEvidence: { findMany: ({ args, query }) => query({ ...args,
      where: { AND: [args.where ?? {}, ownedMatches] } }) },
    matchResultEvidenceUpload: { findMany: ({ args, query }) => query({ ...args,
      where: { AND: [args.where ?? {}, ownedMatches] } }) }
  } });
  const worker = new ResultEvidenceRetentionWorker(scopedPrisma as never, storage as never);
  beforeEach(() => storage.delete.mockClear());
  it('pages consumed CloudBase sessions by stable IDs and cleans only expired source namespaces', async () => {
    const { match } = await fixture();
    const ids = Array.from({ length: 101 }, () => randomUUID());
    const now = new Date();
    const sessionData = (id: string) => ({ id, matchId: match.id, role: 'SUBMITTER' as const,
      uploadedByUserId: users[0]!, objectKey: `cloud://env/match-result-evidence-retained--${id}.png`,
      mimeType: 'image/png', byteSize: 8, checksumSha256: 'a'.repeat(64), status: 'CONSUMED' as const,
      createdAt: new Date(0), expiresAt: new Date(0) });
    await prisma.matchResultEvidenceUpload.createMany({ data: [
      ...ids.map(sessionData),
      { ...sessionData(randomUUID()), createdAt: now },
      { ...sessionData(randomUUID()), expiresAt: new Date(now.getTime() + 600000) }
    ] });
    await worker.cleanup(now);
    expect(storage.delete.mock.calls.length).toBeLessThanOrEqual(200);
    while (storage.delete.mock.calls.length < 202) await worker.cleanup(now);
    expect(storage.delete).toHaveBeenCalledTimes(202);
    for (const id of ids) {
      expect(storage.delete).toHaveBeenCalledWith(`cloud://env/match-result-evidence-temp--${id}.png`);
      expect(storage.delete).toHaveBeenCalledWith(`cloud://env/match-result-evidence--${id}.png`);
      expect(storage.delete).not.toHaveBeenCalledWith(`cloud://env/match-result-evidence-retained--${id}.png`);
    }
  });
  it('coalesces overlapping cleanup invocations into one active pass', async () => {
    const { match, proposal } = await fixture();
    await prisma.matchResultVersion.update({ where: { id: proposal.id }, data: { status: 'OFFICIAL' } });
    await prisma.competitionMatch.update({ where: { id: match.id }, data: { status: 'CONFIRMED', officialResultVersionId: proposal.id } });
    await prisma.matchResultEvidence.create({ data: { matchId: match.id, resultVersionId: proposal.id,
      role: 'SUBMITTER', uploadedByUserId: users[0]!, objectKey: `single-flight-${randomUUID()}`,
      mimeType: 'image/png', byteSize: 8, checksumSha256: 'a'.repeat(64), expiresAt: new Date(0) } });
    let release!: () => void;
    storage.delete.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = worker.cleanup();
    while (!storage.delete.mock.calls.length) await new Promise((resolve) => setImmediate(resolve));
    const second = worker.cleanup();
    release();
    await Promise.all([first, second]);
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
  it('gives evidence, orphan, and source cleanup bounded progress when more than 100 evidence rows are due', async () => {
    const { match, proposal } = await fixture();
    const now = new Date();
    await prisma.matchResultVersion.update({ where: { id: proposal.id }, data: { status: 'OFFICIAL' } });
    await prisma.competitionMatch.update({ where: { id: match.id }, data: { status: 'CONFIRMED', officialResultVersionId: proposal.id } });
    await prisma.matchResultEvidence.createMany({ data: Array.from({ length: 101 }, () => ({
      matchId: match.id, resultVersionId: proposal.id, role: 'SUBMITTER' as const, uploadedByUserId: users[0]!,
      objectKey: `fair-evidence-${randomUUID()}`, mimeType: 'image/png', byteSize: 8,
      checksumSha256: 'a'.repeat(64), expiresAt: now
    })) });
    const orphan = await upload(match.id);
    await prisma.matchResultEvidenceUpload.update({ where: { id: orphan.id }, data: {
      createdAt: new Date(0), expiresAt: new Date(0), objectKey: `match-result-evidence-temp--${orphan.id}.png`
    } });
    const source = await upload(match.id);
    await prisma.matchResultEvidenceUpload.update({ where: { id: source.id }, data: {
      status: 'CONSUMED', createdAt: new Date(0), expiresAt: new Date(0),
      objectKey: `match-result-evidence-retained--${source.id}.png`
    } });

    await worker.cleanup(now);

    const deletedEvidence = await prisma.matchResultEvidence.count({ where: { matchId: match.id, status: 'DELETED' } });
    expect(deletedEvidence).toBeGreaterThan(0);
    expect(deletedEvidence).toBeLessThan(100);
    expect(await prisma.matchResultEvidenceUpload.findUnique({ where: { id: orphan.id } })).toMatchObject({ status: 'EXPIRED' });
    expect(storage.delete).toHaveBeenCalledWith(`match-result-evidence-temp--${source.id}.png`);
    expect(storage.delete).toHaveBeenCalledWith(`match-result-evidence--${source.id}.png`);
  });
  it.each(['PENDING', 'UPLOADED', 'EXPIRED'] as const)('cleans both temporary and deterministic retained orphan copies for %s', async (status) => {
    const { match } = await fixture();
    const session = await upload(match.id);
    const temporary = `match-result-evidence-temp--${session.id}.png`;
    const retained = `match-result-evidence-retained--${session.id}.png`;
    await prisma.matchResultEvidenceUpload.update({ where: { id: session.id }, data: {
      status, objectKey: status === 'PENDING' ? temporary : retained, createdAt: new Date(0), expiresAt: new Date(0)
    } });
    await worker.cleanup();
    expect(storage.delete).toHaveBeenCalledWith(temporary);
    expect(storage.delete).toHaveBeenCalledWith(retained);
    expect(await prisma.matchResultEvidenceUpload.findUnique({ where: { id: session.id } })).toMatchObject({ status: 'EXPIRED' });
  });
  it('preserves a promoted copy referenced by formal evidence even without an upload relation', async () => {
    const { match } = await fixture();
    const session = await upload(match.id);
    const retained = `match-result-evidence-retained--${session.id}.png`;
    await prisma.matchResultEvidenceUpload.update({ where: { id: session.id }, data: {
      status: 'PENDING', objectKey: `match-result-evidence-temp--${session.id}.png`, createdAt: new Date(0), expiresAt: new Date(0)
    } });
    await prisma.matchResultEvidence.create({ data: { matchId: match.id, role: 'SUBMITTER', uploadedByUserId: users[0]!,
      objectKey: retained, mimeType: 'image/png', byteSize: 8, checksumSha256: 'a'.repeat(64) } });
    await worker.cleanup();
    expect(storage.delete).not.toHaveBeenCalled();
  });
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
    while (storage.delete.mock.calls.length < 101) await worker.cleanup(now);
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

import { randomUUID } from 'node:crypto';
import { disputeFixture } from '../../test/helpers/match-result-disputes.js';
import { MatchResultDisputesService } from './match-result-disputes.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';

describe('MatchResultDisputesService', () => {
  const { prisma, users, disputes, results, fixture, upload, rejected } = disputeFixture();

  it('carries forward current result evidence and retires older submissions before enforcing dispute quotas', async () => {
    const { match } = await fixture();
    const a = await upload(match.id);
    await results.submit(users[0]!, match.id, { homeScore: 3, awayScore: 1, expectedVersion: 2, evidenceUploadId: a.id }, randomUUID());
    const b = await upload(match.id);
    const latest = await results.submit(users[0]!, match.id, { homeScore: 4, awayScore: 1, expectedVersion: 3, evidenceUploadId: b.id }, randomUUID());
    await results.reject(users[1]!, match.id, latest.version, { expectedVersion: 4, reason: '错误' }, randomUUID());
    const dispute = await disputes.getForParticipant(users[0]!, match.id);
    expect(dispute?.evidencePresence).toEqual({ SUBMITTER: true, OPPONENT: false });
    expect(await prisma.matchResultEvidence.findMany({ where: { matchId: match.id, status: 'ACTIVE' } }))
      .toMatchObject([{ uploadId: b.id, disputeId: dispute!.id }]);
    expect(await prisma.matchResultEvidence.findUniqueOrThrow({ where: { uploadId: a.id } }))
      .toMatchObject({ status: 'PENDING_DELETE', expiresAt: expect.any(Date) });
    const c = await upload(match.id, 'OPPONENT');
    await disputes.attachEvidence(users[1]!, match.id, { expectedVersion: 5, evidenceUploadId: c.id }, randomUUID());
    const d = await upload(match.id);
    expect((await disputes.attachEvidence(users[0]!, match.id, { expectedVersion: 6, evidenceUploadId: d.id }, randomUUID())).status)
      .toBe('READY_FOR_REVIEW');
    expect(await prisma.matchResultEvidence.count({ where: { matchId: match.id, status: 'ACTIVE' } })).toBe(2);
  });

  it('requires the submitter and a completed same-match upload at the exact confirmation deadline', async () => {
    const { match } = await fixture();
    const evidence = await upload(match.id);
    const input = { expectedVersion: 2, evidenceUploadId: evidence.id };
    await expect(disputes.openFromTimeout(users[0]!, match.id, input, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'CONFIRMATION_NOT_EXPIRED' } });
    const deadline = new Date('2026-10-15T00:00:00Z');
    await prisma.competitionMatch.update({ where: { id: match.id }, data: { resultConfirmationDeadlineAt: deadline } });
    await expect(disputes.openFromTimeout(users[1]!, match.id, input, randomUUID(), deadline))
      .rejects.toMatchObject({ response: { code: 'DISPUTE_SUBMITTER_REQUIRED' } });
    await prisma.matchResultEvidenceUpload.update({ where: { id: evidence.id }, data: { status: 'PENDING', completedAt: null } });
    await expect(disputes.openFromTimeout(users[0]!, match.id, input, randomUUID(), deadline))
      .rejects.toMatchObject({ response: { code: 'EVIDENCE_UPLOAD_INVALID' } });
    expect(await prisma.matchResultDispute.count({ where: { matchId: match.id } })).toBe(0);
    await prisma.matchResultEvidenceUpload.update({ where: { id: evidence.id }, data: { status: 'UPLOADED', completedAt: deadline } });
    const key = randomUUID();
    const opened = await disputes.openFromTimeout(users[0]!, match.id, input, key, deadline);
    expect(await disputes.openFromTimeout(users[0]!, match.id, input, key, deadline)).toEqual(opened);
    expect(await prisma.competitionMatch.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({ status: 'DISPUTED', version: 3 });
    expect(await prisma.matchResultDispute.findUniqueOrThrow({ where: { activeKey: match.id } })).toMatchObject({
      trigger: 'CONFIRMATION_TIMEOUT', evidenceDeadlineAt: new Date('2026-10-16T00:00:00Z')
    });
    expect(await prisma.matchResultEvidenceUpload.findUniqueOrThrow({ where: { id: evidence.id } })).toMatchObject({ status: 'CONSUMED', disputeId: opened.id });
    for (const type of ['CONFIRMATION_EXPIRED', 'DISPUTE_OPENED', 'EVIDENCE_UPLOADED'] as const) {
      expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type } })).toBe(1);
    }
  });

  it('rejects wrong owner/role and foreign uploads, then becomes ready early with two evidence roles', async () => {
    const { match } = await rejected();
    const other = await fixture();
    const foreign = await upload(other.match.id);
    const wrongRole = await upload(match.id, 'SUBMITTER', users[1]!);
    for (const evidence of [foreign, wrongRole]) {
      await expect(disputes.attachEvidence(users[1]!, match.id, { expectedVersion: 3, evidenceUploadId: evidence.id }, randomUUID()))
        .rejects.toMatchObject({ response: { code: 'EVIDENCE_UPLOAD_INVALID' } });
    }
    const a = await upload(match.id);
    await disputes.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: a.id }, randomUUID());
    const b = await upload(match.id, 'OPPONENT');
    const response = await disputes.attachEvidence(users[1]!, match.id, { expectedVersion: 4, evidenceUploadId: b.id }, randomUUID());
    expect(response.status).toBe('READY_FOR_REVIEW');
    expect(await prisma.matchResultDispute.findUniqueOrThrow({ where: { activeKey: match.id } })).toMatchObject({ status: 'READY_FOR_REVIEW' });
    const read = await disputes.getForParticipant(users[0]!, match.id);
    expect(read?.evidencePresence).toEqual({ SUBMITTER: true, OPPONENT: true });
    expect(JSON.stringify(read)).not.toContain(b.objectKey);
    expect(JSON.stringify(read)).not.toContain(b.checksumSha256);
    await expect(disputes.getForParticipant(users[2]!, match.id)).rejects.toMatchObject({ response: { code: 'MATCH_NOT_FOUND' } });
  });

  it('replaces evidence under a lock, keeps one active role and leaves the old object for safe cleanup', async () => {
    const { match } = await rejected();
    const a = await upload(match.id);
    await disputes.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: a.id }, randomUUID());
    const [b, c] = await Promise.all([upload(match.id), upload(match.id)]);
    const outcomes = await Promise.allSettled([b, c].map((evidence) => disputes.attachEvidence(users[0]!, match.id,
      { expectedVersion: 4, evidenceUploadId: evidence.id }, randomUUID())));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({ reason: { response: { code: 'VERSION_CONFLICT' } } });
    expect(await prisma.matchResultEvidence.count({ where: { matchId: match.id, status: 'ACTIVE', role: 'SUBMITTER' } })).toBe(1);
    expect(await prisma.matchResultEvidence.findUniqueOrThrow({ where: { uploadId: a.id } })).toMatchObject({ status: 'PENDING_DELETE', expiresAt: expect.any(Date) });
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'EVIDENCE_REPLACED' } })).toBe(1);
  });

  it.each([false, true])('corrects overdue evidence on reads and rejected writes with one role present=%s', async (present) => {
    const { match } = await rejected();
    if (present) {
      const a = await upload(match.id);
      await disputes.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: a.id }, randomUUID());
    }
    await prisma.matchResultDispute.update({ where: { activeKey: match.id }, data: { evidenceDeadlineAt: new Date(0) } });
    const b = await upload(match.id, 'OPPONENT');
    await expect(disputes.attachEvidence(users[1]!, match.id, { expectedVersion: present ? 4 : 3, evidenceUploadId: b.id }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'EVIDENCE_DEADLINE_EXPIRED' } });
    expect((await disputes.getForParticipant(users[1]!, match.id))?.status).toBe('READY_FOR_REVIEW');
    const events = await prisma.matchResultEvent.findMany({ where: { matchId: match.id, type: 'EVIDENCE_DEADLINE_EXPIRED' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({ missingRoles: present ? ['OPPONENT'] : ['SUBMITTER', 'OPPONENT'] });
    expect(await prisma.matchResultEvidenceUpload.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: 'UPLOADED' });
  });

  it('persists deadline correction when the deadline becomes overdue between preflight and the write lock', async () => {
    const { match } = await rejected();
    const evidence = await upload(match.id);
    const realReceipts = new MutationReceiptService(prisma);
    const receipts = {
      execute: async (...args: Parameters<MutationReceiptService['execute']>) => {
        await prisma.matchResultDispute.update({ where: { activeKey: match.id }, data: { evidenceDeadlineAt: new Date(0) } });
        return realReceipts.execute(...args);
      }
    };
    const racingService = new MatchResultDisputesService(prisma, receipts as never);
    await expect(racingService.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: evidence.id }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'EVIDENCE_DEADLINE_EXPIRED' } });
    expect(await prisma.matchResultDispute.findUniqueOrThrow({ where: { activeKey: match.id } })).toMatchObject({ status: 'READY_FOR_REVIEW' });
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'EVIDENCE_DEADLINE_EXPIRED' } })).toBe(1);
  });

  it('persists a newly due evidence deadline after a stale-version attach and preserves VERSION_CONFLICT', async () => {
    const { match } = await rejected();
    const evidence = await upload(match.id);
    const realReceipts = new MutationReceiptService(prisma);
    const receipts = {
      execute: async (...args: Parameters<MutationReceiptService['execute']>) => {
        await prisma.competitionMatch.update({ where: { id: match.id }, data: { version: 4 } });
        await prisma.matchResultDispute.update({ where: { activeKey: match.id }, data: { evidenceDeadlineAt: new Date(0) } });
        return realReceipts.execute(...args);
      }
    };
    const racingService = new MatchResultDisputesService(prisma, receipts as never);
    const key = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(racingService.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: evidence.id }, key))
        .rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
      expect(await prisma.matchResultDispute.findUniqueOrThrow({ where: { activeKey: match.id } })).toMatchObject({ status: 'READY_FOR_REVIEW' });
      expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'EVIDENCE_DEADLINE_EXPIRED' } })).toBe(1);
    }
    expect(await prisma.matchResultEvidenceUpload.findUniqueOrThrow({ where: { id: evidence.id } })).toMatchObject({ status: 'UPLOADED' });
    expect(await prisma.mutationReceipt.count({ where: { actorId: users[0]!, key } })).toBe(0);
  });

  it.each(['invalid-upload', 'non-submitter'] as const)('persists newly due confirmation expiry after a rejected %s timeout request', async (failure) => {
    const { match } = await fixture();
    const evidence = await upload(match.id);
    const realReceipts = new MutationReceiptService(prisma);
    const receipts = {
      execute: async (...args: Parameters<MutationReceiptService['execute']>) => {
        await prisma.competitionMatch.update({ where: { id: match.id }, data: { resultConfirmationDeadlineAt: new Date(0) } });
        return realReceipts.execute(...args);
      }
    };
    const racingService = new MatchResultDisputesService(prisma, receipts as never);
    const userId = users[failure === 'invalid-upload' ? 0 : 1]!;
    const input = { expectedVersion: 2, evidenceUploadId: failure === 'invalid-upload' ? randomUUID() : evidence.id };
    const code = failure === 'invalid-upload' ? 'EVIDENCE_UPLOAD_INVALID' : 'DISPUTE_SUBMITTER_REQUIRED';
    const key = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(racingService.openFromTimeout(userId, match.id, input, key)).rejects.toMatchObject({ response: { code } });
      expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'CONFIRMATION_EXPIRED' } })).toBe(1);
    }
    expect(await prisma.competitionMatch.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({ status: 'PENDING_CONFIRMATION', version: 2 });
    expect(await prisma.matchResultDispute.count({ where: { matchId: match.id } })).toBe(0);
    expect(await prisma.matchResultEvidenceUpload.findUniqueOrThrow({ where: { id: evidence.id } })).toMatchObject({ status: 'UPLOADED' });
    expect(await prisma.mutationReceipt.count({ where: { actorId: userId, key } })).toBe(0);
  });

  it('does not let a nonparticipant advance an overdue dispute', async () => {
    const { match } = await rejected();
    await prisma.matchResultDispute.update({ where: { activeKey: match.id }, data: { evidenceDeadlineAt: new Date(0) } });
    await expect(disputes.attachEvidence(users[2]!, match.id, { expectedVersion: 3, evidenceUploadId: randomUUID() }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'MATCH_NOT_FOUND' } });
    expect(await prisma.matchResultDispute.findUniqueOrThrow({ where: { activeKey: match.id } })).toMatchObject({ status: 'EVIDENCE_COLLECTION' });
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'EVIDENCE_DEADLINE_EXPIRED' } })).toBe(0);
  });

  it('preserves the original conflict if the match becomes hidden before independent error correction', async () => {
    const { match, stage } = await rejected();
    const realReceipts = new MutationReceiptService(prisma);
    const receipts = {
      execute: async (...args: Parameters<MutationReceiptService['execute']>) => {
        await prisma.competitionMatch.update({ where: { id: match.id }, data: { version: 4 } });
        await prisma.matchResultDispute.update({ where: { activeKey: match.id }, data: { evidenceDeadlineAt: new Date(0) } });
        try { return await realReceipts.execute(...args); }
        catch (error) {
          await prisma.competitionStage.update({ where: { id: stage.id }, data: { status: 'DRAFT' } });
          throw error;
        }
      }
    };
    const racingService = new MatchResultDisputesService(prisma, receipts as never);
    await expect(racingService.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: randomUUID() }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(await prisma.matchResultDispute.findUniqueOrThrow({ where: { activeKey: match.id } })).toMatchObject({ status: 'EVIDENCE_COLLECTION' });
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'EVIDENCE_DEADLINE_EXPIRED' } })).toBe(0);
  });

  it('corrects on a participant read exactly at the evidence deadline, never one millisecond early', async () => {
    const { match } = await rejected();
    const deadline = new Date('2026-10-17T00:00:00Z');
    await prisma.matchResultDispute.update({ where: { activeKey: match.id }, data: { evidenceDeadlineAt: deadline } });
    expect((await disputes.getForParticipant(users[0]!, match.id, new Date('2026-10-16T23:59:59.999Z')))?.status).toBe('EVIDENCE_COLLECTION');
    expect((await disputes.getForParticipant(users[0]!, match.id, deadline))?.status).toBe('READY_FOR_REVIEW');
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'EVIDENCE_DEADLINE_EXPIRED' } })).toBe(1);
  });

  it.each(['DRAFT', 'CANCELLED'] as const)('rejects reads and writes for %s competitions', async (status) => {
    const { match, competition } = await rejected();
    await prisma.competition.update({ where: { id: competition.id }, data: { status } });
    await expect(disputes.getForParticipant(users[0]!, match.id)).rejects.toMatchObject({ response: { code: 'MATCH_RESULT_NOT_ALLOWED' } });
    const a = await upload(match.id);
    await expect(disputes.attachEvidence(users[0]!, match.id, { expectedVersion: 3, evidenceUploadId: a.id }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'MATCH_RESULT_NOT_ALLOWED' } });
  });
});

describe('dispute participant authorization', () => {
  it.each([
    { deleted: true, archived: false, hidden: false, userId: 'owner', code: 'MATCH_NOT_FOUND' },
    { deleted: false, archived: true, hidden: false, userId: 'owner', code: 'TEAM_ARCHIVED' },
    { deleted: false, archived: false, hidden: true, userId: 'owner', code: 'MATCH_RESULT_NOT_ALLOWED' },
    { deleted: false, archived: false, hidden: true, userId: 'outsider', code: 'MATCH_NOT_FOUND' }
  ])('blocks read and writes for $code (deleted=$deleted archived=$archived hidden=$hidden user=$userId)', async (options) => {
    const transaction = {
      $queryRaw: async () => [],
      competitionMatch: { findUnique: async () => ({
        id: 'match', version: 3, status: 'DISPUTED',
        stage: { status: options.hidden ? 'DRAFT' : 'PUBLISHED', competition: {
          status: 'IN_PROGRESS', season: { league: { isDeleted: options.deleted } }
        } },
        homeParticipant: { individualUserId: null, seasonEntry: { ownerUserId: 'owner', leagueTeam: { status: options.archived ? 'ARCHIVED' : 'ACTIVE' } } },
        awayParticipant: { individualUserId: 'opponent', seasonEntry: null }
      }) }
    };
    const prisma = { $transaction: async (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction) };
    const service = new MatchResultDisputesService(prisma as never, {} as never);
    const input = { expectedVersion: 3, evidenceUploadId: 'upload' };
    for (const action of [
      () => service.getForParticipant(options.userId, 'match'),
      () => service.attachEvidence(options.userId, 'match', input, 'key'),
      () => service.openFromTimeout(options.userId, 'match', input, 'key')
    ]) await expect(action()).rejects.toMatchObject({ response: { code: options.code } });
  });
});

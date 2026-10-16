import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalObjectStorage } from '../storage/local-object-storage.js';
import { jest } from '@jest/globals';
import { disputeFixture } from '../../test/helpers/match-result-disputes.js';
import { AdminMatchResultDisputesService } from './admin-match-result-disputes.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { ResultsService } from './results.service.js';
import { StandingsService } from './standings.service.js';
import { CupProgressionService } from './cup-progression.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { ResultEvidenceStorageService } from './result-evidence-storage.service.js';
import { CompetitionsService } from './competitions.service.js';
import type { Prisma } from '../generated/prisma/client.js';

describe('administrator arbitration', () => {
  const { prisma, users, disputes, rejected, fixture, upload } = disputeFixture();
  const adminId = randomUUID();
  const leagueIds: string[] = [];
  const authorization = new AdminAuthorizationService(prisma);
  const standings = new StandingsService(prisma);
  const results = new ResultsService(prisma, new MutationReceiptService(prisma), standings, new CupProgressionService(),
    undefined, new AdminMutationReceiptService(prisma), authorization, new AuditLogService(prisma));
  const storage = { temporaryReadUrl: jest.fn(async () => 'https://private.test/signed'),
    createDirectUpload: jest.fn(async () => ({ key: `match-result-evidence-temp--${randomUUID()}.png`, uploadUrl: 'https://private.test/upload', headers: {} })),
    promoteEvidence: jest.fn(async (key: string) => key.replace('evidence-temp--', 'evidence-retained--')),
    delete: jest.fn(async () => undefined),
    inspect: jest.fn(async () => ({ mimeType: 'image/png', size: 8, checksumSha256: 'a'.repeat(64),
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) })) };
  const evidence = new ResultEvidenceStorageService(prisma, storage as never, authorization);
  const service = new AdminMatchResultDisputesService(prisma, authorization, results, disputes, evidence);
  beforeAll(async () => {
    await prisma.adminAccount.create({ data: { id: adminId, username: `arbitration-${adminId}`, displayName: '仲裁员', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN' } });
  });
  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { actorAdminId: adminId } });
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId } });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    leagueIds.splice(0);
  });
  afterAll(async () => { await prisma.adminAccount.delete({ where: { id: adminId } }); await prisma.$disconnect(); });
  async function setup(reject = true) {
    const data = await (reject ? rejected() : fixture());
    const league = await prisma.league.create({ data: { name: '仲裁', shortName: '仲裁', defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL', createdById: users[0]! } });
    leagueIds.push(league.id);
    const season = await prisma.leagueSeason.create({ data: { leagueId: league.id, seasonNumber: 1, displayName: 'S1', isFirstSeason: true,
      registrationOpensAt: new Date('2026-01-01'), registrationClosesAt: new Date('2026-01-02'), startsAt: new Date('2026-01-03'), endsAt: new Date('2027-01-01'),
      superCapacity: 2, championCapacity: 2, promotionCount: 1, status: 'IN_PROGRESS', createdById: users[0]! } });
    await prisma.competition.update({ where: { id: data.competition.id }, data: { seasonId: season.id } });
    await prisma.competitionRuleVersion.create({ data: { competitionId: data.competition.id, version: 1, winPoints: 3, drawPoints: 1, lossPoints: 0,
      tieBreakers: ['TOTAL_POINTS', 'TOTAL_GOAL_DIFFERENCE', 'TOTAL_GOALS'], createdById: users[0]! } });
    const dispute = await prisma.matchResultDispute.findUnique({ where: { activeKey: data.match.id } });
    return { ...data, leagueId: league.id, dispute };
  }
  const useScore = { decisionType: 'USE_SUBMITTED_SCORE' as const, reason: '  核验证据  ', expectedVersion: 3 };

  function gate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    return { promise, release };
  }
  function observingPrisma(wrap: (tx: Prisma.TransactionClient) => Prisma.TransactionClient) {
    return new Proxy(prisma, { get(target, key, receiver) {
      if (key === '$transaction') return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) =>
        target.$transaction((tx) => work(wrap(tx)), options);
      return Reflect.get(target, key, receiver);
    } });
  }
  async function cupFixture(published: boolean) {
    const a = await setup();
    await prisma.competitionStage.update({ where: { id: a.stage.id }, data: { format: 'SINGLE_ELIMINATION', stageCode: 'SEMI_FINAL' } });
    await prisma.matchResultDispute.update({ where: { id: a.dispute!.id }, data: { status: 'READY_FOR_REVIEW' } });
    const previous = await prisma.matchResultVersion.create({ data: { matchId: a.match.id, version: 2, homeScore: 2, awayScore: 0,
      submittedByAdminId: adminId, submissionSide: 'MANAGER', status: 'OFFICIAL', reason: '初始记录' } });
    await prisma.competitionMatch.update({ where: { id: a.match.id }, data: { officialResultVersionId: previous.id } });
    const third = await prisma.competitionParticipant.create({ data: { competitionId: a.competition.id, admissionSequence: 3, displayNameSnapshot: '第三队' } });
    const fourth = await prisma.competitionParticipant.create({ data: { competitionId: a.competition.id, admissionSequence: 4, displayNameSnapshot: '第四队', individualUserId: users[2]! } });
    const sibling = await prisma.competitionMatch.create({ data: { stageId: a.stage.id, roundNumber: 1, matchNumber: 2, pairingKey: randomUUID(),
      homeParticipantId: third.id, awayParticipantId: fourth.id, status: 'PENDING_CONFIRMATION', version: 2 } });
    await prisma.matchResultVersion.create({ data: { matchId: sibling.id, version: 1, homeScore: 3, awayScore: 1, submittedById: users[0]!, submissionSide: 'HOME' } });
    const stage = await prisma.competitionStage.create({ data: { competitionId: a.competition.id, sequence: 2, stageCode: 'FINAL',
      format: 'SINGLE_ELIMINATION', status: published ? 'PUBLISHED' : 'DRAFT' } });
    const proposal = await prisma.cupBracketProposal.create({ data: { competitionId: a.competition.id, version: 1, status: 'CONFIRMED',
      algorithmVersion: 'test', randomSeed: 1, bracketSize: 4, createdByAdminId: adminId } });
    const round = await prisma.cupBracketRound.create({ data: { proposalId: proposal.id, roundNumber: 1, stageCode: 'SEMI_FINAL', displayName: '半决赛' } });
    const finalRound = await prisma.cupBracketRound.create({ data: { proposalId: proposal.id, roundNumber: 2, stageCode: 'FINAL', displayName: '决赛' } });
    const source = await prisma.cupBracketPairing.create({ data: { roundId: round.id, pairingNumber: 1, matchId: a.match.id,
      homeParticipantId: a.match.homeParticipantId, awayParticipantId: a.match.awayParticipantId, winnerParticipantId: a.match.homeParticipantId } });
    const other = await prisma.cupBracketPairing.create({ data: { roundId: round.id, pairingNumber: 2, matchId: sibling.id,
      homeParticipantId: third.id, awayParticipantId: fourth.id, winnerParticipantId: published ? third.id : null } });
    const nextMatch = published ? await prisma.competitionMatch.create({ data: { stageId: stage.id, roundNumber: 2, matchNumber: 1,
      pairingKey: randomUUID(), homeParticipantId: a.match.homeParticipantId, awayParticipantId: third.id, status: 'AWAITING_RESULT' } }) : null;
    if (published) await prisma.stageParticipant.createMany({ data: [a.match.homeParticipantId, third.id].map((participantId, index) => ({ stageId: stage.id, participantId, seed: index + 1 })) });
    const target = await prisma.cupBracketPairing.create({ data: { roundId: finalRound.id, pairingNumber: 1,
      homeSourcePairingId: source.id, awaySourcePairingId: other.id, matchId: nextMatch?.id ?? null,
      homeParticipantId: published ? a.match.homeParticipantId : null, awayParticipantId: published ? third.id : null } });
    return { ...a, source, target, sibling, nextMatch, previous };
  }

  it('serializes correction of a draft successor with concurrent sibling confirmation/publication', async () => {
    const a = await cupFixture(false);
    const readDraft = gate(); const resumeCorrection = gate(); const publicationLockAttempt = gate();
    const correctionPrisma = observingPrisma((tx) => new Proxy(tx, { get(target, key, receiver) {
      if (key === 'cupBracketPairing') return new Proxy(tx.cupBracketPairing, { get(delegate, method, proxy) {
        if (method === 'findMany') return async (args: Prisma.CupBracketPairingFindManyArgs) => {
          const rows = await delegate.findMany(args);
          if (args.where?.OR) { readDraft.release(); await resumeCorrection.promise; }
          return rows;
        };
        return Reflect.get(delegate, method, proxy);
      } });
      return Reflect.get(target, key, receiver);
    } }));
    let publicationRequestedCompetitionLock = false;
    const publicationPrisma = observingPrisma((tx) => new Proxy(tx, { get(target, key, receiver) {
      if (key === '$queryRaw') return (sql: TemplateStringsArray, ...values: unknown[]) => {
        if (sql.join('').includes('FROM competitions')) {
          publicationRequestedCompetitionLock = true;
          publicationLockAttempt.release();
        }
        if (sql.join('').includes('competition_matches') && values.includes(a.sibling.id)) {
          expect(publicationRequestedCompetitionLock).toBe(true);
        }
        return tx.$queryRaw(sql, ...values);
      };
      return Reflect.get(target, key, receiver);
    } }));
    const correctionService = new AdminMatchResultDisputesService(correctionPrisma, authorization, results, disputes, evidence);
    const publisher = new ResultsService(publicationPrisma, new MutationReceiptService(publicationPrisma), standings, new CupProgressionService());
    const correction = correctionService.resolve(adminId, a.leagueId, a.dispute!.id,
      { decisionType: 'REPLACE_SCORE', homeScore: 0, awayScore: 2, reason: '改判', expectedVersion: 3 });
    await readDraft.promise;
    const publication = publisher.confirm(users[2]!, a.sibling.id, 1, { expectedVersion: 2 }, randomUUID());
    try {
      // Before the fix publication finishes while correction holds a stale empty successor.
      // With the fix publication reaches its competition lock and waits, before taking any match lock.
      await Promise.race([publication.then(() => undefined), publicationLockAttempt.promise]);
    } finally { resumeCorrection.release(); }
    await Promise.all([correction, publication]);
    const source = await prisma.cupBracketPairing.findUniqueOrThrow({ where: { id: a.source.id } });
    const target = await prisma.cupBracketPairing.findUniqueOrThrow({ where: { id: a.target.id } });
    expect(source.winnerParticipantId).toBe(a.match.awayParticipantId);
    expect(target.homeParticipantId).toBe(source.winnerParticipantId);
    expect(await prisma.competitionMatch.findUniqueOrThrow({ where: { id: target.matchId! } })).toMatchObject({ homeParticipantId: source.winnerParticipantId });
  });

  it.each(['arbitration', 'league-admin', 'manager'] as const)('rejects %s correction after a downstream submission commits while it waits for that match lock', async (mode) => {
    const a = await cupFixture(true); const next = a.nextMatch!;
    const submitLocked = gate(); const commitSubmission = gate(); const correctionWaits = gate();
    const submitPrisma = observingPrisma((tx) => new Proxy(tx, { get(target, key, receiver) {
      if (key === '$queryRaw') return async (sql: TemplateStringsArray, ...values: unknown[]) => {
        const rows = await tx.$queryRaw(sql, ...values);
        if (sql.join('').includes('competition_matches') && values.includes(next.id)) { submitLocked.release(); await commitSubmission.promise; }
        return rows;
      };
      return Reflect.get(target, key, receiver);
    } }));
    const correctionPrisma = observingPrisma((tx) => new Proxy(tx, { get(target, key, receiver) {
      if (key === '$queryRaw') return (sql: TemplateStringsArray, ...values: unknown[]) => {
        if (sql.join('').includes('competition_matches') && values.includes(next.id)) correctionWaits.release();
        return tx.$queryRaw(sql, ...values);
      };
      return Reflect.get(target, key, receiver);
    } }));
    const submitter = new ResultsService(submitPrisma, new MutationReceiptService(submitPrisma), standings, new CupProgressionService());
    const corrector = new ResultsService(correctionPrisma, new MutationReceiptService(correctionPrisma), standings, new CupProgressionService(),
      undefined, new AdminMutationReceiptService(correctionPrisma), authorization, new AuditLogService(prisma));
    const arbitrator = new AdminMatchResultDisputesService(correctionPrisma, authorization, corrector, disputes, evidence);
    const submission = submitter.submit(users[0]!, next.id, { homeScore: 3, awayScore: 2, expectedVersion: 1 }, randomUUID());
    await submitLocked.promise;
    const input = { homeScore: 0, awayScore: 2, reason: '改判', expectedVersion: 3 };
    const correction = mode === 'arbitration' ? arbitrator.resolve(adminId, a.leagueId, a.dispute!.id, { ...input, decisionType: 'REPLACE_SCORE' })
      : mode === 'league-admin' ? corrector.recordByLeagueAdmin(adminId, a.leagueId, a.competition.id, a.match.id, input, randomUUID())
      : corrector.recordByManager(users[0]!, a.competition.id, a.match.id, input, randomUUID());
    const outcome = correction.then(() => null, (error: unknown) => error);
    await correctionWaits.promise;
    commitSubmission.release();
    await submission;
    expect(await outcome).toMatchObject({ response: { code: 'CUP_RESULT_LOCKED' } });
    expect(await prisma.competitionMatch.findUnique({ where: { id: next.id } })).toMatchObject({ homeParticipantId: a.match.homeParticipantId, status: 'PENDING_CONFIRMATION' });
    expect(await prisma.competitionMatch.findUnique({ where: { id: a.match.id } })).toMatchObject({ officialResultVersionId: a.previous.id, status: 'DISPUTED', version: 3 });
    expect(await prisma.matchResultDispute.findUnique({ where: { id: a.dispute!.id } })).toMatchObject({ status: 'READY_FOR_REVIEW', activeKey: a.match.id });
    expect(await prisma.matchResultVersion.count({ where: { matchId: a.match.id } })).toBe(2);
    expect(await prisma.matchResultEvent.count({ where: { matchId: a.match.id, type: 'ADMIN_DECIDED' } })).toBe(0);
  });

  it('replaces submitted scores exactly once under concurrent decisions and rejects invalid scores', async () => {
    const a = await setup();
    await prisma.matchResultDispute.update({ where: { id: a.dispute!.id }, data: { status: 'READY_FOR_REVIEW' } });
    const input = { decisionType: 'REPLACE_SCORE' as const, reason: '改判', homeScore: 0, awayScore: 3, expectedVersion: 3 };
    await expect(service.resolve(adminId, a.leagueId, a.dispute!.id, { ...input, homeScore: -1 })).rejects.toThrow();
    const outcomes = await Promise.allSettled([1, 2].map(() => service.resolve(adminId, a.leagueId, a.dispute!.id, input)));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.matchResultVersion.findMany({ where: { matchId: a.match.id, status: 'OFFICIAL' } })).toMatchObject([{ homeScore: 0, awayScore: 3 }]);
    expect(await prisma.matchResultEvent.count({ where: { matchId: a.match.id, type: 'ADMIN_DECIDED' } })).toBe(1);
  });

  it('orders due and ready disputes first and excludes hidden and foreign matches', async () => {
    const a = await setup(); const b = await setup(); const c = await setup();
    const seasonId = (await prisma.competition.findUniqueOrThrow({ where: { id: a.competition.id } })).seasonId;
    await prisma.competition.updateMany({ where: { id: { in: [b.competition.id, c.competition.id] } }, data: { seasonId } });
    await prisma.matchResultDispute.update({ where: { id: b.dispute!.id }, data: { evidenceDeadlineAt: new Date(0) } });
    await prisma.matchResultDispute.update({ where: { id: c.dispute!.id }, data: { status: 'READY_FOR_REVIEW' } });
    const queue = await service.list(adminId, a.leagueId);
    expect(queue.map((row) => row.id)).toEqual([b.dispute!.id, c.dispute!.id, a.dispute!.id]);
    expect(queue[0]).toMatchObject({ missingRoles: expect.arrayContaining(['SUBMITTER', 'OPPONENT']), evidence: [], timeline: [] });
    await prisma.competitionStage.update({ where: { id: b.stage.id }, data: { status: 'DRAFT' } });
    expect((await service.list(adminId, a.leagueId)).map((row) => row.id)).toEqual([c.dispute!.id, a.dispute!.id]);
    await expect(service.resolve(adminId, b.leagueId, a.dispute!.id, useScore)).rejects.toMatchObject({ response: { code: 'DISPUTE_NOT_FOUND' } });
  });

  it('supports private local administrator upload/read without a dispute and rejects other roles, owners and leagues', async () => {
    const a = await setup(false); const b = await setup(false);
    const directory = await mkdtemp(join(tmpdir(), 'efm-admin-evidence-'));
    const provider = new LocalObjectStorage(directory, 'http://localhost:3000');
    const local = new ResultEvidenceStorageService(prisma, provider, authorization);
    const input = { role: 'ADMIN' as const, expectedVersion: 2, mimeType: 'image/png' as const, byteSize: 8,
      checksumSha256: '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6' };
    try {
      await expect(local.createAdminUpload(adminId, a.leagueId, a.match.id, { ...input, role: 'SUBMITTER' })).rejects.toThrow();
      const grant = await local.createAdminUpload(adminId, a.leagueId, a.match.id, input);
      expect(grant.uploadUrl).toContain(`/v1/admin/leagues/${a.leagueId}/result-evidence/objects/`);
      await local.writeAdminLocalObject(adminId, a.leagueId, grant.objectKey, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png');
      const score = { homeScore: 3, awayScore: 2, reason: '管理员录入', expectedVersion: 2, evidenceUploadId: grant.id };
      await expect(results.recordByLeagueAdmin(adminId, a.leagueId, a.competition.id, a.match.id, score, randomUUID())).rejects.toMatchObject({ response: { code: 'EVIDENCE_UPLOAD_INVALID' } });
      await local.completeAdminUpload(adminId, a.leagueId, a.match.id, grant.id, { expectedVersion: 2 });
      await expect(results.recordByLeagueAdmin(adminId, b.leagueId, b.competition.id, b.match.id, score, randomUUID())).rejects.toMatchObject({ response: { code: 'EVIDENCE_UPLOAD_INVALID' } });
      await results.recordByLeagueAdmin(adminId, a.leagueId, a.competition.id, a.match.id, score, randomUUID());
      const image = await prisma.matchResultEvidence.findUniqueOrThrow({ where: { uploadId: grant.id } });
      expect(image.objectKey).toMatch(/^match-result-evidence-retained--/);
      expect(image.objectKey).not.toBe(grant.objectKey);
      expect(await provider.readPrivate(grant.objectKey)).toBeNull();
      const url = new URL((await local.adminReadUrl(adminId, a.leagueId, a.match.id, image.id)).url);
      expect(url.pathname).toContain(`/admin/leagues/${a.leagueId}/`);
      expect(await provider.read(grant.objectKey)).toBeNull();
      const file = await local.readAdminLocalObject(adminId, a.leagueId, image.objectKey, url.searchParams.get('expires')!, url.searchParams.get('signature')!);
      expect(file.getHeaders()).toMatchObject({ type: 'image/png', length: 8 });
      await expect(local.adminReadUrl(adminId, b.leagueId, a.match.id, image.id)).rejects.toThrow();
      await expect(local.userReadUrl(users[0]!, a.match.id, image.id)).rejects.toThrow();
      await expect(local.readAdminLocalObject(adminId, a.leagueId, grant.objectKey, '0', 'invalid')).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('requires league authorization, scopes every read, and refuses early decisions', async () => {
    const a = await setup(); const b = await setup();
    await expect(service.list(users[0]!, a.leagueId)).rejects.toMatchObject({ response: { code: 'ADMIN_LEAGUE_ACCESS_DENIED' } });
    await expect(service.detail(adminId, b.leagueId, a.dispute!.id)).rejects.toMatchObject({ response: { code: 'DISPUTE_NOT_FOUND' } });
    await expect(service.resolve(adminId, a.leagueId, a.dispute!.id, useScore)).rejects.toMatchObject({ response: { code: 'DISPUTE_NOT_READY' } });
    await expect(service.resolve(adminId, a.leagueId, a.dispute!.id, { ...useScore, reason: ' ' })).rejects.toThrow();
    expect(await prisma.matchResultVersion.count({ where: { matchId: a.match.id, status: 'OFFICIAL' } })).toBe(0);
  });

  it('atomically advances a due dispute, adopts its triggering score, retains evidence 90 days, recalculates and audits', async () => {
    const a = await setup();
    const img = await upload(a.match.id);
    await disputes.attachEvidence(users[0]!, a.match.id, { expectedVersion: 3, evidenceUploadId: img.id }, randomUUID());
    await prisma.matchResultDispute.update({ where: { id: a.dispute!.id }, data: { evidenceDeadlineAt: new Date(0) } });
    await service.resolve(adminId, a.leagueId, a.dispute!.id, { ...useScore, expectedVersion: 4 });
    const resolved = await prisma.matchResultDispute.findUniqueOrThrow({ where: { id: a.dispute!.id } });
    expect(resolved).toMatchObject({ status: 'RESOLVED', activeKey: null, decisionReason: '核验证据', finalHomeScore: 2, finalAwayScore: 1, decidedByAdminId: adminId });
    const stored = await prisma.matchResultEvidence.findUniqueOrThrow({ where: { uploadId: img.id } });
    expect(stored.expiresAt!.getTime() - resolved.decidedAt!.getTime()).toBe(7_776_000_000);
    expect(await prisma.competitionMatch.findUnique({ where: { id: a.match.id } })).toMatchObject({ status: 'ADMIN_DECIDED', version: 5 });
    expect(await prisma.standingsRow.findFirst({ where: { snapshot: { competitionId: a.competition.id }, participantId: a.match.homeParticipantId } })).toMatchObject({ basePoints: 3 });
    expect(await prisma.auditLog.count({ where: { actorAdminId: adminId, resourceId: a.match.id } })).toBe(1);
    const detail = await service.detail(adminId, a.leagueId, a.dispute!.id);
    expect(detail).toHaveProperty('matchVersion', 5);
    expect(detail.timeline.map((event) => event.type)).toEqual(expect.arrayContaining(['RESULT_SUBMITTED', 'RESULT_REJECTED', 'ADMIN_DECIDED', 'EVIDENCE_DEADLINE_EXPIRED']));
    expect(JSON.stringify(detail)).not.toContain(img.objectKey);
    expect(await service.readUrl(adminId, a.leagueId, a.dispute!.id, stored.id)).toHaveProperty('url', 'https://private.test/signed');
  });

  it('rolls back the entire decision when standings repair fails', async () => {
    const a = await setup();
    await prisma.matchResultDispute.update({ where: { id: a.dispute!.id }, data: { status: 'READY_FOR_REVIEW' } });
    const spy = jest.spyOn(standings, 'recalculate').mockRejectedValueOnce(new Error('repair failed'));
    await expect(service.resolve(adminId, a.leagueId, a.dispute!.id, useScore)).rejects.toThrow('repair failed');
    spy.mockRestore();
    expect(await prisma.matchResultDispute.findUnique({ where: { id: a.dispute!.id } })).toMatchObject({ activeKey: a.match.id, status: 'READY_FOR_REVIEW' });
    expect(await prisma.matchResultVersion.count({ where: { matchId: a.match.id, status: 'OFFICIAL' } })).toBe(0);
    expect(await prisma.matchResultEvent.count({ where: { matchId: a.match.id, type: 'ADMIN_DECIDED' } })).toBe(0);
  });

  it('keeps an administrator upload pending when its image checksum differs', async () => {
    const a = await setup();
    const grant = await evidence.createAdminUpload(adminId, a.leagueId, a.match.id, {
      role: 'ADMIN', expectedVersion: 3, mimeType: 'image/png', byteSize: 8, checksumSha256: 'b'.repeat(64)
    });
    await expect(evidence.completeAdminUpload(adminId, a.leagueId, a.match.id, grant.id, { expectedVersion: 3 }))
      .rejects.toMatchObject({ response: { code: 'INVALID_RESULT_EVIDENCE' } });
    expect(await prisma.matchResultEvidenceUpload.findUnique({ where: { id: grant.id } })).toMatchObject({ status: 'PENDING' });
  });

  it('direct administrator scores require reasons, consume authorized admin evidence, supersede and clear disputes', async () => {
    const a = await setup();
    const input = { homeScore: 0, awayScore: 3, expectedVersion: 3, reason: '核验后改分' };
    await expect(results.recordByLeagueAdmin(adminId, a.leagueId, a.competition.id, a.match.id, { ...input, reason: '' }, randomUUID())).rejects.toThrow();
    const grant = await evidence.createAdminUpload(adminId, a.leagueId, a.match.id, { role: 'ADMIN', expectedVersion: 3, mimeType: 'image/png', byteSize: 8, checksumSha256: 'a'.repeat(64) });
    await evidence.completeAdminUpload(adminId, a.leagueId, a.match.id, grant.id, { expectedVersion: 3 });
    await prisma.matchResultDispute.update({ where: { id: a.dispute!.id }, data: { status: 'READY_FOR_REVIEW' } });
    const first = await results.recordByLeagueAdmin(adminId, a.leagueId, a.competition.id, a.match.id, { ...input, evidenceUploadId: grant.id }, randomUUID());
    expect(await prisma.matchResultDispute.findUnique({ where: { id: a.dispute!.id } })).toMatchObject({ status: 'RESOLVED', activeKey: null });
    expect(await prisma.matchResultEvidence.findUnique({ where: { uploadId: grant.id } })).toMatchObject({ role: 'ADMIN', uploadedByAdminId: adminId });
    const replacement = await evidence.createAdminUpload(adminId, a.leagueId, a.match.id, { role: 'ADMIN', expectedVersion: 4, mimeType: 'image/png', byteSize: 8, checksumSha256: 'b'.repeat(64) });
    storage.inspect.mockResolvedValueOnce({ mimeType: 'image/png', size: 8, checksumSha256: 'b'.repeat(64),
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
    await evidence.completeAdminUpload(adminId, a.leagueId, a.match.id, replacement.id, { expectedVersion: 4 });
    await results.recordByLeagueAdmin(adminId, a.leagueId, a.competition.id, a.match.id, { ...input, expectedVersion: 4, homeScore: 4, evidenceUploadId: replacement.id }, randomUUID());
    expect(await prisma.matchResultVersion.findUnique({ where: { id: first.id } })).toMatchObject({ status: 'SUPERSEDED', homeScore: 0, awayScore: 3 });
    expect(await prisma.matchResultEvidence.count({ where: { matchId: a.match.id, role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.matchResultEvidence.findUnique({ where: { uploadId: grant.id } })).toMatchObject({ status: 'PENDING_DELETE' });
    expect(await prisma.matchResultEvent.count({ where: { matchId: a.match.id, type: 'EVIDENCE_REPLACED' } })).toBe(1);
  });

  it('does not let direct result entry bypass an active dispute evidence deadline', async () => {
    const a = await setup();
    await expect(results.recordByLeagueAdmin(adminId, a.leagueId, a.competition.id, a.match.id, {
      homeScore: 0, awayScore: 3, expectedVersion: 3, reason: '提前裁决'
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'DISPUTE_NOT_READY' } });
    expect(await prisma.matchResultDispute.findUniqueOrThrow({ where: { id: a.dispute!.id } }))
      .toMatchObject({ status: 'EVIDENCE_COLLECTION', activeKey: a.match.id });
    expect(await prisma.matchResultVersion.count({ where: { matchId: a.match.id, status: 'OFFICIAL' } })).toBe(0);
  });

  it('closes active disputes and schedules their evidence for cleanup when the competition is cancelled', async () => {
    const a = await setup();
    const grant = await upload(a.match.id, 'SUBMITTER', users[0]!);
    await disputes.attachEvidence(users[0]!, a.match.id, { evidenceUploadId: grant.id, expectedVersion: 3 }, randomUUID());
    const nonDisputeEvidence = await prisma.matchResultEvidence.create({ data: {
      matchId: a.match.id, resultVersionId: a.proposal.id, role: 'ADMIN', uploadedByAdminId: adminId,
      objectKey: `match-result-evidence-retained--${randomUUID()}.png`, mimeType: 'image/png', byteSize: 8,
      checksumSha256: 'c'.repeat(64)
    } });
    const lifecycle = new CompetitionsService(prisma, new MutationReceiptService(prisma));
    const current = await prisma.competition.findUniqueOrThrow({ where: { id: a.competition.id } });
    await lifecycle.transition(users[0]!, a.competition.id, 'CANCELLED', {
      expectedVersion: current.version, reason: '赛事终止'
    }, randomUUID());
    expect(await prisma.matchResultDispute.findUniqueOrThrow({ where: { id: a.dispute!.id } }))
      .toMatchObject({ status: 'CANCELLED', activeKey: null });
    expect(await prisma.matchResultEvidence.findUniqueOrThrow({ where: { uploadId: grant.id } }))
      .toMatchObject({ status: 'PENDING_DELETE', expiresAt: expect.any(Date) });
    expect(await prisma.matchResultEvidence.findUniqueOrThrow({ where: { id: nonDisputeEvidence.id } }))
      .toMatchObject({ status: 'PENDING_DELETE', expiresAt: expect.any(Date) });
    expect(await prisma.matchResultEvent.findFirst({ where: { disputeId: a.dispute!.id, type: 'DISPUTE_CANCELLED' as never } }))
      .toMatchObject({ actorType: 'USER', actorUserId: users[0], metadata: { reason: '赛事终止' } });
  });
});

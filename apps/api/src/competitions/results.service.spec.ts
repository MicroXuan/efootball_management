import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { jest } from '@jest/globals';
import { PrismaService } from '../database/prisma.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { ResultsService } from './results.service.js';
import { StandingsService } from './standings.service.js';
import { CupProgressionService } from './cup-progression.service.js';
import { MatchResultDisputesService } from './match-result-disputes.service.js';

config({ path: '../../.env', quiet: true });
jest.setTimeout(30_000);

describe('ResultsService', () => {
  const prisma = new PrismaService();
  const standings = new StandingsService(prisma);
  const service = new ResultsService(prisma, new MutationReceiptService(prisma), standings, new CupProgressionService());
  const disputes = new MatchResultDisputesService(prisma, new MutationReceiptService(prisma));
  const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
  const competitionIds: string[] = [];
  const leagueIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    const displayNames = ['主队', '客队', '局外人', '管理员'] as const;
    await prisma.user.createMany({ data: users.map((id, index) => ({
      id, wechatOpenId: `result-${id}`, displayName: displayNames[index]!
    })) });
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [...users] } } });
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: [...users] } } });
    await prisma.standingsRow.deleteMany({ where: { snapshot: { competitionId: { in: competitionIds } } } });
    await prisma.standingsSnapshot.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionMatch.updateMany({
      where: { stage: { competitionId: { in: competitionIds } } }, data: { officialResultVersionId: null }
    });
    await prisma.matchResultEvent.deleteMany({ where: { match: { stage: { competitionId: { in: competitionIds } } } } });
    await prisma.matchResultEvidence.deleteMany({ where: { match: { stage: { competitionId: { in: competitionIds } } } } });
    await prisma.matchResultEvidenceUpload.deleteMany({ where: { match: { stage: { competitionId: { in: competitionIds } } } } });
    await prisma.matchResultDispute.deleteMany({ where: { match: { stage: { competitionId: { in: competitionIds } } } } });
    await prisma.matchResultVersion.deleteMany({ where: { match: { stage: { competitionId: { in: competitionIds } } } } });
    await prisma.competitionMatch.deleteMany({ where: { stage: { competitionId: { in: competitionIds } } } });
    await prisma.competitionStage.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionParticipant.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionRegistration.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.gameAccount.deleteMany({ where: { userId: { in: [users[0], users[1]] } } });
    await prisma.competitionRuleVersion.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competition.deleteMany({ where: { id: { in: competitionIds } } });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    competitionIds.splice(0);
    leagueIds.splice(0);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
    await prisma.$disconnect();
  });

  async function fixture() {
    const competition = await prisma.competition.create({
      data: {
        name: '比分测试联赛', description: '', platform: 'MOBILE', serverRegion: 'GLOBAL',
        participantType: 'INDIVIDUAL', format: 'ROUND_ROBIN', status: 'IN_PROGRESS',
        registrationOpensAt: new Date('2026-09-01'), registrationClosesAt: new Date('2026-09-02'),
        startsAt: new Date('2026-09-03'), endsAt: new Date('2026-10-01'), participantLimit: 4,
        createdById: users[3], activeRuleVersion: 1, boundRuleVersion: 1
      }
    });
    competitionIds.push(competition.id);
    await prisma.competitionRuleVersion.create({
      data: { competitionId: competition.id, version: 1, winPoints: 3, drawPoints: 1, lossPoints: 0,
        tieBreakers: ['TOTAL_POINTS', 'TOTAL_GOAL_DIFFERENCE', 'TOTAL_GOALS'], createdById: users[3] }
    });
    const participants = [];
    for (let index = 0; index < 2; index += 1) {
      const account = await prisma.gameAccount.create({
        data: { userId: users[index]!, platform: 'MOBILE', serverRegion: 'GLOBAL', gamerTag: `Result-${index}` }
      });
      const registration = await prisma.competitionRegistration.create({
        data: { competitionId: competition.id, applicantId: users[index]!, gameAccountId: account.id,
          acceptedRuleVersion: 1, status: 'APPROVED' }
      });
      participants.push(await prisma.competitionParticipant.create({
        data: { competitionId: competition.id, registrationId: registration.id, individualUserId: users[index]!,
          admissionSequence: index + 1, displayNameSnapshot: index === 0 ? '主队' : '客队' }
      }));
    }
    const stage = await prisma.competitionStage.create({
      data: { competitionId: competition.id, sequence: 1, status: 'PUBLISHED', publishedAt: new Date() }
    });
    const match = await prisma.competitionMatch.create({
      data: { stageId: stage.id, roundNumber: 1, matchNumber: 1,
        pairingKey: `${participants[0]!.id}:${participants[1]!.id}`,
        homeParticipantId: participants[0]!.id, awayParticipantId: participants[1]!.id,
        status: 'AWAITING_RESULT' }
    });
    return { competition, match, participants };
  }

  async function requireEvidence(competitionId: string) {
    const league = await prisma.league.create({ data: {
      name: '截图联赛', shortName: '截图', defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL',
      createdById: users[3], resultEvidenceRequired: true
    } });
    leagueIds.push(league.id);
    const season = await prisma.leagueSeason.create({ data: {
      leagueId: league.id, seasonNumber: 1, displayName: 'S1', isFirstSeason: true,
      registrationOpensAt: new Date('2026-08-01'), registrationClosesAt: new Date('2026-08-10'),
      startsAt: new Date('2026-08-11'), endsAt: new Date('2026-12-01'),
      superCapacity: 2, championCapacity: 2, promotionCount: 1, status: 'IN_PROGRESS', createdById: users[3]
    } });
    await prisma.competition.update({ where: { id: competitionId }, data: { seasonId: season.id } });
  }

  async function uploadedEvidence(matchId: string, uploadedByUserId = users[0]) {
    return prisma.matchResultEvidenceUpload.create({ data: {
      matchId, role: 'SUBMITTER', uploadedByUserId,
      objectKey: `match-result-evidence/${randomUUID()}.png`, mimeType: 'image/png', byteSize: 8,
      checksumSha256: 'a'.repeat(64), status: 'UPLOADED', completedAt: new Date('2026-10-15T10:00:00.000Z'),
      expiresAt: new Date('2026-10-15T10:10:00.000Z')
    } });
  }

  it('submits without an image and records one pending result with an exact 24-hour deadline', async () => {
    const { match } = await fixture();
    const key = randomUUID();
    const proposal = await service.submit(users[0], match.id, { homeScore: 2, awayScore: 1, expectedVersion: 1 }, key);
    const retry = await service.submit(users[0], match.id, { homeScore: 2, awayScore: 1, expectedVersion: 1 }, key);
    const [stored, events] = await Promise.all([
      prisma.competitionMatch.findUniqueOrThrow({ where: { id: match.id } }),
      prisma.matchResultEvent.findMany({ where: { matchId: match.id } })
    ]);
    expect(retry).toEqual(proposal);
    expect(stored.status).toBe('PENDING_CONFIRMATION');
    expect(stored.officialResultVersionId).toBeNull();
    expect(events).toMatchObject([{ type: 'RESULT_SUBMITTED', actorType: 'USER', actorUserId: users[0], resultVersionId: proposal.id }]);
    expect(stored.resultConfirmationDeadlineAt?.getTime()).toBe(events[0]!.occurredAt.getTime() + 24 * 60 * 60 * 1000);
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id } })).toBe(1);
  });

  it('requires and atomically consumes one submitter upload when the league requires evidence', async () => {
    const { competition, match } = await fixture();
    await requireEvidence(competition.id);
    await expect(service.submit(users[0], match.id, { homeScore: 2, awayScore: 1, expectedVersion: 1 }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'RESULT_EVIDENCE_REQUIRED' } });
    const invalid = await uploadedEvidence(match.id, users[1]);
    await expect(service.submit(users[0], match.id, {
      homeScore: 2, awayScore: 1, evidenceUploadId: invalid.id, expectedVersion: 1
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'EVIDENCE_UPLOAD_INVALID' } });
    const upload = await uploadedEvidence(match.id);
    const input = { homeScore: 2, awayScore: 1, evidenceUploadId: upload.id, expectedVersion: 1 };
    const key = randomUUID();
    const proposal = await service.submit(users[0], match.id, input, key);
    expect(await service.submit(users[0], match.id, input, key)).toEqual(proposal);
    const evidence = await prisma.matchResultEvidence.findMany({ where: { matchId: match.id } });
    expect(evidence).toMatchObject([{ uploadId: upload.id, resultVersionId: proposal.id, role: 'SUBMITTER', uploadedByUserId: users[0] }]);
    expect(await prisma.matchResultEvidenceUpload.findUniqueOrThrow({ where: { id: upload.id } }))
      .toMatchObject({ status: 'CONSUMED', resultVersionId: proposal.id });
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'RESULT_SUBMITTED' } })).toBe(1);

    const other = await uploadedEvidence(match.id);
    await expect(service.submit(users[0], match.id, {
      homeScore: 3, awayScore: 1, evidenceUploadId: other.id, expectedVersion: 1
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    expect(await prisma.matchResultEvidenceUpload.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ status: 'UPLOADED' });
    expect(await prisma.matchResultEvidence.count({ where: { matchId: match.id } })).toBe(1);
    expect(await prisma.matchResultEvent.count({ where: { matchId: match.id, type: 'RESULT_SUBMITTED' } })).toBe(1);
  });

  it('confirms with the opponent actor, clears the deadline, and retains evidence for exactly 90 days', async () => {
    const { match } = await fixture();
    const upload = await uploadedEvidence(match.id);
    const proposal = await service.submit(users[0], match.id, {
      homeScore: 2, awayScore: 1, evidenceUploadId: upload.id, expectedVersion: 1
    }, randomUUID());
    await service.confirm(users[1], match.id, proposal.version, { expectedVersion: 2 }, randomUUID());
    const [stored, evidence, confirmed] = await Promise.all([
      prisma.competitionMatch.findUniqueOrThrow({ where: { id: match.id } }),
      prisma.matchResultEvidence.findUniqueOrThrow({ where: { uploadId: upload.id } }),
      prisma.matchResultEvent.findFirstOrThrow({ where: { matchId: match.id, type: 'RESULT_CONFIRMED' } })
    ]);
    expect(stored.status).toBe('CONFIRMED');
    expect(stored.officialResultVersionId).toBe(proposal.id);
    expect(stored.resultConfirmationDeadlineAt).toBeNull();
    expect(confirmed).toMatchObject({ actorType: 'USER', actorUserId: users[1], resultVersionId: proposal.id });
    expect(evidence.expiresAt?.getTime()).toBe(confirmed.occurredAt.getTime() + 90 * 24 * 60 * 60 * 1000);
  });

  it('replaces the previous active submitter evidence and records both evidence events on a newer proposal', async () => {
    const { competition, match } = await fixture();
    await requireEvidence(competition.id);
    const firstUpload = await uploadedEvidence(match.id, users[0]);
    await service.submit(users[0], match.id, {
      homeScore: 2, awayScore: 1, evidenceUploadId: firstUpload.id, expectedVersion: 1
    }, randomUUID());
    const secondUpload = await uploadedEvidence(match.id, users[1]);
    await service.submit(users[1], match.id, {
      homeScore: 1, awayScore: 2, evidenceUploadId: secondUpload.id, expectedVersion: 2
    }, randomUUID());

    expect(await prisma.matchResultEvidence.findMany({ where: { matchId: match.id }, orderBy: { createdAt: 'asc' } }))
      .toMatchObject([
        { uploadId: firstUpload.id, role: 'SUBMITTER', status: 'PENDING_DELETE' },
        { uploadId: secondUpload.id, role: 'SUBMITTER', status: 'ACTIVE' }
      ]);
    expect((await prisma.matchResultEvent.findMany({
      where: { matchId: match.id, type: { in: ['EVIDENCE_UPLOADED', 'EVIDENCE_REPLACED'] } },
      orderBy: { occurredAt: 'asc' }
    })).map(({ type }) => type)).toEqual(['EVIDENCE_UPLOADED', 'EVIDENCE_REPLACED']);
  });

  it('enforces participant ownership, rejection reason, confirmation separation, and history', async () => {
    const { match } = await fixture();
    await expect(service.submit(users[2], match.id, { homeScore: 2, awayScore: 1, expectedVersion: 1 }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'MATCH_NOT_FOUND' } });
    const proposal = await service.submit(users[0], match.id, { homeScore: 2, awayScore: 1, expectedVersion: 1 }, randomUUID());
    await expect(service.confirm(users[0], match.id, proposal.version, { expectedVersion: 2 }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'RESULT_SELF_CONFIRMATION_FORBIDDEN' } });
    await expect(service.reject(users[1], match.id, proposal.version, { expectedVersion: 2, reason: '' }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'RESULT_REJECTION_REASON_REQUIRED' } });
    await service.reject(users[1], match.id, proposal.version, { expectedVersion: 2, reason: '比分不符' }, randomUUID());
    expect(await prisma.competitionMatch.findUniqueOrThrow({ where: { id: match.id } }))
      .toMatchObject({ resultConfirmationDeadlineAt: null, status: 'DISPUTED' });
    expect(await prisma.matchResultEvent.findFirstOrThrow({ where: { matchId: match.id, type: 'RESULT_REJECTED' } }))
      .toMatchObject({ actorType: 'USER', actorUserId: users[1], resultVersionId: proposal.id, metadata: { reason: '比分不符' } });
    await expect(service.submit(users[0], match.id, { homeScore: 3, awayScore: 1, expectedVersion: 3 }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'MATCH_RESULT_NOT_ALLOWED' } });
    await expect(prisma.matchResultVersion.findMany({ where: { matchId: match.id }, orderBy: { version: 'asc' } }))
      .resolves.toMatchObject([{ status: 'REJECTED' }]);
    const dispute = await prisma.matchResultDispute.findUniqueOrThrow({ where: { activeKey: match.id } });
    const opened = await prisma.matchResultEvent.findFirstOrThrow({ where: { disputeId: dispute.id, type: 'DISPUTE_OPENED' } });
    expect(dispute).toMatchObject({ status: 'EVIDENCE_COLLECTION', trigger: 'REJECTED' });
    expect(dispute.evidenceDeadlineAt.getTime()).toBe(opened.occurredAt.getTime() + 86_400_000);
  });

  it.each(['confirm', 'timeout', 'reject'] as const)('serializes confirm, rejection and timeout-open with %s first', async (first) => {
    const { match } = await fixture();
    const proposal = await service.submit(users[0], match.id, { homeScore: 2, awayScore: 1, expectedVersion: 1 }, randomUUID());
    await prisma.competitionMatch.update({ where: { id: match.id }, data: { resultConfirmationDeadlineAt: new Date(0) } });
    const upload = await uploadedEvidence(match.id);
    const actions = {
      confirm: () => service.confirm(users[1], match.id, proposal.version, { expectedVersion: 2 }, randomUUID()),
      timeout: () => disputes.openFromTimeout(users[0], match.id, { expectedVersion: 2, evidenceUploadId: upload.id }, randomUUID()),
      reject: () => service.reject(users[1], match.id, proposal.version, { expectedVersion: 2, reason: '错误' }, randomUUID())
    };
    const order = [first, ...(['confirm', 'timeout', 'reject'] as const).filter((action) => action !== first)];
    const outcomes = await Promise.allSettled(order.map((action) => actions[action]()));
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    for (const outcome of outcomes.filter(({ status }) => status === 'rejected')) {
      expect(outcome).toMatchObject({ reason: { response: { code: 'VERSION_CONFLICT' } } });
    }
    const stored = await prisma.competitionMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(stored.version).toBe(3);
    expect(await prisma.matchResultDispute.count({ where: { activeKey: match.id } })).toBe(stored.status === 'DISPUTED' ? 1 : 0);
  });

  it('requires a reason for manager correction and preserves immutable standings snapshots', async () => {
    const { competition, match, participants } = await fixture();
    const first = await service.recordByManager(users[3], competition.id, match.id,
      { homeScore: 1, awayScore: 0, expectedVersion: 1, reason: '管理员录入' }, randomUUID());
    await expect(service.recordByManager(users[3], competition.id, match.id,
      { homeScore: 0, awayScore: 2, expectedVersion: 2, reason: '' }, randomUUID()))
      .rejects.toMatchObject({ response: { code: 'RESULT_CORRECTION_REASON_REQUIRED' } });
    await service.recordByManager(users[3], competition.id, match.id,
      { homeScore: 0, awayScore: 2, expectedVersion: 2, reason: '赛后复核' }, randomUUID());
    const versions = await prisma.matchResultVersion.findMany({ where: { matchId: match.id }, orderBy: { version: 'asc' } });
    expect(versions.map(({ status }) => status)).toEqual(['SUPERSEDED', 'OFFICIAL']);
    expect(first.status).toBe('OFFICIAL');
    const snapshots = await prisma.standingsSnapshot.findMany({
      where: { competitionId: competition.id }, include: { rows: true }, orderBy: { version: 'asc' }
    });
    expect(snapshots.map(({ version }) => version)).toEqual([1, 2]);
    expect(snapshots[0]!.rows.find(({ participantId }) => participantId === participants[0]!.id)?.totalPoints).toBe(3);
    expect(snapshots[0]!.rows.find(({ participantId }) => participantId === participants[1]!.id)?.totalPoints).toBe(0);
    expect(snapshots[1]!.rows.find(({ participantId }) => participantId === participants[0]!.id)?.totalPoints).toBe(0);
    expect(snapshots[1]!.rows.find(({ participantId }) => participantId === participants[1]!.id)?.totalPoints).toBe(3);
  });

  it('allows only one concurrent confirmation and creates one snapshot', async () => {
    const { competition, match } = await fixture();
    const home = await service.submit(users[0], match.id, { homeScore: 2, awayScore: 0, expectedVersion: 1 }, randomUUID());
    const away = await service.submit(users[1], match.id, { homeScore: 0, awayScore: 1, expectedVersion: 2 }, randomUUID());
    const outcomes = await Promise.allSettled([
      service.confirm(users[1], match.id, home.version, { expectedVersion: 3 }, randomUUID()),
      service.confirm(users[0], match.id, away.version, { expectedVersion: 3 }, randomUUID())
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')[0]).toMatchObject({
      reason: { response: { code: 'VERSION_CONFLICT' } }
    });
    await expect(prisma.matchResultVersion.count({ where: { matchId: match.id, status: 'OFFICIAL' } })).resolves.toBe(1);
    await expect(prisma.standingsSnapshot.count({ where: { competitionId: competition.id } })).resolves.toBe(1);
  });
});

describe('team match ownership', () => {
  function teamHarness() {
    const match = {
      id: 'match-1', stageId: 'stage-1', version: 1, status: 'AWAITING_RESULT',
      officialResultVersion: null,
      stage: { status: 'PUBLISHED', competitionId: 'competition-1', competition: {
        id: 'competition-1', status: 'IN_PROGRESS', competitionType: 'DIVISION_LEAGUE'
      } },
      homeParticipant: {
        id: 'home', individualUserId: null, seasonEntry: { ownerUserId: 'owner-home' }
      },
      awayParticipant: {
        id: 'away', individualUserId: null, seasonEntry: { ownerUserId: 'owner-away' }
      }
    };
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competitionMatch: {
        findUnique: jest.fn(async () => match),
        updateMany: jest.fn(async () => ({ count: 1 }))
      },
      matchResultVersion: {
        aggregate: jest.fn(async () => ({ _max: { version: null } })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'result-1', ...data, status: 'PROPOSED', reason: null, createdAt: new Date('2026-10-03')
        }))
      }
    };
    const receipts = { execute: jest.fn(async (
      _actor: string, _operation: string, _key: string,
      work: (client: typeof transaction) => Promise<unknown>
    ) => work(transaction)) };
    const service = new ResultsService(
      transaction as never, receipts as never, {} as never, {} as never,
      { requireVisible: jest.fn(async () => null), notFound: jest.fn() } as never,
      undefined, undefined, undefined, { append: jest.fn(async () => undefined) } as never
    );
    return { service };
  }

  it('allows either team owner to act and hides the match from outsiders', async () => {
    const home = teamHarness().service;
    await expect(home.submit('owner-home', 'match-1', {
      homeScore: 2, awayScore: 1, expectedVersion: 1
    }, 'home-submit')).resolves.toMatchObject({ submissionSide: 'HOME' });

    const away = teamHarness().service;
    await expect(away.submit('owner-away', 'match-1', {
      homeScore: 1, awayScore: 1, expectedVersion: 1
    }, 'away-submit')).resolves.toMatchObject({ submissionSide: 'AWAY' });

    const outsider = teamHarness().service;
    await expect(outsider.submit('outsider', 'match-1', {
      homeScore: 0, awayScore: 0, expectedVersion: 1
    }, 'outsider-submit')).rejects.toMatchObject({ response: { code: 'MATCH_NOT_FOUND' } });
  });
});

describe('cup match results', () => {
  function managerHarness(format: 'ROUND_ROBIN' | 'SINGLE_ELIMINATION') {
    const match = {
      id: 'match-1', stageId: 'stage-1', version: 1, status: 'AWAITING_RESULT',
      officialResultVersion: null,
      stage: {
        id: 'stage-1', status: 'PUBLISHED', format, competitionId: 'cup-1',
        competition: { id: 'cup-1', status: 'IN_PROGRESS', competitionType: 'GROUP_KNOCKOUT_CUP' }
      },
      homeParticipant: { id: 'home', individualUserId: null, seasonEntry: { ownerUserId: 'home-owner' } },
      awayParticipant: { id: 'away', individualUserId: null, seasonEntry: { ownerUserId: 'away-owner' } }
    };
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competitionMatch: {
        findUnique: jest.fn(async () => match),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 }))
      },
      matchResultDispute: { findUnique: jest.fn(async () => null) },
      matchResultEvidence: { updateMany: jest.fn(async () => ({ count: 0 })) },
      matchResultEvent: { createMany: jest.fn(async () => ({ count: 1 })) },
      auditLog: { create: jest.fn(async () => ({})) },
      matchResultVersion: {
        aggregate: jest.fn(async () => ({ _max: { version: null } })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'result-1', status: 'OFFICIAL', reason: null, createdAt: new Date('2026-10-03'), ...data
        }))
      }
    };
    const receipts = { execute: jest.fn(async (
      _actor: string, _operation: string, _key: string,
      work: (client: typeof transaction) => Promise<unknown>
    ) => work(transaction)) };
    const standings = { recalculate: jest.fn(async () => ({})) };
    const progression = { lockCompetition: jest.fn(async () => undefined), recordWinner: jest.fn(async () => undefined) };
    return {
      service: new ResultsService(
        transaction as never, receipts as never, standings as never, progression as never,
        { requireVisible: jest.fn(async () => null), notFound: jest.fn() } as never
      ),
      transaction,
      standings,
      progression
    };
  }

  it('rejects a draw before writing an official knockout result', async () => {
    const { service, transaction } = managerHarness('SINGLE_ELIMINATION');

    await expect(service.recordByManager('admin-1', 'cup-1', 'match-1', {
      homeScore: 2, awayScore: 2, expectedVersion: 1, reason: '管理员录入'
    }, 'draw')).rejects.toMatchObject({ response: { code: 'KNOCKOUT_DRAW_NOT_ALLOWED' } });
    expect(transaction.matchResultVersion.create).not.toHaveBeenCalled();
  });

  it('recalculates group standings by stage and advances an official knockout winner', async () => {
    const group = managerHarness('ROUND_ROBIN');
    await group.service.recordByManager('admin-1', 'cup-1', 'match-1', {
      homeScore: 1, awayScore: 1, expectedVersion: 1, reason: '管理员录入'
    }, 'group-result');
    expect(group.standings.recalculate).toHaveBeenCalledWith(
      group.transaction, 'cup-1', 'result-1', 'stage-1'
    );
    expect(group.progression.recordWinner).not.toHaveBeenCalled();

    const knockout = managerHarness('SINGLE_ELIMINATION');
    await knockout.service.recordByManager('admin-1', 'cup-1', 'match-1', {
      homeScore: 3, awayScore: 1, expectedVersion: 1, reason: '管理员录入'
    }, 'knockout-result');
    expect(knockout.standings.recalculate).not.toHaveBeenCalled();
    expect(knockout.progression.recordWinner).toHaveBeenCalledWith(
      knockout.transaction, 'match-1', 3, 1, true
    );
  });
});

describe('league administrator match results', () => {
  it('records the admin actor, publishes an official score, and audits the change', async () => {
    const match = {
      id: 'match-1', stageId: 'stage-1', version: 1, status: 'AWAITING_RESULT',
      officialResultVersion: null,
      stage: {
        id: 'stage-1', status: 'PUBLISHED', format: 'ROUND_ROBIN', competitionId: 'competition-1',
        competition: { id: 'competition-1', seasonId: 'season-1', status: 'IN_PROGRESS', competitionType: 'DIVISION_LEAGUE', season: { leagueId: 'league-1', league: { id: 'league-1', isDeleted: false } } }
      },
      homeParticipant: { id: 'home', individualUserId: null, seasonEntry: { ownerUserId: 'home-owner', leagueTeam: { status: 'ACTIVE' } } },
      awayParticipant: { id: 'away', individualUserId: null, seasonEntry: { ownerUserId: 'away-owner', leagueTeam: { status: 'ACTIVE' } } }
    };
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competitionMatch: {
        findUnique: jest.fn(async () => match),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 }))
      },
      matchResultDispute: {
        findUnique: jest.fn(async () => ({ id: 'dispute-1', status: 'READY_FOR_REVIEW' })),
        update: jest.fn(async () => ({}))
      },
      matchResultEvidence: { updateMany: jest.fn(async () => ({ count: 0 })) },
      matchResultEvent: { createMany: jest.fn(async () => ({ count: 1 })) },
      matchResultVersion: {
        aggregate: jest.fn(async () => ({ _max: { version: null } })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'result-1', status: 'OFFICIAL', reason: null, createdAt: new Date('2026-10-08'), ...data
        }))
      }
    };
    const receipts = { execute: jest.fn(async (
      _actor: string, _operation: string, _key: string,
      work: (client: typeof transaction) => Promise<unknown>
    ) => work(transaction)) };
    const standings = { recalculate: jest.fn(async () => ({})) };
    const authorization = { requireLeagueAccess: jest.fn(async () => ({ id: 'admin-1' })) };
    const audit = { record: jest.fn(async () => ({})) };
    const service = new ResultsService(
      transaction as never, {} as never, standings as never, new CupProgressionService(),
      { requireVisible: jest.fn(async () => 'league-1'), notFound: jest.fn(() => new Error('not found')) } as never,
      receipts as never,
      authorization as never,
      audit as never
    );
    const record = (service as unknown as {
      recordByLeagueAdmin: (
        adminId: string, leagueId: string, competitionId: string, matchId: string,
        input: { homeScore: number; awayScore: number; expectedVersion: number; reason: string }, key: string
      ) => Promise<{ status: string; submittedByMe: boolean }>
    }).recordByLeagueAdmin;

    await expect(record.call(service, 'admin-1', 'league-1', 'competition-1', 'match-1', {
      homeScore: 2, awayScore: 1, expectedVersion: 1, reason: '管理员录入'
    }, 'admin-result')).resolves.toMatchObject({ status: 'OFFICIAL', submittedByMe: true });
    expect(transaction.matchResultVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      submittedById: null, submittedByAdminId: 'admin-1', homeScore: 2, awayScore: 1
    }) });
    expect(standings.recalculate).toHaveBeenCalledWith(transaction, 'competition-1', 'result-1', 'stage-1');
    expect(transaction.matchResultDispute.update).toHaveBeenCalledWith({
      where: { id: 'dispute-1' },
      data: expect.objectContaining({
        status: 'RESOLVED', activeKey: null, finalHomeScore: 2, finalAwayScore: 1,
        decidedByAdminId: 'admin-1'
      })
    });
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({
      actorAdminId: 'admin-1', leagueId: 'league-1', action: 'admin.competition-result.record'
    }));
  });
});

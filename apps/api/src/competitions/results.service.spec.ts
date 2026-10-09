import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { jest } from '@jest/globals';
import { PrismaService } from '../database/prisma.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { ResultsService } from './results.service.js';
import { StandingsService } from './standings.service.js';
import { CupProgressionService } from './cup-progression.service.js';

config({ path: '../../.env', quiet: true });

describe('ResultsService', () => {
  const prisma = new PrismaService();
  const standings = new StandingsService(prisma);
  const service = new ResultsService(prisma, new MutationReceiptService(prisma), standings, new CupProgressionService());
  const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
  const competitionIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    const displayNames = ['主队', '客队', '局外人', '管理员'] as const;
    await prisma.user.createMany({ data: users.map((id, index) => ({
      id, wechatOpenId: `result-${id}`, displayName: displayNames[index]!
    })) });
  });

  afterEach(async () => {
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: [...users] } } });
    await prisma.standingsRow.deleteMany({ where: { snapshot: { competitionId: { in: competitionIds } } } });
    await prisma.standingsSnapshot.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionMatch.updateMany({
      where: { stage: { competitionId: { in: competitionIds } } }, data: { officialResultVersionId: null }
    });
    await prisma.matchResultVersion.deleteMany({ where: { match: { stage: { competitionId: { in: competitionIds } } } } });
    await prisma.competitionMatch.deleteMany({ where: { stage: { competitionId: { in: competitionIds } } } });
    await prisma.competitionStage.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionParticipant.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionRegistration.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.gameAccount.deleteMany({ where: { userId: { in: [users[0], users[1]] } } });
    await prisma.competitionRuleVersion.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competition.deleteMany({ where: { id: { in: competitionIds } } });
    competitionIds.splice(0);
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
    const second = await service.submit(users[0], match.id, { homeScore: 3, awayScore: 1, expectedVersion: 3 }, randomUUID());
    const official = await service.confirm(users[1], match.id, second.version, { expectedVersion: 4 }, randomUUID());
    expect(official.status).toBe('OFFICIAL');
    await expect(prisma.matchResultVersion.findMany({ where: { matchId: match.id }, orderBy: { version: 'asc' } }))
      .resolves.toMatchObject([{ status: 'REJECTED' }, { status: 'OFFICIAL' }]);
  });

  it('requires a reason for manager correction and preserves immutable standings snapshots', async () => {
    const { competition, match, participants } = await fixture();
    const first = await service.recordByManager(users[3], competition.id, match.id,
      { homeScore: 1, awayScore: 0, expectedVersion: 1 }, randomUUID());
    await expect(service.recordByManager(users[3], competition.id, match.id,
      { homeScore: 0, awayScore: 2, expectedVersion: 2 }, randomUUID()))
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
      { requireVisible: jest.fn(async () => null), notFound: jest.fn() } as never
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
        updateMany: jest.fn(async () => ({ count: 1 }))
      },
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
    const progression = { recordWinner: jest.fn(async () => undefined) };
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
      homeScore: 2, awayScore: 2, expectedVersion: 1
    }, 'draw')).rejects.toMatchObject({ response: { code: 'KNOCKOUT_DRAW_NOT_ALLOWED' } });
    expect(transaction.matchResultVersion.create).not.toHaveBeenCalled();
  });

  it('recalculates group standings by stage and advances an official knockout winner', async () => {
    const group = managerHarness('ROUND_ROBIN');
    await group.service.recordByManager('admin-1', 'cup-1', 'match-1', {
      homeScore: 1, awayScore: 1, expectedVersion: 1
    }, 'group-result');
    expect(group.standings.recalculate).toHaveBeenCalledWith(
      group.transaction, 'cup-1', 'result-1', 'stage-1'
    );
    expect(group.progression.recordWinner).not.toHaveBeenCalled();

    const knockout = managerHarness('SINGLE_ELIMINATION');
    await knockout.service.recordByManager('admin-1', 'cup-1', 'match-1', {
      homeScore: 3, awayScore: 1, expectedVersion: 1
    }, 'knockout-result');
    expect(knockout.standings.recalculate).not.toHaveBeenCalled();
    expect(knockout.progression.recordWinner).toHaveBeenCalledWith(
      knockout.transaction, 'match-1', 3, 1
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
        competition: { id: 'competition-1', seasonId: 'season-1', status: 'IN_PROGRESS', competitionType: 'DIVISION_LEAGUE', season: { leagueId: 'league-1' } }
      },
      homeParticipant: { id: 'home', individualUserId: null, seasonEntry: { ownerUserId: 'home-owner', leagueTeam: { status: 'ACTIVE' } } },
      awayParticipant: { id: 'away', individualUserId: null, seasonEntry: { ownerUserId: 'away-owner', leagueTeam: { status: 'ACTIVE' } } }
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
      transaction as never, {} as never, standings as never, {} as never,
      { requireVisible: jest.fn(async () => 'league-1'), notFound: jest.fn(() => new Error('not found')) } as never,
      receipts as never,
      authorization as never,
      audit as never
    );
    const record = (service as unknown as {
      recordByLeagueAdmin: (
        adminId: string, leagueId: string, competitionId: string, matchId: string,
        input: { homeScore: number; awayScore: number; expectedVersion: number }, key: string
      ) => Promise<{ status: string; submittedByMe: boolean }>
    }).recordByLeagueAdmin;

    await expect(record.call(service, 'admin-1', 'league-1', 'competition-1', 'match-1', {
      homeScore: 2, awayScore: 1, expectedVersion: 1
    }, 'admin-result')).resolves.toMatchObject({ status: 'OFFICIAL', submittedByMe: true });
    expect(transaction.matchResultVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      submittedById: null, submittedByAdminId: 'admin-1', homeScore: 2, awayScore: 1
    }) });
    expect(standings.recalculate).toHaveBeenCalledWith(transaction, 'competition-1', 'result-1', 'stage-1');
    expect(audit.record).toHaveBeenCalledWith(transaction, expect.objectContaining({
      actorAdminId: 'admin-1', leagueId: 'league-1', action: 'admin.competition-result.record'
    }));
  });
});

import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { jest } from '@jest/globals';
import { PrismaService } from '../database/prisma.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { SchedulesService } from './schedules.service.js';
import { generateRoundRobin } from './domain/round-robin.js';

config({ path: '../../.env', quiet: true });

describe('SchedulesService', () => {
  const prisma = new PrismaService();
  const service = new SchedulesService(prisma, new MutationReceiptService(prisma), generateRoundRobin);
  const actorId = randomUUID();
  const userIds = Array.from({ length: 5 }, () => randomUUID());
  const competitionIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({ data: [actorId, ...userIds].map((id, index) => ({
      id,
      wechatOpenId: `schedule-${id}`,
      displayName: index === 0 ? '赛程管理员' : `赛程玩家${index}`
    })) });
  });

  afterEach(async () => {
    await prisma.mutationReceipt.deleteMany({ where: { actorId } });
    await prisma.competitionMatch.deleteMany({ where: { stage: { competitionId: { in: competitionIds } } } });
    await prisma.competitionStage.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionParticipant.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionRegistrationStatusHistory.deleteMany({
      where: { registration: { competitionId: { in: competitionIds } } }
    });
    await prisma.competitionRegistration.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionRuleVersion.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.gameAccount.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.competition.deleteMany({ where: { id: { in: competitionIds } } });
    competitionIds.splice(0);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [actorId, ...userIds] } } });
    await prisma.$disconnect();
  });

  async function competition(participantCount: number, status: 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' = 'REGISTRATION_CLOSED') {
    const event = await prisma.competition.create({
      data: {
        name: `赛程测试 ${participantCount}`,
        description: '',
        platform: 'MOBILE',
        serverRegion: 'GLOBAL',
        participantType: 'INDIVIDUAL',
        format: 'ROUND_ROBIN',
        status,
        registrationOpensAt: new Date('2026-09-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-09-20T00:00:00.000Z'),
        startsAt: new Date('2026-10-01T00:00:00.000Z'),
        endsAt: new Date('2026-11-01T00:00:00.000Z'),
        participantLimit: 8,
        createdById: actorId,
        boundRuleVersion: 1
      }
    });
    competitionIds.push(event.id);
    await prisma.competitionRuleVersion.create({
      data: {
        competitionId: event.id,
        version: 1,
        winPoints: 3,
        drawPoints: 1,
        lossPoints: 0,
        tieBreakers: ['TOTAL_POINTS'],
        createdById: actorId
      }
    });
    for (let index = 0; index < participantCount; index += 1) {
      const account = await prisma.gameAccount.create({
        data: { userId: userIds[index]!, platform: 'MOBILE', serverRegion: 'GLOBAL', gamerTag: `Schedule-${index}` }
      });
      const registration = await prisma.competitionRegistration.create({
        data: {
          competitionId: event.id,
          applicantId: userIds[index]!,
          gameAccountId: account.id,
          acceptedRuleVersion: 1,
          status: 'APPROVED'
        }
      });
      await prisma.competitionParticipant.create({
        data: {
          competitionId: event.id,
          registrationId: registration.id,
          individualUserId: userIds[index]!,
          admissionSequence: index + 1,
          displayNameSnapshot: `赛程玩家${index + 1}`
        }
      });
    }
    return event;
  }

  it('requires registration closed and at least two approved participants', async () => {
    const open = await competition(2, 'REGISTRATION_OPEN');
    await expect(service.generate(actorId, open.id, randomUUID())).rejects.toMatchObject({
      response: { code: 'SCHEDULE_GENERATION_NOT_ALLOWED' }
    });
    const short = await competition(1);
    await expect(service.generate(actorId, short.id, randomUUID())).rejects.toMatchObject({
      response: { code: 'SCHEDULE_PARTICIPANTS_INSUFFICIENT' }
    });
  });

  it('generates stable four-player and five-player round robins', async () => {
    const four = await competition(4);
    const first = await service.generate(actorId, four.id, randomUUID());
    const second = await service.generate(actorId, four.id, randomUUID());
    expect(first.roundCount).toBe(3);
    expect(first.matches).toHaveLength(6);
    expect(new Set(first.matches.map(({ pairingKey }) => pairingKey)).size).toBe(6);
    expect(second.matches.map(({ pairingKey, roundNumber, matchNumber }) => ({ pairingKey, roundNumber, matchNumber })))
      .toEqual(first.matches.map(({ pairingKey, roundNumber, matchNumber }) => ({ pairingKey, roundNumber, matchNumber })));
    await expect(prisma.competitionStage.count({ where: { competitionId: four.id } })).resolves.toBe(1);

    const five = await competition(5);
    const odd = await service.generate(actorId, five.id, randomUUID());
    expect(odd.roundCount).toBe(5);
    expect(odd.matches).toHaveLength(10);
    for (let round = 1; round <= 5; round += 1) {
      const appearances = odd.matches.filter((match) => match.roundNumber === round)
        .flatMap((match) => [match.homeParticipant.id, match.awayParticipant.id]);
      expect(appearances).toHaveLength(4);
      expect(new Set(appearances).size).toBe(4);
    }
  });

  it('publishes atomically and prevents regeneration after publication', async () => {
    const event = await competition(4);
    const draft = await service.generate(actorId, event.id, 'generate-once');
    const replay = await service.generate(actorId, event.id, 'generate-once');
    expect(replay).toEqual(draft);

    await expect(service.publish(actorId, event.id, {
      expectedCompetitionVersion: event.version,
      expectedStageVersion: draft.version + 1
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });

    const published = await service.publish(actorId, event.id, {
      expectedCompetitionVersion: event.version,
      expectedStageVersion: draft.version
    }, randomUUID());
    expect(published.status).toBe('PUBLISHED');
    await expect(prisma.competition.findUniqueOrThrow({ where: { id: event.id } }))
      .resolves.toMatchObject({ status: 'SCHEDULED', version: event.version + 1 });
    await expect(service.generate(actorId, event.id, randomUUID())).rejects.toMatchObject({
      response: { code: 'SCHEDULE_ALREADY_PUBLISHED' }
    });
    await expect(service.listPublic(event.id)).resolves.toHaveLength(6);
  });

  it('rolls back draft replacement when regenerated matches cannot be inserted', async () => {
    const event = await competition(4);
    const original = await service.generate(actorId, event.id, randomUUID());
    const invalidGenerator = (ids: readonly string[]) => [
      {
        roundNumber: 1,
        matchNumber: 1,
        homeParticipantId: ids[0]!,
        awayParticipantId: ids[1]!,
        pairingKey: `${ids[0]}:${ids[1]}`
      },
      {
        roundNumber: 1,
        matchNumber: 2,
        homeParticipantId: ids[1]!,
        awayParticipantId: ids[0]!,
        pairingKey: `${ids[0]}:${ids[1]}`
      }
    ];
    const failing = new SchedulesService(prisma, new MutationReceiptService(prisma), invalidGenerator);

    await expect(failing.generate(actorId, event.id, randomUUID())).rejects.toBeDefined();
    const restored = await service.preview(event.id);
    expect(restored.id).toBe(original.id);
    expect(restored.matches.map(({ id }) => id)).toEqual(original.matches.map(({ id }) => id));
  });
});

describe('tiered stage schedules', () => {
  function stageHarness(participantCount = 3) {
    const now = new Date('2026-10-03T00:00:00.000Z');
    const participants = Array.from({ length: participantCount }, (_, index) => ({
      id: `participant-${index + 1}`,
      competitionId: 'competition-1',
      participantType: 'TEAM',
      displayNameSnapshot: `球队 ${index + 1}`
    }));
    let matchData: Array<Record<string, unknown>> = [];
    const stage = {
      id: 'stage-1', competitionId: 'competition-1', stageCode: 'CHAMPION_A', displayName: '冠军 A 组',
      sequence: 1, capacity: 18, format: 'ROUND_ROBIN', status: 'DRAFT', version: 1,
      createdAt: now, updatedAt: now,
      competition: {
        id: 'competition-1', seasonId: 'season-1', competitionType: 'DIVISION_LEAGUE', status: 'DRAFT',
        season: { id: 'season-1', leagueId: 'league-1', status: 'READY', version: 4 }
      },
      participants: participants.map((participant, index) => ({
        seed: index + 1, participant
      }))
    };
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competitionStage: {
        findUnique: jest.fn(async () => stage),
        updateMany: jest.fn(async () => ({ count: 1 }))
      },
      competitionMatch: {
        deleteMany: jest.fn(async () => ({ count: matchData.length })),
        createMany: jest.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          matchData = data;
          return { count: data.length };
        }),
        findMany: jest.fn(async () => matchData.map((match, index) => {
          const home = participants.find((participant) => participant.id === match.homeParticipantId)!;
          const away = participants.find((participant) => participant.id === match.awayParticipantId)!;
          return {
            id: `match-${index + 1}`, ...match, plannedAt: null, status: 'SCHEDULED', version: 1,
            createdAt: now, updatedAt: now, homeParticipant: home, awayParticipant: away,
            officialResultVersion: null
          };
        }))
      },
      leagueSeason: {
        findFirst: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 1 }))
      },
      competition: { updateMany: jest.fn(async () => ({ count: 1 })) }
    };
    const adminReceipts = {
      execute: jest.fn(async (
        _actor: string, _operation: string, _key: string,
        work: (client: typeof transaction) => Promise<unknown>
      ) => work(transaction))
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new SchedulesService(
      transaction as never,
      {} as never,
      generateRoundRobin,
      adminReceipts as never,
      audit as never,
      { requireVisible: jest.fn(async () => 'league-1') } as never
    );
    return { service, transaction, stage };
  }

  it('generates matches from only the selected stage members, including odd-sized groups', async () => {
    const { service, transaction } = stageHarness(3);
    const preview = await service.generateStage('admin-1', 'league-1', 'stage-1', {
      expectedStageVersion: 1
    }, 'stage-generate');

    expect(preview).toMatchObject({ id: 'stage-1', competitionId: 'competition-1', roundCount: 3, matchCount: 3 });
    expect(transaction.competitionMatch.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ stageId: 'stage-1' })])
    });
    expect(preview.matches.every((match) => ['participant-1', 'participant-2', 'participant-3']
      .includes(match.homeParticipant.id) && ['participant-1', 'participant-2', 'participant-3']
      .includes(match.awayParticipant.id))).toBe(true);
  });

  it('allows an empty single-team schedule and advances the season on first publication', async () => {
    const { service, transaction, stage } = stageHarness(1);
    const draft = await service.generateStage('admin-1', 'league-1', 'stage-1', {
      expectedStageVersion: 1
    }, 'single-generate');
    expect(draft).toMatchObject({ matchCount: 0, roundCount: 0 });
    stage.version = draft.version;

    const published = await service.publishStage('admin-1', 'league-1', 'stage-1', {
      expectedStageVersion: draft.version,
      expectedSeasonVersion: 4
    }, 'single-publish');
    expect(published.status).toBe('PUBLISHED');
    expect(transaction.leagueSeason.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'season-1', status: 'READY', version: 4 },
      data: { status: 'IN_PROGRESS', version: { increment: 1 } }
    }));
  });
});

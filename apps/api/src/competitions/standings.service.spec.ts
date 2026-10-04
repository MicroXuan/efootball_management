import { config } from 'dotenv';
import { jest } from '@jest/globals';
import { PrismaService } from '../database/prisma.service.js';
import { StandingsService } from './standings.service.js';

config({ path: '../../.env', quiet: true });

describe('StandingsService', () => {
  const prisma = new PrismaService();
  const service = new StandingsService(prisma);

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  it('returns an empty version-zero public snapshot before any official result', async () => {
    await expect(service.getLatestPublic('00000000-0000-4000-8000-000000000000')).resolves.toEqual({
      competitionId: '00000000-0000-4000-8000-000000000000',
      version: 0,
      ruleVersion: 1,
      triggeringResultVersionId: null,
      generatedAt: null,
      rows: []
    });
  });
});

describe('stage-scoped standings', () => {
  it('returns every published group with zero rows before any official result', async () => {
    const participant = {
      id: 'participant-1', seasonEntryId: 'entry-1', displayNameSnapshot: '海港', admissionSequence: 1
    };
    const prisma = {
      seasonEntry: { findFirst: jest.fn(async () => ({ id: 'entry-1' })) },
      competition: { findFirst: jest.fn(async () => ({
        id: 'competition-1',
        stages: [{
          id: 'stage-a', competitionId: 'competition-1', stageCode: 'CHAMPION_A', displayName: '冠军 A 组',
          sequence: 1, capacity: 18, format: 'ROUND_ROBIN', status: 'PUBLISHED', version: 2,
          participants: [{ seed: 1, participant }], standingsSnapshots: []
        }, {
          id: 'stage-b', competitionId: 'competition-1', stageCode: 'CHAMPION_B', displayName: '冠军 B 组',
          sequence: 2, capacity: 18, format: 'ROUND_ROBIN', status: 'PUBLISHED', version: 2,
          participants: [], standingsSnapshots: []
        }]
      })) }
    };
    const service = new StandingsService(prisma as never);

    const response = await service.getDivisionStandings('user-1', 'league-1', 'season-1');
    expect(response).toMatchObject({ myStageId: 'stage-a' });
    expect(response.groups.map((group) => group.stage.stageCode)).toEqual(['CHAMPION_A', 'CHAMPION_B']);
    expect(response.groups[0]!.standings.rows[0]).toMatchObject({
      played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0,
      goalDifference: 0, totalPoints: 0
    });
    expect(response.groups[1]!.standings.rows).toEqual([]);
  });

  it('rejects users without an approved entry and scopes recalculation to one stage', async () => {
    const denied = new StandingsService({
      seasonEntry: { findFirst: jest.fn(async () => null) }
    } as never);
    await expect(denied.getDivisionStandings('outsider', 'league-1', 'season-1'))
      .rejects.toMatchObject({ response: { code: 'DIVISION_STANDINGS_FORBIDDEN' } });

    const transaction = {
      competition: { findUniqueOrThrow: jest.fn(async () => ({
        id: 'competition-1', competitionType: 'DIVISION_LEAGUE', activeRuleVersion: 1, boundRuleVersion: null
      })) },
      competitionRuleVersion: { findUnique: jest.fn(async () => null) },
      stageParticipant: { findMany: jest.fn(async () => [{ participant: {
        id: 'participant-a', admissionSequence: 1, displayNameSnapshot: 'A 队'
      } }]) },
      competitionParticipant: { findMany: jest.fn(async () => []) },
      competitionMatch: { findMany: jest.fn(async () => []) },
      standingsSnapshot: {
        aggregate: jest.fn(async () => ({ _max: { version: null } })),
        create: jest.fn(async () => ({ id: 'snapshot-a', version: 1, generatedAt: new Date('2026-10-03') }))
      },
      standingsRow: { createMany: jest.fn(async () => ({ count: 1 })) }
    };
    const service = new StandingsService({} as never);
    const snapshot = await service.recalculate(transaction as never, 'competition-1', 'result-1', 'stage-a');
    expect(snapshot).toMatchObject({ stageId: 'stage-a', version: 1 });
    expect(transaction.competitionMatch.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stageId: 'stage-a' })
    }));
    expect(transaction.standingsSnapshot.aggregate).toHaveBeenCalledWith({
      where: { competitionId: 'competition-1', stageId: 'stage-a' }, _max: { version: true }
    });
  });
});

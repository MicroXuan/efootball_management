import { jest } from '@jest/globals';
import { SchedulesService } from './schedules.service.js';
import { generateRoundRobin } from './domain/round-robin.js';

const homeId = '11111111-1111-4111-8111-111111111111';
const awayId = '22222222-2222-4222-8222-222222222222';

function harness(options: { duplicate?: boolean; roundConflict?: boolean } = {}) {
  const transaction = {
    $queryRaw: jest.fn(async () => []),
    competitionStage: {
      findUnique: jest.fn(async () => ({
        id: 'stage-1', version: 2, status: 'PUBLISHED', competitionId: 'competition-1',
        competition: { competitionType: 'DIVISION_LEAGUE', season: { id: 'season-1', leagueId: 'league-1', status: 'IN_PROGRESS', version: 4 } },
        participants: [{ participantId: homeId }, { participantId: awayId }]
      })),
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    competitionMatch: {
      findUnique: jest.fn(async () => options.duplicate ? { id: 'old-match' } : null),
      findFirst: jest.fn(async (query: { where: { roundNumber?: number } }) =>
        query.where.roundNumber ? (options.roundConflict ? { id: 'round-match' } : null) : { matchNumber: 3 }),
      create: jest.fn(async () => ({ id: 'new-match' }))
    }
  };
  const receipts = { execute: jest.fn(async (_actor: string, _operation: string, _key: string,
    work: (tx: typeof transaction) => Promise<unknown>) => work(transaction)) };
  const service = new SchedulesService({} as never, {} as never, generateRoundRobin,
    receipts as never, undefined,
    { requireVisible: jest.fn(async () => 'league-1'), notFound: jest.fn() } as never);
  Object.assign(service, { readStagePreview: jest.fn(async () => ({ id: 'stage-1', version: 3, matchCount: 1 })) });
  const input = { expectedStageVersion: 2, roundNumber: 1, homeParticipantId: homeId,
    awayParticipantId: awayId, plannedAt: '2026-10-21T12:00:00.000Z' };
  return { service, transaction, input };
}

describe('manual stage matches', () => {
  it('adds a dated match to an already published stage and advances its version', async () => {
    const { service, transaction, input } = harness();
    await service.createStageMatch('admin-1', 'league-1', 'stage-1', input, 'manual-match');
    expect(transaction.competitionMatch.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      stageId: 'stage-1', roundNumber: 1, matchNumber: 4,
      homeParticipantId: homeId, awayParticipantId: awayId,
      pairingKey: [homeId, awayId].sort().join(':'), plannedAt: new Date(input.plannedAt)
    }) });
    expect(transaction.competitionStage.updateMany).toHaveBeenCalledWith({
      where: { id: 'stage-1', version: 2 }, data: { version: { increment: 1 } }
    });
  });

  it('rejects a repeated pairing and a team scheduled twice in one round', async () => {
    const duplicate = harness({ duplicate: true });
    await expect(duplicate.service.createStageMatch('admin-1', 'league-1', 'stage-1', duplicate.input, 'duplicate'))
      .rejects.toMatchObject({ response: { code: 'SCHEDULE_PAIR_ALREADY_EXISTS' } });
    const conflict = harness({ roundConflict: true });
    await expect(conflict.service.createStageMatch('admin-1', 'league-1', 'stage-1', conflict.input, 'conflict'))
      .rejects.toMatchObject({ response: { code: 'SCHEDULE_ROUND_CONFLICT' } });
    expect(duplicate.transaction.competitionMatch.create).not.toHaveBeenCalled();
    expect(conflict.transaction.competitionMatch.create).not.toHaveBeenCalled();
  });
});

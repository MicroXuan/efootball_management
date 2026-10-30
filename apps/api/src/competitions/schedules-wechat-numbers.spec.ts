import { jest } from '@jest/globals';
import { SchedulesService } from './schedules.service.js';

describe('published schedule WeChat match numbers', () => {
  const stageId = 'stage-1';
  const leagueId = 'league-1';
  const makeService = (status: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED') => {
    const refs = new Map<string, number>([['match-1', 3]]);
    const findMany = jest.fn(async () => [...refs].map(([matchId, id]) => ({ matchId, id })));
    const upsert = jest.fn(async ({ where }: { where: { matchId: string } }) => {
      if (!refs.has(where.matchId)) refs.set(where.matchId, 4);
    });
    const prisma = {
      wechatMatchReference: { findMany, upsert },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)
    };
    const visibility = {
      requireVisible: jest.fn(async () => leagueId),
      notFound: () => new Error('not found')
    };
    const service = new SchedulesService(prisma as never, {} as never, (() => []) as never,
      undefined, undefined, visibility as never);
    Object.defineProperty(service, 'readStagePreview', { value: jest.fn(async () => ({
      id: stageId, competitionId: 'competition-1', status, version: 2, roundCount: 1, matchCount: 2,
      matches: [{ id: 'match-1' }, { id: 'match-2' }]
    })) });
    return { service, findMany, upsert };
  };

  it('reads existing references without creating new ones', async () => {
    const { service, upsert } = makeService();
    const preview = await service.previewStageForLeague(leagueId, stageId);
    expect(preview.matches.map((match) => match.wechatMatchNo)).toEqual([3, null]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('fills only missing references and keeps numbers stable on retry', async () => {
    const { service, upsert } = makeService();
    const first = await service.ensureStageWechatMatchNumbers(leagueId, stageId);
    const second = await service.ensureStageWechatMatchNumbers(leagueId, stageId);
    expect(first.matches.map((match) => match.wechatMatchNo)).toEqual([3, 4]);
    expect(second.matches.map((match) => match.wechatMatchNo)).toEqual([3, 4]);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({ where: { matchId: 'match-2' }, create: { matchId: 'match-2' }, update: {} });
  });

  it('rejects draft schedules before creating references', async () => {
    const { service, upsert } = makeService('DRAFT');
    await expect(service.ensureStageWechatMatchNumbers(leagueId, stageId)).rejects.toMatchObject({ code: 'SCHEDULE_NOT_PUBLISHED' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a stage outside the requested league', async () => {
    const { service, upsert } = makeService();
    await expect(service.ensureStageWechatMatchNumbers('another-league', stageId)).rejects.toThrow('not found');
    expect(upsert).not.toHaveBeenCalled();
  });
});

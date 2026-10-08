import { describe, expect, it, jest } from '@jest/globals';
import { CompetitionsService } from './competitions.service.js';
import { LeagueError } from '../leagues/league.errors.js';

describe('public competition list filters', () => {
  it('limits a season cup query to both supported cup competition types', async () => {
    const findMany = jest.fn(async (...args: unknown[]) => {
      void args;
      return [];
    });
    const service = new CompetitionsService({ competition: { findMany } } as never, {} as never);

    await expect(service.listPublic({
      seasonId: '11111111-1111-4111-8111-111111111111',
      category: 'CUP',
      limit: 20,
    })).resolves.toEqual({ items: [], nextCursor: null });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        seasonId: '11111111-1111-4111-8111-111111111111',
        competitionType: { in: ['GROUP_KNOCKOUT_CUP', 'KNOCKOUT_CUP'] },
        AND: expect.arrayContaining([{
          OR: [
            { seasonId: null },
            { season: { league: { isDeleted: false } } }
          ]
        }])
      }),
    }));
  });

  it('returns the shared 404 before loading a deleted-league competition detail', async () => {
    const findUnique = jest.fn();
    const visibility = {
      requireVisible: jest.fn(async () => {
        throw new LeagueError('LEAGUE_NOT_FOUND', '联赛不存在', 404);
      })
    };
    const service = new (CompetitionsService as any)(
      { competition: { findUnique } },
      {},
      visibility
    );

    await expect(service.getPublic('competition-1'))
      .rejects.toMatchObject({ code: 'LEAGUE_NOT_FOUND', status: 404 });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a deleted-league competition mutation before creating a receipt', async () => {
    const receipts = { execute: jest.fn() };
    const visibility = {
      requireVisible: jest.fn(async () => {
        throw new LeagueError('LEAGUE_NOT_FOUND', '联赛不存在', 404);
      })
    };
    const service = new (CompetitionsService as any)({}, receipts, visibility);

    await expect(service.update('user-1', 'competition-1', {
      expectedVersion: 1,
      name: '不可修改'
    }, 'deleted-update')).rejects.toMatchObject({ code: 'LEAGUE_NOT_FOUND', status: 404 });
    expect(receipts.execute).not.toHaveBeenCalled();
  });
});

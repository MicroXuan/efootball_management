import { describe, expect, it, jest } from '@jest/globals';
import { CompetitionsService } from './competitions.service.js';

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
      }),
    }));
  });
});

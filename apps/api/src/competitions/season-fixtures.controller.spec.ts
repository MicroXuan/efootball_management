import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { jest } from '@jest/globals';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { SeasonFixturesController } from './season-fixtures.controller.js';

describe('SeasonFixturesController', () => {
  it('exposes one authenticated season-wide fixture route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SeasonFixturesController)).toBe('me/leagues/:leagueId/seasons/:seasonId/fixtures');
    expect(Reflect.getMetadata(GUARDS_METADATA, SeasonFixturesController)).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata(PATH_METADATA, SeasonFixturesController.prototype.list)).toBe('/');
  });

  it('passes the caller and scoped query to the service', async () => {
    const service = { list: jest.fn(async () => ({ items: [], nextCursor: null })) };
    const controller = new SeasonFixturesController(service as never);
    const query = { status: 'ALL' as const, limit: 20 };
    await expect(controller.list({ id: 'user-1' } as never, 'league-1', 'season-1', query))
      .resolves.toEqual({ items: [], nextCursor: null });
    expect(service.list).toHaveBeenCalledWith('user-1', 'league-1', 'season-1', query);
  });
});

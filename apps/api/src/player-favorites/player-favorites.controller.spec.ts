import { GUARDS_METADATA } from '@nestjs/common/constants';
import { jest } from '@jest/globals';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { PlayerFavoritesController } from './player-favorites.controller.js';

const user = { id: '11111111-1111-4111-8111-111111111111', status: 'ACTIVE' as const };
const playerId = '22222222-2222-4222-8222-222222222222';

describe('PlayerFavoritesController', () => {
  it('protects every favorite route with user authentication', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PlayerFavoritesController) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('always scopes list, status, create, and delete calls to the current user', async () => {
    const service = {
      list: jest.fn(async () => ({ items: [], nextCursor: null })),
      statuses: jest.fn(async () => ({ favoritePlayerIds: [] })),
      favorite: jest.fn(async () => ({ favoritePlayerIds: [playerId] })),
      unfavorite: jest.fn(async () => ({ favoritePlayerIds: [] }))
    };
    const controller = new PlayerFavoritesController(service as never);

    await controller.list(user, { keyword: '梅西', limit: 20 });
    await controller.statuses(user, { playerIds: [playerId] });
    await controller.favorite(user, { playerId });
    await controller.unfavorite(user, playerId);

    expect(service.list).toHaveBeenCalledWith(user.id, { keyword: '梅西', limit: 20 });
    expect(service.statuses).toHaveBeenCalledWith(user.id, [playerId]);
    expect(service.favorite).toHaveBeenCalledWith(user.id, playerId);
    expect(service.unfavorite).toHaveBeenCalledWith(user.id, playerId);
  });
});

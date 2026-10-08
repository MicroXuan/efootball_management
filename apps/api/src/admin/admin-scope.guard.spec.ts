import { jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import type { AdminAuthorizationService } from './admin-authorization.service.js';
import { AdminScopeGuard } from './admin-scope.guard.js';

describe('AdminScopeGuard', () => {
  function context(params: { leagueId?: string }): ExecutionContext {
    return {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => ({ admin: { id: 'admin-1' }, params })
      })
    } as unknown as ExecutionContext;
  }

  it('returns the visibility 404 before league authorization runs', async () => {
    const reflector = { getAllAndOverride: jest.fn(() => false) } as unknown as Reflector;
    const authorization = {
      requireLeagueManager: jest.fn(async () => ({ id: 'admin-1' })),
      requirePlatformAdmin: jest.fn(async () => ({ id: 'admin-1' }))
    } as unknown as AdminAuthorizationService;
    const notFound = Object.assign(new Error('League was not found'), {
      status: 404,
      response: { code: 'LEAGUE_NOT_FOUND', message: 'League was not found' }
    });
    const visibility = {
      requireVisible: jest.fn(async () => Promise.reject(notFound))
    } as unknown as LeagueVisibilityService;
    const guard = new (AdminScopeGuard as unknown as new (
      reflector: Reflector,
      authorization: AdminAuthorizationService,
      visibility: LeagueVisibilityService
    ) => AdminScopeGuard)(reflector, authorization, visibility);

    await expect(guard.canActivate(context({ leagueId: 'deleted-league' }))).rejects.toBe(notFound);
    expect(authorization.requireLeagueManager).not.toHaveBeenCalled();
  });

  it('does not require a league visibility check for platform-only routes', async () => {
    const reflector = { getAllAndOverride: jest.fn(() => true) } as unknown as Reflector;
    const authorization = {
      requireLeagueManager: jest.fn(),
      requirePlatformAdmin: jest.fn(async () => ({ id: 'admin-1' }))
    } as unknown as AdminAuthorizationService;
    const visibility = { requireVisible: jest.fn() } as unknown as LeagueVisibilityService;
    const guard = new (AdminScopeGuard as unknown as new (
      reflector: Reflector,
      authorization: AdminAuthorizationService,
      visibility: LeagueVisibilityService
    ) => AdminScopeGuard)(reflector, authorization, visibility);

    await expect(guard.canActivate(context({}))).resolves.toBe(true);
    expect(visibility.requireVisible).not.toHaveBeenCalled();
  });
});

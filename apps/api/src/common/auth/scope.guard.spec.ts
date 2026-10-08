import { jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { ResourceScopeService } from '../../authorization/resource-scope.service.js';
import type { LeagueVisibilityService } from '../../league-visibility/league-visibility.service.js';
import { ScopeGuard } from './scope.guard.js';

describe('ScopeGuard', () => {
  it('returns the shared 404 when a scoped resource cannot be resolved', async () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => ({
        permission: 'season.read',
        scope: { type: 'SEASON', param: 'seasonId' }
      }))
    } as unknown as Reflector;
    const authorization = { can: jest.fn(async () => true) } as unknown as AuthorizationService;
    const resourceScopes = { resolve: jest.fn(async () => undefined) } as unknown as ResourceScopeService;
    const notFound = Object.assign(new Error('League was not found'), {
      status: 404,
      response: { code: 'LEAGUE_NOT_FOUND', message: 'League was not found' }
    });
    const visibility = { notFound: jest.fn(() => notFound) } as unknown as LeagueVisibilityService;
    const guard = new (ScopeGuard as unknown as new (
      reflector: Reflector,
      authorization: AuthorizationService,
      resourceScopes: ResourceScopeService,
      visibility: LeagueVisibilityService
    ) => ScopeGuard)(reflector, authorization, resourceScopes, visibility);
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'user-1' }, params: { seasonId: 'missing' } })
      })
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBe(notFound);
    expect(authorization.can).not.toHaveBeenCalled();
  });
});

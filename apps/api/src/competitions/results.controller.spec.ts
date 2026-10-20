import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { ResultsController } from './results.controller.js';

describe('ResultsController administrator-only boundary', () => {
  it('does not expose participant result or dispute handlers', () => {
    for (const method of ['submit', 'confirm', 'reject', 'openTimeout', 'attachEvidence', 'getDispute']) {
      expect(ResultsController.prototype).not.toHaveProperty(method);
    }
  });

  it('keeps both guarded administrator result routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ResultsController.prototype.manager))
      .toBe('admin/competitions/:id/matches/:matchId/results');
    expect(Reflect.getMetadata(GUARDS_METADATA, ResultsController.prototype.manager))
      .toEqual(expect.arrayContaining([JwtAuthGuard, ScopeGuard]));

    expect(Reflect.getMetadata(PATH_METADATA, ResultsController.prototype.leagueAdmin))
      .toBe('admin/leagues/:leagueId/competitions/:id/matches/:matchId/results');
    expect(Reflect.getMetadata(GUARDS_METADATA, ResultsController.prototype.leagueAdmin))
      .toEqual(expect.arrayContaining([AdminAuthGuard, AdminScopeGuard]));
  });
});

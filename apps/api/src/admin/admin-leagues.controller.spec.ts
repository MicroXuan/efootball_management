import { jest } from '@jest/globals';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { AdminLeagueWorkspaceController } from './admin-leagues.controller.js';
import { AdminScopeGuard } from './admin-scope.guard.js';

describe('AdminLeagueWorkspaceController', () => {
  it('uses the scoped admin workspace PATCH and passes the optimistic league version', async () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminLeagueWorkspaceController)).toBe('admin/leagues/:leagueId/workspace');
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminLeagueWorkspaceController)).toEqual([AdminAuthGuard, AdminScopeGuard]);
    expect(Reflect.getMetadata(METHOD_METADATA, AdminLeagueWorkspaceController.prototype.update)).toBe(RequestMethod.PATCH);
    const update = jest.fn(async () => ({ resultEvidenceRequired: true, version: 2 }));
    const controller = new AdminLeagueWorkspaceController({ update } as never);
    await expect(controller.update({ id: 'admin-1' } as never, 'league-1', 'toggle-1', {
      resultEvidenceRequired: true, expectedVersion: 1
    })).resolves.toMatchObject({ resultEvidenceRequired: true, version: 2 });
    expect(update).toHaveBeenCalledWith('admin-1', 'league-1', {
      resultEvidenceRequired: true, expectedVersion: 1
    }, 'toggle-1');
    expect(() => controller.update({ id: 'admin-1' } as never, 'league-1', undefined, {
      resultEvidenceRequired: true, expectedVersion: 1
    })).toThrow();
  });
});

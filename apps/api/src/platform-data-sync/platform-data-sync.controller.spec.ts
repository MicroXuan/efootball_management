import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { jest } from '@jest/globals';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { PlatformDataSyncController } from './platform-data-sync.controller.js';

describe('PlatformDataSyncController', () => {
  const admin = { id: '11111111-1111-4111-8111-111111111111', status: 'ACTIVE', platformRole: 'PLATFORM_ADMIN' } as const;

  it('requires an authenticated platform administrator', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PlatformDataSyncController) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([AdminAuthGuard, AdminScopeGuard]));
    expect(Reflect.getMetadata('admin:platform-only', PlatformDataSyncController)).toBe(true);
  });

  it('returns accepted queued runs without executing remote synchronization inline', async () => {
    const queued = { runId: '22222222-2222-4222-8222-222222222222', status: 'PENDING' as const };
    const startPlayerRun = jest.fn(async () => queued);
    const resumeTeamRun = jest.fn(async () => queued);
    const controller = new PlatformDataSyncController({ startPlayerRun, resumeTeamRun } as never);

    await expect(controller.startPlayerRun(admin, { mode: 'incremental' })).resolves.toEqual(queued);
    await expect(controller.resumeTeamRun(admin, queued.runId)).resolves.toEqual(queued);
    expect(startPlayerRun).toHaveBeenCalledWith(admin.id, { mode: 'incremental' });
    expect(resumeTeamRun).toHaveBeenCalledWith(admin.id, queued.runId);
    for (const handler of ['startPlayerRun', 'resumePlayerRun', 'startTeamRun', 'resumeTeamRun'] as const) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, PlatformDataSyncController.prototype[handler])).toBe(202);
    }
  });
});

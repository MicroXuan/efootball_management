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
    const paused = { runId: queued.runId, status: 'PAUSED' as const };
    const cancelled = { runId: queued.runId, status: 'CANCELLED' as const };
    const startPlayerRun = jest.fn(async () => queued);
    const resumeTeamRun = jest.fn(async () => queued);
    const pausePlayerRun = jest.fn(async () => paused);
    const cancelTeamRun = jest.fn(async () => cancelled);
    const controller = new PlatformDataSyncController({ startPlayerRun, resumeTeamRun, pausePlayerRun, cancelTeamRun } as never);

    await expect(controller.startPlayerRun(admin, { mode: 'incremental' })).resolves.toEqual(queued);
    await expect(controller.resumeTeamRun(admin, queued.runId)).resolves.toEqual(queued);
    await expect(controller.pausePlayerRun(admin, queued.runId)).resolves.toEqual(paused);
    await expect(controller.cancelTeamRun(admin, queued.runId)).resolves.toEqual(cancelled);
    expect(startPlayerRun).toHaveBeenCalledWith(admin.id, { mode: 'incremental' });
    expect(resumeTeamRun).toHaveBeenCalledWith(admin.id, queued.runId);
    expect(pausePlayerRun).toHaveBeenCalledWith(admin.id, queued.runId);
    expect(cancelTeamRun).toHaveBeenCalledWith(admin.id, queued.runId);
    for (const handler of [
      'startPlayerRun', 'resumePlayerRun', 'pausePlayerRun', 'cancelPlayerRun',
      'startTeamRun', 'resumeTeamRun', 'pauseTeamRun', 'cancelTeamRun'
    ] as const) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, PlatformDataSyncController.prototype[handler])).toBe(202);
    }
  });

  it('exposes schedule settings and queues a manual reconciliation run', async () => {
    const queued = { runId: '22222222-2222-4222-8222-222222222222', status: 'PENDING' as const };
    const schedule = { get: jest.fn(async () => ({ enabled: false, timeZone: 'UTC', localTime: '03:00', lastTriggeredDate: null })),
      update: jest.fn(async () => ({ enabled: true, timeZone: 'Asia/Shanghai', localTime: '04:00', lastTriggeredDate: null })),
      startManual: jest.fn(async () => queued) };
    const runner = { scheduleReconciliation: jest.fn() };
    const controller = new PlatformDataSyncController({} as never, schedule as never, {} as never, runner as never);

    await expect(controller.getPlayerCatalogSchedule(admin)).resolves.toMatchObject({ enabled: false });
    await expect(controller.updatePlayerCatalogSchedule(admin,
      { enabled: true, timeZone: 'Asia/Shanghai', localTime: '04:00' })).resolves.toMatchObject({ enabled: true });
    await expect(controller.startPlayerReconciliation(admin)).resolves.toEqual(queued);
    expect(runner.scheduleReconciliation).toHaveBeenCalledWith(queued.runId);
  });
});

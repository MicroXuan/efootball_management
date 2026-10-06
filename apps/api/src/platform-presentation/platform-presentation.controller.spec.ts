import { GUARDS_METADATA } from '@nestjs/common/constants';
import { jest } from '@jest/globals';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import {
  AdminPlatformPresentationController,
  PublicPlatformPresentationController,
} from './platform-presentation.controller.js';

describe('platform presentation controllers', () => {
  it('exposes the configured banner without requiring a user session', async () => {
    const get = jest.fn(async () => ({
      leagueCenterBannerUrl: 'https://media.example.com/banner.webp',
      version: 2,
    }));
    const controller = new PublicPlatformPresentationController({ get } as never);

    await expect(controller.get()).resolves.toEqual({
      leagueCenterBannerUrl: 'https://media.example.com/banner.webp',
      version: 2,
    });
  });

  it('protects global banner updates with administrator and platform scope guards', async () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminPlatformPresentationController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([AdminAuthGuard, AdminScopeGuard]));

    const update = jest.fn(async () => ({ leagueCenterBannerUrl: null, version: 3 }));
    const controller = new AdminPlatformPresentationController({ update } as never);
    await expect(controller.update({ id: 'admin-1', status: 'ACTIVE', platformRole: 'PLATFORM_ADMIN' }, {
      leagueCenterBannerUrl: null,
      expectedVersion: 2,
    })).resolves.toEqual({ leagueCenterBannerUrl: null, version: 3 });
    expect(update).toHaveBeenCalledWith('admin-1', {
      leagueCenterBannerUrl: null,
      expectedVersion: 2,
    });
  });
});

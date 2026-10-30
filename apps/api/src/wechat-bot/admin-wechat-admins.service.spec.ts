import { describe, expect, it, jest } from '@jest/globals';
import { AdminWechatAdminsService } from './admin-wechat-admins.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import type { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import type { AuditLogService } from '../admin/audit-log.service.js';

describe('private administrator candidates', () => {
  it('shows the latest observed contact name beside the stable ID, without guessing when none is known', async () => {
    const observedAt = new Date('2026-10-30T01:13:17.000Z');
    const prisma = {
      wechatAdminContact: { findMany: jest.fn(async ({ where }: { where: { adminId: unknown } }) =>
        where.adminId === null
          ? [{ id: 'contact-1', wechatContactId: 'wxid_dust', version: 1, lastObservedAt: observedAt, adminId: null, admin: null },
            { id: 'contact-2', wechatContactId: 'wxid_unknown', version: 1, lastObservedAt: observedAt, adminId: null, admin: null }]
          : []) },
      adminAccount: { findMany: jest.fn(async () => []) },
      wechatObservedMember: { findMany: jest.fn(async (_query: unknown) => [
        { wechatContactId: 'wxid_dust', displayName: 'Dust', lastObservedAt: observedAt },
        { wechatContactId: 'wxid_dust', displayName: 'Old name', lastObservedAt: new Date('2026-10-01T00:00:00.000Z') }
      ]) }
    };
    const auth = { requirePlatformAdmin: jest.fn(async (_adminId: string) => undefined) };
    const service = new AdminWechatAdminsService(
      prisma as unknown as PrismaService,
      auth as unknown as AdminAuthorizationService,
      {} as AdminMutationReceiptService,
      {} as AuditLogService,
      { privateScoreEnabled: true } as never
    );

    const result = await service.list('platform-admin', 'device-1');

    expect(auth.requirePlatformAdmin).toHaveBeenCalledWith('platform-admin');
    expect(prisma.wechatObservedMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deviceId: 'device-1', wechatContactId: { in: ['wxid_dust', 'wxid_unknown'] }, displayName: { not: null } },
      orderBy: { lastObservedAt: 'desc' }
    }));
    expect(result.items).toEqual([
      expect.objectContaining({ wechatContactId: 'wxid_dust', observedName: 'Dust', observedNameAt: observedAt.toISOString() }),
      expect.objectContaining({ wechatContactId: 'wxid_unknown', observedName: null, observedNameAt: null })
    ]);
  });
});

import { expect, it, jest } from '@jest/globals';
import type { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { AdminWechatIdentitiesService } from './admin-wechat-identities.service.js';

it('rejects a league administrator before exposing device-wide identities', async () => {
  const db = { adminAccount: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', platformRole: null })) } } as unknown as PrismaService;
  const service = new AdminWechatIdentitiesService(db, new AdminAuthorizationService(db), new AdminMutationReceiptService(db), new AuditLogService(db));
  await expect(service.listMembers('league-admin', 'device', { limit: 30 })).rejects.toMatchObject({ status: 403 });
  await expect(service.findUser('league-admin', 'device', '001234')).rejects.toMatchObject({ status: 403 });
});

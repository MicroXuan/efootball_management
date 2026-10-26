import { randomUUID } from 'node:crypto';
import { WechatBridgeService } from '../src/wechat-bot/wechat-bridge.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AdminAuthorizationService } from '../src/admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../src/admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../src/admin/audit-log.service.js';
import { AdminWechatIdentitiesService } from '../src/wechat-bot/admin-wechat-identities.service.js';

describe('administrator managed WeChat identity integration', () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/test|verify/.test(url.pathname)) throw new Error('isolated database required');
  const db = new PrismaService();
  const run = randomUUID();
  const adminId = randomUUID(), deviceId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID(), leagueId = randomUUID();
  let memberId: string;
  let service: AdminWechatIdentitiesService;
  beforeAll(async () => {
    await db.adminAccount.create({ data: { id: adminId, username: `identity-${run}`, displayName: 'verify admin', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN' } });
    await db.wechatBotDevice.create({ data: { id: deviceId, name: 'verify device', tokenHash: 'unused', createdByAdminId: adminId } });
    await db.user.createMany({ data: [userId, otherUserId].map((id) => ({ id, wechatOpenId: `verify-${id}`, displayName: 'verify user' })) });
    await db.league.create({ data: { id: leagueId, name: 'verify league', shortName: 'verify', defaultPlatform: 'MOBILE', defaultServerRegion: 'verify', createdByAdminId: adminId } });
    const group = await db.wechatObservedGroup.create({ data: { deviceId, wechatGroupId: 'verify@chatroom', displayName: 'verify group' } });
    await db.wechatGroupBinding.create({ data: { deviceId, observedGroupId: group.id, wechatGroupId: group.wechatGroupId, displayName: group.displayName, leagueId } });
    memberId = (await db.wechatObservedMember.create({ data: { deviceId, wechatGroupId: group.wechatGroupId, wechatContactId: 'wxid_verify', firstObservedAt: new Date(), lastObservedAt: new Date() } })).id;
    service = new AdminWechatIdentitiesService(db, new AdminAuthorizationService(db), new AdminMutationReceiptService(db), new AuditLogService(db));
  });
  afterAll(async () => {
    await db.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({ where: { actorAdminId: adminId } });
      await tx.adminMutationReceipt.deleteMany({ where: { adminId } });
      await tx.wechatIdentityBinding.deleteMany({ where: { deviceId } });
      await tx.wechatObservedMember.deleteMany({ where: { deviceId } });
      await tx.wechatGroupBinding.deleteMany({ where: { deviceId } });
      await tx.wechatObservedGroup.deleteMany({ where: { deviceId } });
      await tx.wechatBotDevice.deleteMany({ where: { id: deviceId } });
      await tx.league.deleteMany({ where: { id: leagueId } });
      await tx.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
      await tx.adminAccount.deleteMany({ where: { id: adminId } });
    });
    expect(await db.wechatObservedMember.count({ where: { deviceId } })).toBe(0);
    await db.$disconnect();
  });
  it('rejects replacing a registered robot account and disables its identities', async () => {
    await db.wechatBotDevice.update({ where: { id: deviceId }, data: { wechatAccountId: `robot-${run}` } });
    const bridge = new WechatBridgeService(db);
    await expect(bridge.heartbeat(deviceId, { wechatAccountId: `other-${run}`, wechatVersion: '4.1', loginStatus: 'LOGGED_IN', screenLocked: false, outboundQueueDepth: 0, observedGroups: [] })).rejects.toThrow();
    expect((await db.wechatBotDevice.findUniqueOrThrow({ where: { id: deviceId } })).status).toBe('DISABLED');
    await db.wechatBotDevice.update({ where: { id: deviceId }, data: { status: 'ACTIVE' } });
  });
  it('serializes conflicting first bindings, retries idempotently and rejects stale unbinding', async () => {
    const first = { observedMemberId: memberId, userId, expectedBindingId: null, expectedVersion: null, reason: 'verified owner', idempotencyKey: randomUUID() };
    const second = { ...first, userId: otherUserId, idempotencyKey: randomUUID() };
    const results = await Promise.allSettled([service.saveBinding(adminId, deviceId, first), service.saveBinding(adminId, deviceId, second)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results[0]!.status === 'fulfilled' ? first : second;
    const saved = await service.saveBinding(adminId, deviceId, winner);
    expect(await db.wechatIdentityBinding.count({ where: { deviceId } })).toBe(1);
    expect(await db.auditLog.count({ where: { actorAdminId: adminId } })).toBe(1);
    await expect(service.saveBinding(userId, deviceId, first)).rejects.toThrow();
    const unbind = { ...winner, userId: null, expectedBindingId: saved.binding.id, expectedVersion: saved.binding.version, idempotencyKey: randomUUID() };
    const disabled = await service.saveBinding(adminId, deviceId, unbind);
    expect(disabled.binding.status).toBe('DISABLED');
    await expect(service.saveBinding(adminId, deviceId, { ...unbind, idempotencyKey: randomUUID() })).rejects.toThrow();
    const members = await service.listMembers(adminId, deviceId, { limit: 30 });
    expect(members.items[0]?.binding?.status).toBe('DISABLED');
  });
});

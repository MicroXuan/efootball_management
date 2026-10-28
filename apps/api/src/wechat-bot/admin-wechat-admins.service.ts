import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { WechatAdminBindingMutation } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { WECHAT_BOT_CONFIG, type WechatBotRuntimeConfig } from './wechat-bot.config.js';

@Injectable()
export class AdminWechatAdminsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly auth: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(WECHAT_BOT_CONFIG) private readonly config: WechatBotRuntimeConfig) {}

  async list(adminId: string, deviceId: string) {
    await this.auth.requirePlatformAdmin(adminId);
    if (!this.config.privateScoreEnabled) return { enabled: false, items: [], admins: [] };
    const [bound, candidates, admins] = await Promise.all([
      this.prisma.wechatAdminContact.findMany({ where: { deviceId, adminId: { not: null } }, include: { admin: { select: { displayName: true } } }, orderBy: { lastObservedAt: 'desc' } }),
      this.prisma.wechatAdminContact.findMany({ where: { deviceId, adminId: null }, include: { admin: { select: { displayName: true } } }, orderBy: { lastObservedAt: 'desc' }, take: 100 }),
      this.prisma.adminAccount.findMany({ where: { status: 'ACTIVE' }, select: { id: true, username: true, displayName: true }, orderBy: { username: 'asc' } })
    ]);
    return { enabled: true, admins, items: [...bound, ...candidates].map((c) => ({ id: c.id, wechatContactId: c.wechatContactId, version: c.version,
      lastObservedAt: c.lastObservedAt.toISOString(), adminId: c.adminId, adminName: c.admin?.displayName ?? null })) };
  }

  async bind(actorId: string, deviceId: string, contactId: string, input: WechatAdminBindingMutation) {
    await this.auth.requirePlatformAdmin(actorId);
    if (!this.config.privateScoreEnabled) throw new ConflictException({ code: 'PRIVATE_SCORE_DISABLED', message: '管理员私聊录分未启用' });
    return this.receipts.execute(actorId, `wechat.admin-binding:${deviceId}:${contactId}`, input.idempotencyKey, async (tx) => {
      await tx.$queryRaw`SELECT id FROM wechat_bot_devices WHERE id=${deviceId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM admin_accounts WHERE id=${actorId} FOR UPDATE`;
      const actor = await tx.adminAccount.findUnique({ where: { id: actorId } });
      if (actor?.status !== 'ACTIVE' || actor.platformRole !== 'PLATFORM_ADMIN') throw new ConflictException('平台管理权限已变更');
      const device = await tx.wechatBotDevice.findUnique({ where: { id: deviceId } });
      if (device?.status !== 'ACTIVE') throw new ConflictException('设备不可用');
      const contact = await tx.wechatAdminContact.findUnique({ where: { id: contactId } });
      if (!contact || contact.deviceId !== deviceId) throw new ConflictException('请先由管理员微信私聊机器人发送“帮助”');
      if (contact.version !== input.expectedVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: '绑定已变更，请刷新后核对' });
      if (input.adminId) {
        const admin = await tx.adminAccount.findUnique({ where: { id: input.adminId } });
        if (admin?.status !== 'ACTIVE') throw new ConflictException('管理员不存在或已停用');
        const bound = await tx.wechatAdminContact.findUnique({ where: { deviceId_adminId: { deviceId, adminId: input.adminId } } });
        if (bound && bound.id !== contactId) throw new ConflictException('该管理员已关联其他微信，请先解除原关联');
      }
      if (this.config.privateManagementEnabled) await tx.wechatAdminOperation.updateMany({ where: { contactId, status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: new Date() } });
      await tx.wechatScoreOperation.updateMany({ where: { contactId, status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: new Date() } });
      await tx.wechatAdminContact.update({ where: { id: contactId }, data: { adminId: input.adminId, boundAt: input.adminId ? new Date() : null,
        version: { increment: 1 }, leagueId: null, seasonId: null } });
      await this.audit.record(tx, { actorAdminId: actorId, action: 'wechat.admin-binding.save', resourceType: 'WechatAdminContact', resourceId: contactId,
        reason: input.reason, metadata: { deviceId, oldAdminId: contact.adminId, newAdminId: input.adminId, version: contact.version + 1 } });
      return { saved: true };
    }, input);
  }
}

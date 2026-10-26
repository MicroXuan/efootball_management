import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminWechatIdentityMutation, AdminWechatMembersQuery } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import type { Prisma } from '../generated/prisma/client.js';

type Binding = Prisma.WechatIdentityBindingGetPayload<{ include: { user: true } }>;
const conflict = (code: string, message: string) => new ConflictException({ code, message });

@Injectable()
export class AdminWechatIdentitiesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  private view(binding: Binding) {
    return { id: binding.id, version: binding.version, status: binding.status, userId: binding.userId,
      publicUserNo: binding.user.publicUserNo, userName: binding.user.displayName, boundAt: binding.boundAt.toISOString() };
  }

  async listMembers(adminId: string, deviceId: string, query: AdminWechatMembersQuery) {
    await this.authorization.requirePlatformAdmin(adminId);
    return this.members({ deviceId }, query);
  }

  async listLeagueMembers(adminId: string, leagueId: string, query: AdminWechatMembersQuery) {
    await this.authorization.requireLeagueManager(adminId, leagueId);
    return this.members({ leagueId }, query);
  }

  private async members(scope: { deviceId?: string; leagueId?: string }, query: AdminWechatMembersQuery) {
    const groups = await this.prisma.wechatGroupBinding.findMany({
      where: { ...scope, enabled: true, league: { isDeleted: false }, ...(query.wechatGroupId ? { wechatGroupId: query.wechatGroupId } : {}) },
      select: { deviceId: true, wechatGroupId: true, displayName: true }
    });
    const rows = await this.prisma.wechatObservedMember.findMany({
      where: { OR: groups.map(({ deviceId, wechatGroupId }) => ({ deviceId, wechatGroupId })), ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      orderBy: { id: 'asc' }, take: query.limit + 1
    });
    const page = rows.slice(0, query.limit);
    const bindings = page.length ? await this.prisma.wechatIdentityBinding.findMany({
      where: { OR: page.map((r) => ({ deviceId: r.deviceId, wechatContactId: r.wechatContactId })) }, include: { user: true }
    }) : [];
    return { items: page.map((r) => {
      const binding = bindings.find((b) => b.deviceId === r.deviceId && b.wechatContactId === r.wechatContactId);
      return { id: r.id, deviceId: r.deviceId, wechatGroupId: r.wechatGroupId, wechatContactId: r.wechatContactId,
        displayName: r.displayName, lastObservedAt: r.lastObservedAt.toISOString(),
        groupName: groups.find((g) => g.deviceId === r.deviceId && g.wechatGroupId === r.wechatGroupId)!.displayName,
        binding: binding ? this.view(binding) : null };
    }), nextCursor: rows.length > query.limit ? page.at(-1)!.id : null };
  }

  async findUser(adminId: string, deviceId: string, publicUserNo: string) {
    await this.authorization.requirePlatformAdmin(adminId);
    if (!await this.prisma.wechatBotDevice.findUnique({ where: { id: deviceId } })) throw new NotFoundException('设备不存在');
    const user = await this.prisma.user.findFirst({ where: { publicUserNo, status: 'ACTIVE' }, select: { id: true, publicUserNo: true, displayName: true } });
    if (!user) return { user: null };
    const teams = await this.prisma.leagueTeam.findMany({ where: { ownerUserId: user.id, status: 'ACTIVE', league: { isDeleted: false } }, select: { name: true, league: { select: { name: true } } } });
    return { user: { ...user, teams: teams.map((t) => ({ name: t.name, leagueName: t.league.name })) } };
  }

  async saveBinding(adminId: string, deviceId: string, input: AdminWechatIdentityMutation) {
    await this.authorization.requirePlatformAdmin(adminId);
    return this.receipts.execute(adminId, `wechat.identity:${deviceId}`, input.idempotencyKey, async (tx) => {
      // Device-wide identity uniqueness spans all groups and leagues. Serialize mutations.
      await tx.$queryRaw`SELECT id FROM wechat_bot_devices WHERE id = ${deviceId} FOR UPDATE`;
      const device = await tx.wechatBotDevice.findUnique({ where: { id: deviceId } });
      if (!device || device.status !== 'ACTIVE') throw conflict('WECHAT_DEVICE_DISABLED', '设备不存在或已停用');
      const member = await tx.wechatObservedMember.findFirst({ where: { id: input.observedMemberId, deviceId } });
      if (!member) throw new NotFoundException('未找到该设备观察到的成员');
      if (!await tx.wechatGroupBinding.findFirst({ where: { deviceId, wechatGroupId: member.wechatGroupId, enabled: true, league: { isDeleted: false } } })) {
        throw conflict('WECHAT_GROUP_DISABLED', '成员所在群未启用');
      }
      // A concurrent bid must finish before checking whether this identity has history.
      await tx.$queryRaw`SELECT id FROM wechat_identity_bindings WHERE device_id = ${deviceId} AND wechat_contact_id = ${member.wechatContactId} FOR UPDATE`;
      const existing = await tx.wechatIdentityBinding.findUnique({ where: { deviceId_wechatContactId: { deviceId, wechatContactId: member.wechatContactId } }, include: { user: true } });
      if ((existing?.id ?? null) !== input.expectedBindingId || (existing?.version ?? null) !== input.expectedVersion) {
        throw conflict('VERSION_CONFLICT', '绑定已被更新，请刷新后重新核对');
      }
      let binding: Binding;
      if (input.userId === null) {
        if (!existing || existing.status !== 'ACTIVE') throw conflict('WECHAT_NOT_BOUND', '该成员没有有效绑定');
        binding = await tx.wechatIdentityBinding.update({ where: { id: existing.id }, data: {
          status: 'DISABLED', version: { increment: 1 }, unboundAt: new Date(), revokedReason: input.reason
        }, include: { user: true } });
      } else {
        const user = await tx.user.findFirst({ where: { id: input.userId, status: 'ACTIVE' } });
        if (!user) throw conflict('WECHAT_USER_UNAVAILABLE', '用户不存在或已停用');
        const userBinding = await tx.wechatIdentityBinding.findUnique({ where: { deviceId_userId: { deviceId, userId: user.id } } });
        if (userBinding && userBinding.id !== existing?.id) throw conflict('USER_ALREADY_BOUND', '该用户已有其他微信关联，请先核对原关联，不能直接覆盖');
        if (existing && existing.userId !== user.id && await tx.playerAuctionBid.count({ where: { identityBindingId: existing.id } })) {
          throw conflict('WECHAT_IDENTITY_HAS_HISTORY', '该关联已有拍卖记录，请联系平台管理员处理身份更正，不能覆盖历史归属');
        }
        const data = { userId: user.id, status: 'ACTIVE' as const, boundAt: new Date(), unboundAt: null, revokedReason: null };
        binding = existing
          ? await tx.wechatIdentityBinding.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } }, include: { user: true } })
          : await tx.wechatIdentityBinding.create({ data: { ...data, deviceId, wechatContactId: member.wechatContactId }, include: { user: true } });
      }
      await this.audit.record(tx, { actorAdminId: adminId, action: 'wechat.identity.save', resourceType: 'WechatIdentityBinding', resourceId: binding.id,
        reason: input.reason, metadata: { deviceId, wechatContactId: member.wechatContactId, oldUserId: existing?.userId ?? null, newUserId: input.userId, oldStatus: existing?.status ?? null, status: binding.status } });
      return { binding: this.view(binding) };
    }, input);
  }
}

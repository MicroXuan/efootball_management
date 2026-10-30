import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { WechatObservedMembersBatch } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class WechatObservedMembersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async accept(deviceId: string, input: WechatObservedMembersBatch) {
    if (input.items.some((item) => new Date(item.observedAt).getTime() > Date.now() + 60_000)) {
      throw new BadRequestException({ code: 'MEMBER_OBSERVATION_FUTURE', message: '成员观察时间超出允许范围' });
    }
    for (const item of input.items) {
      await this.prisma.$transaction(async (tx) => {
        const group = await tx.wechatGroupBinding.findFirst({
          where: { deviceId, wechatGroupId: item.wechatGroupId, enabled: true }, select: { id: true }
        });
        if (!group) return;
        await tx.$queryRaw`SELECT id FROM wechat_group_bindings WHERE id = ${group.id} FOR UPDATE`;
        if (!await tx.wechatGroupBinding.findFirst({ where: { id: group.id, enabled: true } })) return;
        const key = { deviceId, wechatGroupId: item.wechatGroupId, wechatContactId: item.wechatContactId };
        const previous = await tx.wechatObservedMember.findUnique({ where: { deviceId_wechatGroupId_wechatContactId: key } });
        const observedAt = new Date(item.observedAt);
        if (!previous) {
          await tx.wechatObservedMember.create({ data: { ...key, displayName: item.displayName, firstObservedAt: observedAt, lastObservedAt: observedAt } });
        } else if (previous.lastObservedAt < observedAt) {
          await tx.wechatObservedMember.update({ where: { id: previous.id }, data: { displayName: item.displayName, lastObservedAt: observedAt } });
        }
      });
    }
    return { processed: input.items.length };
  }
}

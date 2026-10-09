import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PlayerAuctionError } from './player-auction.errors.js';
import { PlayerAuctionLockRepository } from './player-auction-lock.repository.js';

const FULL_DURATION_MS = 30_000;

@Injectable()
export class PlayerAuctionStateService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerAuctionLockRepository) private readonly locks: PlayerAuctionLockRepository,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService
  ) {}

  start(groupBindingId: string, actorUserId: string) {
    return this.withAuthorizedGroup(groupBindingId, actorUserId, async (tx, group) => {
      const batch = await this.batchForGroup(tx, group.id, ['READY']);
      await this.locks.lockBatch(tx, batch.id);
      const lot = await tx.playerAuctionLot.findFirst({ where: { batchId: batch.id, status: 'QUEUED' }, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] });
      if (!lot) throw new PlayerAuctionError('AUCTION_LOTS_REQUIRED', '没有可开始的拍卖球员', 409);
      await this.locks.lockLot(tx, lot.id);
      const now = await this.locks.now(tx);
      const deadlineAt = new Date(now.getTime() + FULL_DURATION_MS);
      await tx.playerAuctionLot.update({ where: { id: lot.id }, data: { status: 'ACTIVE', startedAt: now, deadlineAt, deadlineEpoch: { increment: 1 }, lastCountdownMark: 30, pausedRemainingMs: null, version: { increment: 1 } } });
      await tx.playerAuctionBatch.update({ where: { id: batch.id }, data: { status: 'ACTIVE', currentLotId: lot.id, startedAt: batch.startedAt ?? now, version: { increment: 1 } } });
      return { transition: 'STARTED' as const, batchId: batch.id, lotId: lot.id, deadlineAt };
    });
  }

  pause(groupBindingId: string, actorUserId: string) {
    return this.withAuthorizedGroup(groupBindingId, actorUserId, async (tx, group) => {
      const { batch, lot } = await this.activeContext(tx, group.id, 'ACTIVE');
      const now = await this.locks.now(tx);
      const remaining = Math.max(0, (lot.deadlineAt?.getTime() ?? now.getTime()) - now.getTime());
      await tx.playerAuctionLot.update({ where: { id: lot.id }, data: { status: 'PAUSED', deadlineAt: null, pausedRemainingMs: remaining, deadlineEpoch: { increment: 1 }, version: { increment: 1 } } });
      await tx.playerAuctionBatch.update({ where: { id: batch.id }, data: { status: 'PAUSED', version: { increment: 1 } } });
      return { transition: 'PAUSED' as const, batchId: batch.id, lotId: lot.id, remainingMs: remaining };
    });
  }

  resume(groupBindingId: string, actorUserId: string) {
    return this.withAuthorizedGroup(groupBindingId, actorUserId, async (tx, group) => {
      const { batch, lot } = await this.activeContext(tx, group.id, 'PAUSED');
      const now = await this.locks.now(tx);
      const remaining = lot.pausedRemainingMs ?? FULL_DURATION_MS;
      const deadlineAt = new Date(now.getTime() + remaining);
      await tx.playerAuctionLot.update({ where: { id: lot.id }, data: { status: 'ACTIVE', startedAt: now, deadlineAt, pausedRemainingMs: null, deadlineEpoch: { increment: 1 }, version: { increment: 1 } } });
      await tx.playerAuctionBatch.update({ where: { id: batch.id }, data: { status: 'ACTIVE', version: { increment: 1 } } });
      return { transition: 'RESUMED' as const, batchId: batch.id, lotId: lot.id, deadlineAt };
    });
  }

  next(groupBindingId: string, actorUserId: string) {
    return this.withAuthorizedGroup(groupBindingId, actorUserId, async (tx, group) => {
      const batch = await this.batchForGroup(tx, group.id, ['ACTIVE', 'PAUSED']);
      await this.locks.lockBatch(tx, batch.id);
      if (!batch.currentLotId) throw new PlayerAuctionError('AUCTION_CURRENT_LOT_MISSING', '当前没有拍卖球员', 409);
      await this.locks.lockLot(tx, batch.currentLotId);
      const current = await tx.playerAuctionLot.findUnique({ where: { id: batch.currentLotId } });
      if (!current || !['PENDING_REVIEW', 'REVIEWED', 'VOID', 'NO_BID'].includes(current.status)) {
        throw new PlayerAuctionError('AUCTION_NEXT_NOT_ALLOWED', '当前球员尚未结束，不能进入下一位', 409);
      }
      const next = await tx.playerAuctionLot.findFirst({ where: { batchId: batch.id, status: 'QUEUED', displayOrder: { gt: current.displayOrder } }, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] });
      const now = await this.locks.now(tx);
      if (!next) {
        await tx.playerAuctionBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', currentLotId: null, completedAt: now, version: { increment: 1 } } });
        return { transition: 'COMPLETED' as const, batchId: batch.id, lotId: null };
      }
      await this.locks.lockLot(tx, next.id);
      const deadlineAt = new Date(now.getTime() + FULL_DURATION_MS);
      await tx.playerAuctionLot.update({ where: { id: next.id }, data: { status: 'ACTIVE', startedAt: now, deadlineAt, deadlineEpoch: { increment: 1 }, lastCountdownMark: 30, version: { increment: 1 } } });
      await tx.playerAuctionBatch.update({ where: { id: batch.id }, data: { status: 'ACTIVE', currentLotId: next.id, version: { increment: 1 } } });
      return { transition: 'NEXT_STARTED' as const, batchId: batch.id, lotId: next.id, deadlineAt };
    });
  }

  cancel(groupBindingId: string, actorUserId: string) {
    return this.withAuthorizedGroup(groupBindingId, actorUserId, async (tx, group) => {
      const batch = await this.batchForGroup(tx, group.id, ['READY', 'ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED']);
      await this.locks.lockBatch(tx, batch.id);
      const now = await this.locks.now(tx);
      await tx.playerAuctionLot.updateMany({
        where: { batchId: batch.id, status: { in: ['QUEUED', 'ACTIVE', 'PAUSED'] } },
        data: { status: 'VOID', deadlineAt: null, pausedRemainingMs: null, closedAt: now, deadlineEpoch: { increment: 1 }, version: { increment: 1 } }
      });
      await tx.playerAuctionBatch.update({ where: { id: batch.id }, data: { status: 'CANCELLED', currentLotId: null, cancelledAt: now, version: { increment: 1 } } });
      return { transition: 'CANCELLED' as const, batchId: batch.id };
    });
  }

  enterRecovery(groupBindingId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.locks.lockGroup(tx, groupBindingId);
      const batch = await this.batchForGroup(tx, groupBindingId, ['ACTIVE', 'PAUSED']);
      await this.locks.lockBatch(tx, batch.id);
      const now = await this.locks.now(tx);
      if (batch.currentLotId) {
        await this.locks.lockLot(tx, batch.currentLotId);
        const lot = await tx.playerAuctionLot.findUnique({ where: { id: batch.currentLotId } });
        if (lot && ['ACTIVE', 'PAUSED'].includes(lot.status)) {
          const remaining = lot.status === 'PAUSED' ? lot.pausedRemainingMs : Math.max(0, (lot.deadlineAt?.getTime() ?? now.getTime()) - now.getTime());
          await tx.playerAuctionLot.update({ where: { id: lot.id }, data: { status: 'PAUSED', deadlineAt: null, pausedRemainingMs: remaining, deadlineEpoch: { increment: 1 }, version: { increment: 1 } } });
        }
      }
      await tx.playerAuctionBatch.update({ where: { id: batch.id }, data: { status: 'RECOVERY_REQUIRED', recoveryDetectedAt: now, recoveryReason: reason, version: { increment: 1 } } });
      return { transition: 'RECOVERY_REQUIRED' as const, batchId: batch.id };
    });
  }

  private withAuthorizedGroup<T>(groupBindingId: string, actorUserId: string, work: (tx: Prisma.TransactionClient, group: { id: string; leagueId: string }) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      await this.locks.lockGroup(tx, groupBindingId);
      const group = await tx.wechatGroupBinding.findUnique({ where: { id: groupBindingId } });
      if (!group?.enabled) throw new PlayerAuctionError('AUCTION_GROUP_INVALID', '微信群未绑定或已停用', 409);
      const allowed = await this.authorization.can(actorUserId, 'league.auction.manage', { type: 'LEAGUE', id: group.leagueId });
      if (!allowed) throw new PlayerAuctionError('AUCTION_FORBIDDEN', '没有管理该联赛拍卖的权限', 403);
      return work(tx, group);
    });
  }

  private async batchForGroup(tx: Prisma.TransactionClient, groupBindingId: string, statuses: string[]) {
    const batch = await tx.playerAuctionBatch.findFirst({ where: { groupBindingId, status: { in: statuses as never } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (!batch) throw new PlayerAuctionError('AUCTION_STATE_INVALID', '当前群没有可执行该操作的拍卖', 409);
    return batch;
  }

  private async activeContext(tx: Prisma.TransactionClient, groupBindingId: string, status: 'ACTIVE' | 'PAUSED') {
    const batch = await this.batchForGroup(tx, groupBindingId, [status]);
    await this.locks.lockBatch(tx, batch.id);
    if (!batch.currentLotId) throw new PlayerAuctionError('AUCTION_CURRENT_LOT_MISSING', '当前没有拍卖球员', 409);
    await this.locks.lockLot(tx, batch.currentLotId);
    const lot = await tx.playerAuctionLot.findUnique({ where: { id: batch.currentLotId } });
    if (!lot || lot.status !== status) throw new PlayerAuctionError('AUCTION_STATE_INVALID', '拍卖状态不一致', 409);
    return { batch, lot };
  }
}

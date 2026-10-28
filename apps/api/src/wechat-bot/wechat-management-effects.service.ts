import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TransferPlayerRequestSchema, ReviewPlayerAuctionLotRequestSchema } from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { ResultsService } from '../competitions/results.service.js';
import { RosterTransactionsService } from '../league-rosters/roster-transactions.service.js';
import { AdminPlayerAuctionsService } from '../player-auctions/admin-player-auctions.service.js';
import { PlayerAuctionStateService } from '../player-auctions/player-auction-state.service.js';
import { PlayerAuctionMessageFormatter } from '../player-auctions/player-auction-message.formatter.js';
import { WECHAT_BOT_CONFIG, type WechatBotRuntimeConfig } from './wechat-bot.config.js';
import { paginateWechatMessage } from './wechat-message-formatter.js';
import type { AdminCommand } from './wechat-admin-command.js';
export type ManagementTx = Prisma.TransactionClient;
export type ManagementScope = { adminId: string; deviceId: string; leagueId: string; seasonId: string };
export type ManagementPayload = { command: AdminCommand; entityId: string; version: number; title: string; sourceId?: string; targetId?: string; winnerId?: string; batchId?: string; batchVersion?: number; groupId?: string; groupVersion?: number; expectedOutcome?: string };
export const managementFail = (message: string): never => { throw new ConflictException({ message }); };
export const outcomeHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// All invoked services must use this transaction only. No external notifications before commit.
export async function previewWithRollback<T>(tx: ManagementTx, work: () => Promise<T>): Promise<T> {
  await tx.$executeRawUnsafe('SAVEPOINT wechat_management_preview');
  try { return await work(); }
  finally {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT wechat_management_preview');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT wechat_management_preview');
  }
}

@Injectable()
export class WechatManagementEffectsService {
  constructor(@Inject(ModuleRef) private readonly modules: ModuleRef,
    @Inject(ResultsService) private readonly results: ResultsService,
    @Inject(WECHAT_BOT_CONFIG) private readonly config: WechatBotRuntimeConfig) {}

  async prepare(tx: ManagementTx, scope: ManagementScope, command: AdminCommand): Promise<ManagementPayload> {
    if (command.kind === 'ADVANCE') {
      const ref = await tx.wechatMatchReference.findUnique({ where: { id: command.reference }, include: { match: { include: { stage: { include: { competition: true } }, homeParticipant: true, awayParticipant: true } } } });
      const m = ref?.match;
      if (!m || m.stage.competition.seasonId !== scope.seasonId) return managementFail('比赛不属于当前联赛赛季，请重新查询赛程。');
      return { command, entityId: m.id, version: m.version, winnerId: command.side === 'HOME' ? m.homeParticipantId : m.awayParticipantId,
        title: `M${command.reference} ${m.stage.competition.name} 第${m.roundNumber}轮\n主：${m.homeParticipant.displayNameSnapshot}\n客：${m.awayParticipant.displayNameSnapshot}\n裁定：${command.side === 'HOME' ? m.homeParticipant.displayNameSnapshot : m.awayParticipant.displayNameSnapshot}晋级（无比分）` };
    }
    const kind = command.kind === 'TRANSFER' ? 'OWNERSHIP' : command.kind === 'REVIEW' ? 'LOT' : 'BATCH';
    const ref = await tx.wechatEntityReference.findUnique({ where: { id: command.reference } });
    if (!ref || ref.kind !== kind) return managementFail('编号不存在或类型不符，请重新查询。');
    await this.requireCurrentSeason(tx, scope);
    if (command.kind === 'TRANSFER') {
      const o = await tx.leaguePlayerOwnership.findUnique({ where: { id: ref.entityId }, include: { leagueTeam: true, footballPlayer: true, currentPlayerCard: true } });
      if (!o || o.leagueId !== scope.leagueId || o.leagueTeam.teamNumber !== command.sourceTeam || o.leagueTeam.status !== 'ACTIVE') return managementFail('球员归属或来源球队已变化，请重新查询阵容。');
      const target = await this.team(tx, scope.leagueId, command.targetTeam);
      return { command, entityId: o.id, version: o.version, sourceId: o.leagueTeamId, targetId: target.id,
        title: `P${command.reference} ${(o.footballPlayer.nameZh ?? o.footballPlayer.nameEn ?? '未命名球员')}\n球员卡：${o.currentPlayerCardId}\n转出 T${command.sourceTeam} ${o.leagueTeam.name}\n转入 T${command.targetTeam} ${target.name}\n转会金额：${command.amount}（系统金额单位）` };
    }
    const lot = command.kind === 'REVIEW' ? await tx.playerAuctionLot.findUnique({ where: { id: ref.entityId } }) : null;
    const batchId = command.kind === 'REVIEW' ? lot?.batchId : ref.entityId;
    if (!batchId) return managementFail('拍品不存在。');
    const batch = await tx.playerAuctionBatch.findUnique({ where: { id: batchId }, include: { groupBinding: true } });
    if (!batch || batch.leagueId !== scope.leagueId) return managementFail('拍卖不属于当前联赛。');
    if (batch.bidChannel !== 'WECHAT_GROUP' || batch.groupBinding?.deviceId !== scope.deviceId) return managementFail('该拍卖不属于本机器人微信群渠道，请在后台管理。');
    let targetId: string | undefined;
    if (command.kind === 'REVIEW' && command.decision === 'ADJUST') targetId = (await this.team(tx, scope.leagueId, command.team!)).id;
    return { command, entityId: ref.entityId, version: lot?.version ?? batch.version, batchId, batchVersion: batch.version, groupId: batch.groupBindingId!, groupVersion: batch.groupBinding.version, ...(targetId ? { targetId } : {}),
      title: `${batch.name} / 目标群：${batch.groupBinding.displayName}\n${lot ? `L${command.reference} ${lot.playerNameSnapshot} / ${lot.status} / 当前价 ${lot.currentPrice ?? '无'}` : `A${command.reference} / ${batch.status}`}\n${command.kind === 'RECOVER' ? '已人工核对群消息后恢复，当前拍品重新倒计时30秒。' : ''}` };
  }

  async run(tx: ManagementTx, scope: ManagementScope, p: ManagementPayload, operationId: string) {
    const c = p.command;
    if (c.kind === 'ADVANCE') {
      await this.results.lockForOfficialResult(tx, p.entityId);
      const match = await tx.competitionMatch.findUniqueOrThrow({ where: { id: p.entityId }, include: { stage: { include: { competition: true } } } });
      if (match.stage.competition.seasonId !== scope.seasonId) return managementFail('比赛所属赛季已变化，请重新预览。');
      const value = await this.results.applyAdministratorAdvancement(tx, p.entityId, { winnerParticipantId: p.winnerId!, expectedVersion: p.version, reason: c.reason }, scope);
      return { fingerprint: value, text: `${value.winnerName}已裁定晋级；不记录比分，签表按赛事规则推进。` };
    }
    await this.requireCurrentSeason(tx, scope);
    if (c.kind === 'TRANSFER') {
      const source = await tx.leagueTeam.findUnique({ where: { id: p.sourceId! } });
      if (source?.leagueId !== scope.leagueId || source.status !== 'ACTIVE') return managementFail('转出球队不可用。');
      const current = await tx.leaguePlayerOwnership.findUnique({ where: { id: p.entityId } });
      if (current?.leagueId !== scope.leagueId || current.leagueTeamId !== p.sourceId) return managementFail('球员归属已变化，请重新预览。');
      const result = await this.modules.get(RosterTransactionsService, { strict: false }).transferWithClient(tx, TransferPlayerRequestSchema.parse({
        ownershipId: p.entityId, expectedVersion: p.version, seasonId: scope.seasonId, targetLeagueTeamId: p.targetId, amountMinor: c.amount, reason: c.reason, idempotencyKey: operationId
      }), scope.adminId);
      const transaction = await tx.rosterTransaction.findUniqueOrThrow({ where: { id: result.transaction.id } });
      const financial = this.financial(transaction);
      return { fingerprint: { ...financial, salaryRuleVersionId: result.ownership.salaryRuleVersionId, summary: result.summary },
        text: `转会金额 ${c.amount}；手续费 ${transaction.transactionFeeMinor ?? 0}；转入球队支出合计 ${c.amount + (transaction.transactionFeeMinor ?? 0)}。\n新工资 ${transaction.newSalaryMinor}；转入球队工资 ${result.summary.salaryMinor}/${result.summary.salaryCapMinor}。\n金额均为系统金额单位，与后台一致。` };
    }
    const batch = await tx.playerAuctionBatch.findUniqueOrThrow({ where: { id: p.batchId! }, include: { groupBinding: { include: { capabilities: true } } } });
    if (batch.leagueId !== scope.leagueId || batch.bidChannel !== 'WECHAT_GROUP' || batch.groupBinding?.deviceId !== scope.deviceId) return managementFail('拍卖范围已变化。');
    await tx.$queryRaw`SELECT id FROM wechat_group_bindings WHERE id=${batch.groupBindingId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM player_auction_batches WHERE id=${batch.id} FOR UPDATE`;
    const fresh = await tx.playerAuctionBatch.findUniqueOrThrow({ where: { id: batch.id } });
    if (fresh.leagueId !== scope.leagueId || fresh.bidChannel !== 'WECHAT_GROUP' || fresh.groupBindingId !== p.groupId) return managementFail('拍卖绑定群已变化，请重新预览。');
    if (fresh.version !== p.batchVersion) return managementFail('拍卖状态已变化，请重新预览。');
    const group = await tx.wechatGroupBinding.findUniqueOrThrow({ where: { id: batch.groupBindingId! }, include: { capabilities: true } });
    if (group.deviceId !== scope.deviceId || group.leagueId !== scope.leagueId || group.version !== p.groupVersion) return managementFail('群绑定已变化，请重新预览。');
    if (!group.enabled || !group.capabilities.some((v) => v.capability === 'PLAYER_AUCTION')) return managementFail('拍卖群已停用或未开启拍卖能力。');
    if (['START', 'RESUME', 'RECOVER'].includes(c.kind)) {
      const d = await tx.wechatBotDevice.findUniqueOrThrow({ where: { id: scope.deviceId } });
      if (d.status !== 'ACTIVE' || d.circuitStatus !== 'CLOSED' || d.loginStatus !== 'LOGGED_IN' || d.screenLocked || !d.lastHeartbeatAt || Date.now() - d.lastHeartbeatAt.getTime() > this.config.heartbeatTimeoutMs) return managementFail('机器人未就绪，请先恢复设备、登录及发送状态。');
      if (c.kind === 'RECOVER' && await tx.wechatOutboxMessage.count({ where: { deviceId: scope.deviceId, targetId: group.wechatGroupId, OR: [{ status: 'LEASED' }, { status: 'FAILED', failureCode: { in: ['WECHAT_SEND_UNCONFIRMED', 'PROCESS_RESTART_DURING_SEND', 'WECHAT_SEND_EXCEPTION'] } }] } })) return managementFail('群里仍有发送不确定或正在发送的任务，请先核对处理。');
    }
    if (c.kind === 'REVIEW') {
      await tx.$queryRaw`SELECT id FROM player_auction_lots WHERE id=${p.entityId} FOR UPDATE`;
      const lot = await tx.playerAuctionLot.findUniqueOrThrow({ where: { id: p.entityId } });
      if (lot.batchId !== batch.id) return managementFail('拍品范围已变化。');
      const value = await this.modules.get(AdminPlayerAuctionsService, { strict: false }).reviewLotWithClient(tx, scope.adminId, scope.leagueId, batch.id, lot.id,
        ReviewPlayerAuctionLotRequestSchema.parse({ decision: c.decision, expectedVersion: p.version, reason: c.reason, ...(c.decision === 'ADJUST' ? { reviewedTeamId: p.targetId, reviewedPrice: c.amount } : {}) }));
      const review = await tx.playerAuctionReview.findUniqueOrThrow({ where: { lotId: lot.id } });
      const settlement = review.reviewedWinnerTeamId ? await tx.rosterTransaction.findFirst({ where: { leagueId: scope.leagueId, seasonId: scope.seasonId, reason: `拍卖成交：${batch.id} / ${lot.id}` }, orderBy: { createdAt: 'desc' } }) : null;
      const text = `审核：${c.decision}；球队：${review.winnerTeamNameSnapshot ?? '无'}；成交价：${review.reviewedPrice ?? '无'}；手续费：${settlement?.transactionFeeMinor ?? 0}。\n${settlement ? '确认后完成入队和账目结算，不另做转会。' : '本次不入队、不扣款。'}`;
      await this.announce(tx, scope, group.wechatGroupId, operationId, `${batch.name}\n${lot.playerNameSnapshot}\n${text}`);
      return { fingerprint: { status: value.status, teamId: review.reviewedWinnerTeamId, price: review.reviewedPrice, financial: settlement ? this.financial(settlement) : null }, text };
    }
    const affectedLots = await tx.playerAuctionLot.findMany({ where: { batchId: batch.id, status: { in: ['QUEUED', 'ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'NO_BID'] } }, orderBy: { displayOrder: 'asc' }, select: { id: true, version: true, status: true, playerCardId: true, currentPrice: true, currentHighestBidId: true, startingPrice: true, minimumIncrement: true } });
    const state = this.modules.get(PlayerAuctionStateService, { strict: false });
    let text: string;
    if (c.kind === 'CANCEL') {
      await this.modules.get(AdminPlayerAuctionsService, { strict: false }).cancelWithClient(tx, scope.adminId, scope.leagueId, batch.id, { expectedVersion: p.version, reason: c.reason });
      text = '批次已取消，未结束拍品作废；已成交待审核记录保留，请另行审核。';
    } else {
      const transition = c.kind === 'START' ? await state.startBatch(tx, batch.id, p.version)
        : c.kind === 'PAUSE' ? await state.pauseBatch(tx, batch.id, p.version)
        : c.kind === 'RESUME' ? await state.resumeBatch(tx, batch.id, p.version)
        : await state.recoverBatch(tx, batch.id, p.version);
      text = c.kind === 'START' ? '拍卖开始。' : c.kind === 'PAUSE' ? '拍卖已暂停。' : c.kind === 'RESUME' ? '拍卖继续，保留暂停时剩余时间。' : '拍卖已人工恢复，重新开始30秒倒计时。';
      if (transition.lotId && c.kind === 'START') {
        const lot = await tx.playerAuctionLot.findUniqueOrThrow({ where: { id: transition.lotId } });
        const formatter = new PlayerAuctionMessageFormatter();
        const queued = await tx.playerAuctionLot.findMany({ where: { batchId: batch.id }, orderBy: { displayOrder: 'asc' } });
        text += '\n' + formatter.queue(queued.map(item => ({ displayOrder: item.displayOrder, playerName: item.playerNameSnapshot, startingPrice: item.startingPrice })));
        text += '\n' + formatter.opening({ displayOrder: lot.displayOrder, playerName: lot.playerNameSnapshot, playerSnapshot: lot.playerSnapshot as Record<string, unknown>, startingPrice: lot.startingPrice, minimumIncrement: lot.minimumIncrement });
      }
      await tx.auditLog.create({ data: { actorAdminId: scope.adminId, leagueId: scope.leagueId, action: `admin.player-auction.${c.kind.toLowerCase()}`, resourceType: 'PlayerAuctionBatch', resourceId: batch.id, reason: c.reason, metadata: { operationId, previousStatus: fresh.status } } });
    }
    await this.announce(tx, scope, group.wechatGroupId, operationId, `${batch.name}\n${text}`);
    return { fingerprint: { batchId: batch.id, kind: c.kind, affectedLots }, text };
  }

  private financial(t: { amountMinor: number | null; transactionFeeMinor: number | null; valuationSnapshotMinor: number | null; transactionFeeRuleVersionId: string | null; newSalaryMinor: number | null; sourceLeagueTeamId: string | null; targetLeagueTeamId: string | null; newPlayerCardId: string | null }) {
    return { amount: t.amountMinor, fee: t.transactionFeeMinor, valuation: t.valuationSnapshotMinor, feeRule: t.transactionFeeRuleVersionId, salary: t.newSalaryMinor, source: t.sourceLeagueTeamId, target: t.targetLeagueTeamId, card: t.newPlayerCardId };
  }
  private async requireCurrentSeason(tx: ManagementTx, scope: ManagementScope) {
    const league = await tx.league.findUniqueOrThrow({ where: { id: scope.leagueId } });
    if (league.currentSeasonId !== scope.seasonId) return managementFail('转会及拍卖管理必须选择联赛当前赛季。');
  }
  private async team(tx: ManagementTx, leagueId: string, number: number) {
    const team = await tx.leagueTeam.findFirst({ where: { leagueId, teamNumber: number, status: 'ACTIVE' } });
    return team ?? managementFail('球队编号不存在或球队已退出。');
  }
  private async announce(tx: ManagementTx, scope: ManagementScope, groupId: string, operationId: string, text: string) {
    const pages = paginateWechatMessage('', text.split('\n'));
    for (const [index, page] of pages.entries()) {
      const businessKey = `management:${operationId}:announcement:${index}`;
      await tx.wechatOutboxMessage.upsert({ where: { businessKey }, create: { deviceId: scope.deviceId, targetType: 'GROUP', targetId: groupId, businessKey, text: page, priority: 500 }, update: {} });
    }
  }
}

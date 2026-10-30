import { CupBracketQueriesService } from '../src/competitions/cup-bracket-queries.service.js';
import { CupBracketViewSchema } from '@efm/contracts';
import { createTestApp } from './test-app.js';
import type { INestApplication } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { WechatPrivateManagementService } from '../src/wechat-bot/wechat-private-management.service.js';
import { WechatManagementEffectsService } from '../src/wechat-bot/wechat-management-effects.service.js';
import { PlayerAuctionWorker } from '../src/player-auctions/player-auction-worker.js';
import { PlayerAuctionStateService } from '../src/player-auctions/player-auction-state.service.js';
import { defaultSalaryTiers } from '../src/league-rosters/salary-rules.service.js';
import { WechatBridgeService } from '../src/wechat-bot/wechat-bridge.service.js';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service.js';
import { ResultsService } from '../src/competitions/results.service.js';
import { MutationReceiptService } from '../src/competitions/mutation-receipt.service.js';
import { StandingsService } from '../src/competitions/standings.service.js';
import { CupProgressionService } from '../src/competitions/cup-progression.service.js';
import { WechatPrivateScoreService } from '../src/wechat-bot/wechat-private-score.service.js';
import { AdminWechatAdminsService } from '../src/wechat-bot/admin-wechat-admins.service.js';
import { AdminAuthorizationService } from '../src/admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../src/admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../src/admin/audit-log.service.js';
import type { WechatBotRuntimeConfig } from '../src/wechat-bot/wechat-bot.config.js';

describe('private administrator management integration', () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/test|verify/.test(url.pathname)) throw new Error('isolated database required');
  const db = new PrismaService();
  const adminId = randomUUID(), managerId = randomUUID(), deviceId = randomUUID(), userId = randomUUID(), leagueId = randomUUID();
  const seasonId = randomUUID(), competitionId = randomUUID(), stageId = randomUUID(), matchId = randomUUID();
  let contactId: string, reference: number;
  const config = { privateScoreEnabled: true, privateManagementEnabled: true, heartbeatTimeoutMs: 60000 } as WechatBotRuntimeConfig;
  const results = new ResultsService(db, new MutationReceiptService(db), new StandingsService(db), new CupProgressionService());
  let app: INestApplication, scores: WechatPrivateScoreService;
  const team1 = randomUUID(), team2 = randomUUID(), user2 = randomUUID(), sourceId = randomUUID(), player1 = randomUUID(), player2 = randomUUID(), card1 = randomUUID(), card2 = randomUUID(), ownershipId = randomUUID(), salaryRule = randomUUID(), feeRule = randomUUID(), batchId = randomUUID(), lotId = randomUUID(), groupId = randomUUID();
  const extraLots = [randomUUID(), randomUUID()];
  const catalogs = [randomUUID(), randomUUID()];
  let playerRef: number, batchRef: number, lotRef: number;
  async function managementPreview(text: string) {
    const response = await command(text);
    const code = /确认 ([0-9A-F]{12})/.exec(response)?.[1];
    if (!code) throw new Error(response);
    return code;
  }
  const identities = new AdminWechatAdminsService(db, new AdminAuthorizationService(db), new AdminMutationReceiptService(db), new AuditLogService(db), config);
  async function inbound(text: string, senderId = 'wxid_score_admin') {
    return db.wechatInboundMessage.create({ data: { deviceId, messageId: randomUUID(), conversationType: 'PRIVATE', conversationId: senderId, senderId, commandText: text, wechatSentAt: new Date() } });
  }
  async function command(text: string) { return scores.handle(await inbound(text)); }
  async function preview(score = '2:1') {
    const text = await command(`报分 M${reference} ${score} 原因：赛后核对`);
    const code = /确认 ([0-9A-F]{12})/.exec(text)?.[1];
    if (!code) throw new Error(text);
    return code;
  }
  beforeAll(async () => {
    await db.$connect();
    app = await createTestApp();
    await app.get(PlayerAuctionWorker).onModuleDestroy();
    const effects = new WechatManagementEffectsService(app.get(ModuleRef), results, config);
    scores = new WechatPrivateScoreService(db, results, config, new WechatPrivateManagementService(effects, config));
    await db.adminAccount.createMany({ data: [
      { id: adminId, username: `score-platform-${adminId}`, displayName: '录分平台测试', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN' },
      { id: managerId, username: `score-manager-${managerId}`, displayName: '录分联赛测试', passwordHash: 'unused' }
    ] });
    await db.user.create({ data: { id: userId, wechatOpenId: `score-${userId}`, displayName: '录分测试用户' } });
    await db.league.create({ data: { id: leagueId, name: `录分测试${leagueId}`, shortName: '录分测试', defaultPlatform: 'MOBILE', defaultServerRegion: 'verify', createdByAdminId: adminId } });
    await db.adminLeagueRole.create({ data: { adminId: managerId, leagueId, grantedById: adminId } });
    await db.leagueSeason.create({ data: { id: seasonId, leagueId, seasonNumber: 1, displayName: '验证赛季', registrationOpensAt: new Date(), registrationClosesAt: new Date(), startsAt: new Date(), endsAt: new Date(), superCapacity: 2, championCapacity: 2, promotionCount: 1, createdByAdminId: adminId } });
    await db.league.update({ where: { id: leagueId }, data: { currentSeasonId: seasonId } });
    await db.competition.create({ data: { id: competitionId, name: '录分验证赛事', description: '', platform: 'MOBILE', serverRegion: 'GLOBAL', participantType: 'INDIVIDUAL', format: 'SINGLE_ELIMINATION', competitionType: 'KNOCKOUT_CUP', status: 'IN_PROGRESS', seasonId,
      registrationOpensAt: new Date(), registrationClosesAt: new Date(), startsAt: new Date(), endsAt: new Date(), participantLimit: 2, createdById: userId } });
    const home = await db.competitionParticipant.create({ data: { competitionId, individualUserId: userId, admissionSequence: 1, displayNameSnapshot: '主队' } });
    const away = await db.competitionParticipant.create({ data: { competitionId, admissionSequence: 2, displayNameSnapshot: '客队' } });
    await db.competitionStage.create({ data: { id: stageId, competitionId, sequence: 1, format: 'SINGLE_ELIMINATION', stageCode: 'FINAL', status: 'PUBLISHED' } });
    await db.stageParticipant.createMany({ data: [home, away].map((p, i) => ({ stageId, participantId: p.id, seed: i + 1 })) });
    await db.competitionMatch.create({ data: { id: matchId, stageId, roundNumber: 1, matchNumber: 1, pairingKey: randomUUID(), homeParticipantId: home.id, awayParticipantId: away.id, status: 'AWAITING_RESULT' } });
    await db.wechatBotDevice.create({ data: { id: deviceId, name: '录分验证设备', loginStatus: 'LOGGED_IN', lastHeartbeatAt: new Date(), tokenHash: 'unused', createdByAdminId: adminId } });
    expect(await command('帮助')).toContain('关联管理员账号');
    contactId = (await db.wechatAdminContact.findUniqueOrThrow({ where: { deviceId_wechatContactId: { deviceId, wechatContactId: 'wxid_score_admin' } } })).id;
    await identities.bind(adminId, deviceId, contactId, { adminId: managerId, expectedVersion: 1, reason: '', idempotencyKey: randomUUID() });
    const schedule = await command('赛程');
    expect(schedule).toContain('主：主队 / 客：客队');
    reference = Number(/M(\d+)/.exec(schedule)![1]);
    const proposal = await db.cupBracketProposal.create({ data: { competitionId, version: 1, status: 'CONFIRMED', algorithmVersion: 'verify', randomSeed: 1, bracketSize: 2, createdByAdminId: adminId } });
    const round = await db.cupBracketRound.create({ data: { proposalId: proposal.id, roundNumber: 1, stageCode: 'FINAL', displayName: '决赛' } });
    await db.cupBracketPairing.create({ data: { roundId: round.id, pairingNumber: 1, homeParticipantId: home.id, awayParticipantId: away.id, matchId } });
    await db.user.create({ data: { id: user2, displayName: '管理测试用户2', wechatOpenId: `management-${user2}` } });
    await db.teamCatalogItem.createMany({ data: catalogs.map((id, i) => ({ id, sourceType: 'CUSTOM', nameZh: `管理测试队${i}`, shortName: `队${i}` })) });
    for (const [id, user, catalog, n] of [[team1, userId, catalogs[0], 1], [team2, user2, catalogs[1], 2]] as const) await db.leagueTeam.create({ data: { id, leagueId, ownerUserId: user, ownerAlias: '测试', catalogTeamId: catalog!, teamNumber: n, name: `测试队${n}`, shortName: `队${n}`, salaryCapMinor: 100000 } });
    await db.leagueSalaryRuleVersion.create({ data: { id: salaryRule, leagueId, version: 1, salaryCapMinor: 100000, effectiveAt: new Date(0), createdByAdminId: adminId, tiers: { create: defaultSalaryTiers() } } });
    await db.transferWindow.create({ data: { seasonId, name: '管理测试窗口', startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000), allowBuy: true, allowSell: true, allowTransfer: true, allowCardUpgrade: true, createdByAdminId: adminId } });
    await db.dataSource.create({ data: { id: sourceId, code: `management-${sourceId}`, name: '管理测试数据' } });
    for (const [id, card] of [[player1, card1], [player2, card2]] as const) {
      await db.footballPlayer.create({ data: { id, nameZh: '管理测试球员' } });
      await db.playerCard.create({ data: { id: card, sourceId, playerId: id!, externalId: card!, cardName: '测试卡', position: 'CB', overallRating: 93, cardType: 'STANDARD', autoBuilds: { create: { algorithmVersion: 'verify', allocationJson: {}, maxOverall: 93, dtRating: 93 } } } });
      await db.leaguePlayerValuation.create({ data: { leagueId, footballPlayerId: id!, currentValueMinor: 1000, effectiveAt: new Date(0) } });
    }
    await db.leagueTransactionFeeRuleVersion.create({ data: { id: feeRule, leagueId, version: 1, rateBps: 100, minimumFeeMinor: 0, effectiveAt: new Date(0), createdByAdminId: adminId } });
    await db.leaguePlayerOwnership.create({ data: { id: ownershipId, leagueId, leagueTeamId: team1, footballPlayerId: player1, currentPlayerCardId: card1, maxOverallSnapshot: 93, salaryRuleVersionId: salaryRule, salaryMinor: 100 } });
    playerRef = Number(/P(\d+)/.exec(await command('阵容 T1'))![1]);
    const observed = await db.wechatObservedGroup.create({ data: { deviceId, wechatGroupId: 'management@chatroom', displayName: '管理测试群' } });
    await db.wechatGroupBinding.create({ data: { id: groupId, observedGroupId: observed.id, leagueId, deviceId, wechatGroupId: 'management@chatroom', displayName: '管理测试群', capabilities: { create: { capability: 'PLAYER_AUCTION', createdByAdminId: adminId } } } });
    await db.playerAuctionBatch.create({ data: { id: batchId, leagueId, groupBindingId: groupId, name: '管理测试拍卖', status: 'READY', createdByAdminId: adminId } });
    await db.playerAuctionLot.create({ data: { id: lotId, batchId, footballPlayerId: player2, playerCardId: card2, displayOrder: 1, playerNameSnapshot: '拍卖球员', playerSnapshot: {}, startingPrice: 10, minimumIncrement: 10 } });
    batchRef = Number(/A(\d+)/.exec(await command('拍卖列表'))![1]);
    lotRef = Number(/L(\d+)/.exec(await command(`拍卖 A${batchRef}`))![1]);
  });
  afterAll(async () => {
    await app?.close();
    await db.$transaction(async (tx) => {
      await tx.wechatAdminOperation.deleteMany({ where: { leagueId } });
      await tx.wechatEntityReference.deleteMany({ where: { entityId: { in: [ownershipId, batchId, lotId, ...extraLots] } } });
      await tx.wechatOutboxMessage.deleteMany({ where: { deviceId } });
      await tx.playerAuctionReview.deleteMany({ where: { lot: { batchId } } });
      await tx.playerAuctionBatch.updateMany({ where: { id: batchId }, data: { currentLotId: null } });
      await tx.playerAuctionLot.deleteMany({ where: { batchId } });
      await tx.playerAuctionBatch.deleteMany({ where: { id: batchId } });
      await tx.wechatGroupCapability.deleteMany({ where: { groupBindingId: groupId } });
      await tx.wechatGroupBinding.deleteMany({ where: { id: groupId } });
      await tx.financeLedgerEntry.deleteMany({ where: { leagueId } });
      await tx.rosterTransaction.deleteMany({ where: { leagueId } });
      await tx.leaguePlayerOwnership.deleteMany({ where: { leagueId } });
      await tx.leaguePlayerValuation.deleteMany({ where: { leagueId } });
      await tx.leagueTransactionFeeRuleVersion.deleteMany({ where: { leagueId } });
      await tx.transferWindow.deleteMany({ where: { seasonId } });
      await tx.leagueSalaryRuleVersion.deleteMany({ where: { leagueId } });
      await tx.leagueTeam.deleteMany({ where: { leagueId } });
      await tx.teamCatalogItem.deleteMany({ where: { id: { in: catalogs } } });
      await tx.playerCardAutoBuild.deleteMany({ where: { playerCardId: { in: [card1, card2] } } });
      await tx.playerCard.deleteMany({ where: { id: { in: [card1, card2] } } });
      await tx.footballPlayer.deleteMany({ where: { id: { in: [player1, player2] } } });
      await tx.dataSource.deleteMany({ where: { id: sourceId } });
      await tx.cupBracketPairing.deleteMany({ where: { round: { proposal: { competitionId } } } });
      await tx.cupBracketRound.deleteMany({ where: { proposal: { competitionId } } });
      await tx.cupBracketProposal.deleteMany({ where: { competitionId } });
      await tx.wechatScoreOperation.deleteMany({ where: { contact: { deviceId } } });
      await tx.wechatMatchReference.deleteMany({ where: { matchId } });
      await tx.wechatAdminContact.deleteMany({ where: { deviceId } });
      await tx.wechatInboundMessage.deleteMany({ where: { deviceId } });
      await tx.wechatObservedGroup.deleteMany({ where: { deviceId } });
      await tx.wechatBotDevice.deleteMany({ where: { id: deviceId } });
      await tx.auditLog.deleteMany({ where: { actorAdminId: { in: [adminId, managerId] } } });
      await tx.adminMutationReceipt.deleteMany({ where: { adminId: { in: [adminId, managerId] } } });
      await tx.standingsRow.deleteMany({ where: { snapshot: { competitionId } } });
      await tx.standingsSnapshot.deleteMany({ where: { competitionId } });
      await tx.competitionMatch.updateMany({ where: { id: matchId }, data: { officialResultVersionId: null } });
      await tx.matchResultEvent.deleteMany({ where: { matchId } });
      await tx.matchResultVersion.deleteMany({ where: { matchId } });
      await tx.competitionMatch.deleteMany({ where: { id: matchId } });
      await tx.stageParticipant.deleteMany({ where: { stageId } });
      await tx.competitionStage.deleteMany({ where: { id: stageId } });
      await tx.competitionParticipant.deleteMany({ where: { competitionId } });
      await tx.competition.deleteMany({ where: { id: competitionId } });
      await tx.league.updateMany({ where: { id: leagueId }, data: { currentSeasonId: null } });
      await tx.leagueSeason.deleteMany({ where: { id: seasonId } });
      await tx.adminLeagueRole.deleteMany({ where: { leagueId } });
      await tx.league.deleteMany({ where: { id: leagueId } });
      await tx.adminAccount.deleteMany({ where: { id: { in: [adminId, managerId] } } });
      await tx.user.deleteMany({ where: { id: { in: [userId, user2] } } });
    });
    expect(await db.wechatAdminContact.count({ where: { deviceId } })).toBe(0);
    expect(await db.competitionMatch.count({ where: { id: matchId } })).toBe(0);
    await db.$disconnect();
  });

  it('previews and confirms advancement without fake scores, and replays exactly once', async () => {
    const code = await managementPreview(`晋级 M${reference} 客队 原因：主队弃权`);
    expect((await db.competitionMatch.findUniqueOrThrow({ where: { id: matchId } })).advancementWinnerParticipantId).toBeNull();
    const replies = await Promise.all([command(`确认 ${code}`), command(`确认 ${code}`)]);
    expect(replies[0]).toContain('操作成功'); expect(replies[1]).toBe(replies[0]);
    const m = await db.competitionMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(m.advancementWinnerParticipantId).toBe(m.awayParticipantId);
    expect(m.officialResultVersionId).toBeNull();
    expect(await db.matchResultVersion.count({ where: { matchId } })).toBe(0);
    expect(await db.auditLog.count({ where: { resourceId: matchId, action: 'admin.competition-result.advance' } })).toBe(1);
    expect(await command('赛程')).toContain('裁定客队晋级');
    const bracket = CupBracketViewSchema.parse(await app.get(CupBracketQueriesService).getPublished(competitionId));
    expect(bracket.rounds[0]!.pairings[0]!.match).toMatchObject({ advancement: { winnerParticipantId: m.awayParticipantId, reason: '主队弃权' }, homeScore: null, awayScore: null });
  });
  it('rolls back transfer preview and changed fees, then settles one transfer on duplicate confirmation', async () => {
    const code = await managementPreview(`转会 P${playerRef} T1 T2 500 原因：双方同意`);
    expect(await db.rosterTransaction.count({ where: { leagueId } })).toBe(0);
    expect((await db.leaguePlayerOwnership.findUniqueOrThrow({ where: { id: ownershipId } })).leagueTeamId).toBe(team1);
    await db.leagueTransactionFeeRuleVersion.update({ where: { id: feeRule }, data: { rateBps: 200 } });
    expect(await command(`确认 ${code}`)).toContain('已回滚');
    expect(await db.financeLedgerEntry.count({ where: { leagueId } })).toBe(0);
    const fresh = await managementPreview(`转会 P${playerRef} T1 T2 500 原因：双方同意`);
    expect(await command(`确认 ${fresh}`)).toContain('操作成功');
    expect(await command(`确认 ${fresh}`)).toContain('操作成功');
    expect((await db.leaguePlayerOwnership.findUniqueOrThrow({ where: { id: ownershipId } })).leagueTeamId).toBe(team2);
    expect(await db.rosterTransaction.count({ where: { leagueId, type: 'TRANSFER' } })).toBe(1);
    expect(await db.financeLedgerEntry.count({ where: { leagueId } })).toBe(3);
  });
  it('controls only the bound auction group and requires explicit recovery', async () => {
    const start = await managementPreview(`开始拍卖 A${batchRef}`);
    expect(await db.wechatOutboxMessage.count({ where: { deviceId } })).toBe(0);
    expect(await command(`确认 ${start}`)).toContain('拍卖开始');
    expect(await command(`暂停拍卖 A${batchRef}`)).toContain('已暂停');
    const resume = await managementPreview(`继续拍卖 A${batchRef}`);
    expect(await command(`确认 ${resume}`)).toContain('拍卖继续');
    await app.get(PlayerAuctionStateService).enterRecovery(groupId, 'verify');
    expect(await command(`继续拍卖 A${batchRef}`)).not.toContain('管理操作预览');
    for (const failureCode of ['WECHAT_SEND_UNCONFIRMED', 'PROCESS_RESTART_DURING_SEND', 'WECHAT_SEND_EXCEPTION']) {
      const uncertain = await db.wechatOutboxMessage.create({ data: { deviceId, targetType: 'GROUP', targetId: 'management@chatroom', businessKey: randomUUID(), text: '待核对', status: 'FAILED', failureCode } });
      expect(await command(`恢复拍卖 A${batchRef} 原因：已核对消息`)).toContain('发送不确定');
      await db.wechatOutboxMessage.delete({ where: { id: uncertain.id } });
    }
    const leased = await db.wechatOutboxMessage.create({ data: {
      deviceId, targetType: 'GROUP', targetId: 'management@chatroom', businessKey: randomUUID(), text: '旧发送中任务',
      status: 'LEASED', createdAt: new Date(Date.now() - 86_400_000)
    } });
    expect(await command(`恢复拍卖 A${batchRef} 原因：已核对消息`)).toContain('发送不确定');
    await db.wechatOutboxMessage.delete({ where: { id: leased.id } });
    const historical = await db.wechatOutboxMessage.create({ data: {
      deviceId, targetType: 'GROUP', targetId: 'management@chatroom', businessKey: randomUUID(), text: '旧任务',
      status: 'FAILED', failureCode: 'WECHAT_SEND_UNCONFIRMED', createdAt: new Date(Date.now() - 86_400_000)
    } });
    const recovery = await managementPreview(`恢复拍卖 A${batchRef} 原因：已核对消息`);
    await db.wechatOutboxMessage.delete({ where: { id: historical.id } });
    for (const failureCode of ['WECHAT_SEND_UNCONFIRMED', 'PROCESS_RESTART_DURING_SEND', 'WECHAT_SEND_EXCEPTION']) {
      const uncertain = await db.wechatOutboxMessage.create({ data: { deviceId, targetType: 'GROUP', targetId: 'management@chatroom', businessKey: randomUUID(), text: '待核对', status: 'FAILED', failureCode } });
      expect(await command(`确认 ${recovery}`)).toContain('发送不确定');
      expect((await db.playerAuctionBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe('RECOVERY_REQUIRED');
      await db.wechatOutboxMessage.delete({ where: { id: uncertain.id } });
    }
    expect(await command(`确认 ${recovery}`)).toContain('人工恢复');
    const announcements = await db.wechatOutboxMessage.findMany({ where: { deviceId } });
    expect(announcements).toHaveLength(4);
    expect(announcements.every((a) => a.targetId === 'management@chatroom')).toBe(true);
  });
  it('reviews auction into the roster once with fee preview and private replay protection', async () => {
    await db.playerAuctionBatch.update({ where: { id: batchId }, data: { status: 'COMPLETED', currentLotId: null, version: { increment: 1 } } });
    await db.playerAuctionLot.update({ where: { id: lotId }, data: { status: 'PENDING_REVIEW', deadlineAt: null, currentPrice: 100, version: { increment: 1 } } });
    const code = await managementPreview(`调整成交 L${lotRef} T2 100 原因：核实最终报价`);
    expect(await db.playerAuctionReview.count({ where: { lotId } })).toBe(0);
    expect(await db.leaguePlayerOwnership.count({ where: { leagueId, footballPlayerId: player2 } })).toBe(0);
    const answers = await Promise.all([command(`确认 ${code}`), command(`确认 ${code}`)]);
    expect(answers[0]).toContain('操作成功'); expect(answers[1]).toBe(answers[0]);
    expect(await db.playerAuctionReview.count({ where: { lotId } })).toBe(1);
    expect(await db.leaguePlayerOwnership.count({ where: { leagueId, footballPlayerId: player2, leagueTeamId: team2 } })).toBe(1);
  });
  it('rejects expired and cancelled confirmations without changing advancement', async () => {
    const before = await db.competitionMatch.findUniqueOrThrow({ where: { id: matchId } });
    const expired = await managementPreview(`晋级 M${reference} 主队 原因：过期验证`);
    await db.wechatAdminOperation.update({ where: { code: expired }, data: { expiresAt: new Date(0) } });
    expect(await command(`确认 ${expired}`)).toContain('已过期');
    const cancelled = await managementPreview(`晋级 M${reference} 主队 原因：取消验证`);
    expect(await command(`取消 ${cancelled}`)).toContain('已取消');
    expect(await command(`确认 ${cancelled}`)).toContain('已取消');
    expect((await db.competitionMatch.findUniqueOrThrow({ where: { id: matchId } })).version).toBe(before.version);
  });
  it('confirms no-bid and void reviews without ownership or ledger writes', async () => {
    const before = await db.financeLedgerEntry.count({ where: { leagueId } });
    for (const [i, id] of extraLots.entries()) {
      await db.playerAuctionLot.create({ data: { id, batchId, footballPlayerId: player1, playerCardId: card1, displayOrder: i + 2, playerNameSnapshot: '审核验证', playerSnapshot: {}, startingPrice: 10, minimumIncrement: 10, status: i === 0 ? 'NO_BID' : 'PENDING_REVIEW' } });
      const ref = await db.wechatEntityReference.create({ data: { kind: 'LOT', entityId: id } });
      const code = await managementPreview(i === 0 ? `审核成交 L${ref.id}` : `作废成交 L${ref.id} 原因：无效出价`);
      expect(await command(`确认 ${code}`)).toContain('操作成功');
      expect(await command(`确认 ${code}`)).toContain('操作成功');
    }
    expect(await db.financeLedgerEntry.count({ where: { leagueId } })).toBe(before);
    expect(await db.playerAuctionReview.count({ where: { lot: { batchId } } })).toBe(3);
  });
  it('rejects changed group and lot state before cancellation, then cancels without altering reviewed lots', async () => {
    await db.playerAuctionBatch.update({ where: { id: batchId }, data: { status: 'READY', version: { increment: 1 } } });
    await db.playerAuctionLot.update({ where: { id: extraLots[1]! }, data: { status: 'QUEUED', version: { increment: 1 } } });
    const changedGroup = await managementPreview(`取消拍卖 A${batchRef} 原因：取消批次`);
    await db.wechatGroupBinding.update({ where: { id: groupId }, data: { version: { increment: 1 } } });
    expect(await command(`确认 ${changedGroup}`)).toContain('群绑定已变化');
    const changedLot = await managementPreview(`取消拍卖 A${batchRef} 原因：取消批次`);
    await db.playerAuctionLot.update({ where: { id: extraLots[1]! }, data: { startingPrice: 20, version: { increment: 1 } } });
    expect(await command(`确认 ${changedLot}`)).toContain('已回滚');
    expect((await db.playerAuctionBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe('READY');
    const valid = await managementPreview(`取消拍卖 A${batchRef} 原因：取消批次`);
    expect(await command(`确认 ${valid}`)).toContain('批次已取消');
    expect((await db.playerAuctionLot.findUniqueOrThrow({ where: { id: lotId } })).status).toBe('REVIEWED');
    expect((await db.playerAuctionLot.findUniqueOrThrow({ where: { id: extraLots[1]! } })).status).toBe('VOID');
  });
  it('revoked permission and unbinding prevent pending management confirmations', async () => {
    const code = await managementPreview(`晋级 M${reference} 主队 原因：改判`);
    await db.adminLeagueRole.updateMany({ where: { adminId: managerId }, data: { revokedAt: new Date() } });
    expect(await command(`确认 ${code}`)).toContain('没有该联赛');
    await db.adminLeagueRole.updateMany({ where: { adminId: managerId }, data: { revokedAt: null } });
    const contact = await db.wechatAdminContact.findUniqueOrThrow({ where: { id: contactId } });
    await identities.bind(adminId, deviceId, contactId, { adminId: null, expectedVersion: contact.version, reason: '', idempotencyKey: randomUUID() });
    expect((await db.wechatAdminOperation.findUniqueOrThrow({ where: { code } })).status).toBe('CANCELLED');
    expect(await command(`确认 ${code}`)).toContain('关联管理员');
  });
});

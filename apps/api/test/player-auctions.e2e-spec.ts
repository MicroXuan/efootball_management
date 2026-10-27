import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PasswordService } from '../src/admin-auth/password.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { defaultSalaryTiers } from '../src/league-rosters/salary-rules.service.js';
import { PlayerBuildsService } from '../src/player-builds/player-builds.service.js';
import { PlayerAuctionRecoveryService } from '../src/player-auctions/player-auction-recovery.service.js';
import { PlayerAuctionWorker } from '../src/player-auctions/player-auction-worker.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('Player auction group acceptance', () => {
  const prisma = new PrismaService();
  const runId = randomUUID();
  const groupWechatId = `auction-${runId}@chatroom`;
  const contacts = [`auction-manager-${runId}`, `auction-bidder-${runId}`];
  let app: INestApplication;
  let worker: PlayerAuctionWorker;
  let recovery: PlayerAuctionRecoveryService;
  let adminId = '';
  let adminToken = '';
  let deviceId = '';
  let deviceToken = '';
  let groupBindingId = '';
  let leagueId = '';
  let sourceId = '';
  let seasonId = '';
  let salaryRuleId = '';
  let roleBindingId = '';
  const userIds: string[] = [];
  const userTokens: string[] = [];
  const leagueIds: string[] = [];
  const teamIds: string[] = [];
  const catalogIds: string[] = [];
  const playerIds: string[] = [];
  const cardIds: string[] = [];
  const batchIds: string[] = [];

  const adminHeaders = () => ({ Authorization: `Bearer ${adminToken}`, 'Idempotency-Key': randomUUID() });
  const bridgeHeaders = (path: string) => {
    const timestamp = new Date().toISOString();
    const nonce = randomUUID();
    return {
      Authorization: `Bridge ${deviceToken}`,
      'X-Bridge-Device': deviceId,
      'X-Bridge-Timestamp': timestamp,
      'X-Bridge-Nonce': nonce,
      'X-Bridge-Signature': createHmac('sha256', deviceToken).update(`POST\n${path}\n${timestamp}\n${nonce}`).digest('hex')
    };
  };
  const bridgePost = (path: string, body: object) => request(app.getHttpServer()).post(path).set(bridgeHeaders(path)).send(body);
  const groupMessage = async (senderId: string, text: string, messageId = `auction-message-${randomUUID()}`) => {
    const databaseRows = await prisma.$queryRaw<Array<{ databaseNow: Date }>>`SELECT CURRENT_TIMESTAMP(3) AS databaseNow`;
    const databaseNow = databaseRows[0]!.databaseNow;
    const result = await bridgePost('/v1/wechat-bot/bridge/messages', { messages: [{
      messageId, conversationType: 'GROUP', conversationId: groupWechatId, senderId,
      sentAt: databaseNow!.toISOString(), sequence: `${databaseNow!.getTime()}-${messageId}`, messageType: 'TEXT', text
    }] }).expect(200);
    return { messageId, result: result.body.results[0] as { status: string; inboundId: string | null } };
  };
  const createPreparedBatch = async (name: string, lotCount: number, options: { targetLeagueId?: string; targetGroupBindingId?: string; bidChannel?: 'WECHAT_GROUP' | 'MINIPROGRAM'; playerOffset?: number } = {}) => {
    const targetLeagueId = options.targetLeagueId ?? leagueId;
    const created = await request(app.getHttpServer()).post(`/v1/admin/leagues/${targetLeagueId}/player-auctions`)
      .set(adminHeaders()).send({ groupBindingId: options.targetGroupBindingId ?? groupBindingId, name, bidChannel: options.bidChannel ?? 'WECHAT_GROUP', expectedVersion: 1 }).expect(201);
    const batchId = created.body.id as string; batchIds.push(batchId);
    const configured = await request(app.getHttpServer()).put(`/v1/admin/leagues/${targetLeagueId}/player-auctions/${batchId}/lots`)
      .set(adminHeaders()).send({ expectedVersion: created.body.version, lots: playerIds.slice(options.playerOffset ?? 0, (options.playerOffset ?? 0) + lotCount).map((playerId, index) => ({
        playerId, playerCardId: cardIds[(options.playerOffset ?? 0) + index], displayOrder: index + 1,
        startingPrice: 50 + index * 20, minimumIncrement: 10 + index * 10
      })) }).expect(200);
    const prepared = await request(app.getHttpServer()).post(`/v1/admin/leagues/${targetLeagueId}/player-auctions/${batchId}/prepare`)
      .set(adminHeaders()).send({ expectedVersion: configured.body.version }).expect(201);
    return prepared.body as { id: string; version: number; lots: Array<{ id: string; version: number }> };
  };
  const closeLot = async (lotId: string) => {
    const lot = await prisma.playerAuctionLot.update({ where: { id: lotId }, data: { deadlineAt: new Date(Date.now() - 1_000) } });
    const closedByThisCall = await worker.closeDueLot(lot.id, lot.deadlineEpoch);
    if (!closedByThisCall) {
      expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: lot.id } })).status).not.toBe('ACTIVE');
    }
  };

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    worker = app.get(PlayerAuctionWorker);
    recovery = app.get(PlayerAuctionRecoveryService);
    const passwordService = app.get(PasswordService);
    const admin = await prisma.adminAccount.create({ data: {
      username: `auction-${runId}`, displayName: '拍卖验收管理员',
      passwordHash: await passwordService.hash('auction-password-123'), platformRole: 'PLATFORM_ADMIN'
    } });
    adminId = admin.id;
    const login = await request(app.getHttpServer()).post('/v1/admin/auth/login')
      .send({ username: admin.username, password: 'auction-password-123' }).expect(200);
    adminToken = login.body.accessToken as string;

    const users = [];
    for (const [index, displayName] of ['拍卖管理员', '竞价球队', '已退出球队'].entries()) {
      const login = await request(app.getHttpServer()).post('/v1/auth/wechat')
        .send({ code: `test-code-auction-${index}-${runId}` }).expect(200);
      userTokens.push(login.body.accessToken as string);
      const user = await prisma.user.update({
        where: { wechatOpenId: `test-openid-auction-${index}-${runId}` },
        data: { displayName }
      });
      users.push(user);
    }
    userIds.push(...users.map((user) => user.id));
    const league = await prisma.league.create({ data: {
      name: `拍卖验收联赛 ${runId.slice(0, 8)}`, shortName: '拍卖验收', edition: 'NATIONAL',
      defaultPlatform: 'MOBILE', defaultServerRegion: 'CN', createdByAdminId: adminId
    } });
    leagueId = league.id;
    leagueIds.push(league.id);
    const season = await prisma.leagueSeason.create({ data: {
      leagueId, seasonNumber: 1, displayName: '拍卖验收 S1', isFirstSeason: true,
      registrationOpensAt: new Date(Date.now() - 20 * 86_400_000),
      registrationClosesAt: new Date(Date.now() - 15 * 86_400_000),
      startsAt: new Date(Date.now() - 10 * 86_400_000),
      endsAt: new Date(Date.now() + 20 * 86_400_000),
      superCapacity: 23, championCapacity: 18, promotionCount: 4, createdByAdminId: adminId
    } });
    seasonId = season.id;
    await prisma.league.update({ where: { id: leagueId }, data: { currentSeasonId: seasonId } });
    salaryRuleId = (await prisma.leagueSalaryRuleVersion.create({ data: {
      leagueId, version: 1, salaryCapMinor: 10_000, effectiveAt: new Date(Date.now() - 86_400_000),
      createdByAdminId: adminId, tiers: { create: defaultSalaryTiers() }
    } })).id;
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'LEAGUE_MANAGER' } });
    const auctionPermission = await prisma.permission.upsert({
      where: { code: 'league.auction.manage' }, update: {},
      create: { code: 'league.auction.manage', name: 'Manage league player auctions' }
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: managerRole.id, permissionId: auctionPermission.id } },
      update: {}, create: { roleId: managerRole.id, permissionId: auctionPermission.id }
    });
    roleBindingId = (await prisma.userRoleBinding.create({ data: {
      userId: userIds[0]!, roleId: managerRole.id, scopeType: 'LEAGUE', scopeId: leagueId
    } })).id;
    const teamNames = [{ name: '上海申花', shortName: '申花' }, { name: '成都蓉城', shortName: '蓉城' }, { name: '退出球队', shortName: '退出' }] as const;
    for (let index = 0; index < users.length; index += 1) {
      const teamName = teamNames[index]!;
      const catalog = await prisma.teamCatalogItem.create({ data: {
        sourceType: 'CUSTOM', nameZh: teamName.name, shortName: teamName.shortName
      } });
      catalogIds.push(catalog.id);
      const team = await prisma.leagueTeam.create({ data: {
        leagueId, ownerUserId: users[index]!.id, ownerAlias: users[index]!.displayName,
        catalogTeamId: catalog.id, teamNumber: index + 1, name: teamName.name, shortName: teamName.shortName,
        status: index === 2 ? 'ARCHIVED' : 'ACTIVE', salaryCapMinor: 10_000
      } });
      teamIds.push(team.id);
    }
    const source = await prisma.dataSource.create({ data: { code: `auction-${runId}`, name: '拍卖验收数据源', type: 'MANUAL' } });
    sourceId = source.id;
    const playerNames = ['车范根', '詹卢卡·赞布罗塔', '马赛洛', '皮尔洛', '卡卡', '舍甫琴科', '马尔蒂尼'] as const;
    for (let index = 0; index < playerNames.length; index += 1) {
      const player = await prisma.footballPlayer.create({ data: {
        nameZh: playerNames[index]!, publishedAt: new Date()
      } });
      playerIds.push(player.id);
      const card = await prisma.playerCard.create({ data: {
        sourceId, externalId: `auction-card-${index}-${runId}`, playerId: player.id,
        cardName: '传奇', position: index === 0 ? 'CF' : index === 1 ? 'RB' : 'LB',
        overallRating: 96 - index, cardType: 'LEGENDARY', publishedAt: new Date()
      } });
      cardIds.push(card.id);
      await new PlayerBuildsService(prisma).save(card.id, {
        autoBuildAllocation: { passing: 10 }, autoBuildMaxOverall: 96 - index,
        dtRating: 96 - index, algorithmVersion: 'auction-e2e-v1'
      });
    }

    const device = await request(app.getHttpServer()).post('/v1/admin/wechat-bot/devices')
      .set({ Authorization: `Bearer ${adminToken}` }).send({ name: 'Windows 拍卖验收机器人' }).expect(201);
    deviceId = device.body.device.id as string; deviceToken = device.body.token as string;
    await bridgePost('/v1/wechat-bot/bridge/heartbeat', {
      wechatAccountId: `auction-bot-${runId}`, wechatVersion: '4.1.15.50', loginStatus: 'LOGGED_IN',
      listenerWatermark: 'auction-setup', screenLocked: false, outboundQueueDepth: 0,
      observedGroups: [{ wechatGroupId: groupWechatId, displayName: 'CELL 拍卖验收群' }]
    }).expect(200);
    const observed = await prisma.wechatObservedGroup.findUniqueOrThrow({ where: { deviceId_wechatGroupId: { deviceId, wechatGroupId: groupWechatId } } });
    const binding = await request(app.getHttpServer()).put(`/v1/admin/leagues/${leagueId}/wechat-bot/group`)
      .set({ Authorization: `Bearer ${adminToken}` }).send({
        deviceId, observedGroupId: observed.id, enabled: true,
        capabilities: ['PLAYER_AUCTION'], scheduleSourceIds: []
      }).expect(200);
    groupBindingId = binding.body.id as string;
    await Promise.all(users.slice(0, 2).map((user, index) => prisma.wechatIdentityBinding.create({ data: {
      deviceId, wechatContactId: contacts[index]!, userId: user.id, status: 'ACTIVE'
    } })));
  });

  afterAll(async () => {
    if (batchIds.length) {
      await prisma.playerAuctionReview.deleteMany({ where: { lot: { batchId: { in: batchIds } } } });
      await prisma.playerAuctionLot.updateMany({ where: { batchId: { in: batchIds } }, data: { currentHighestBidId: null } });
      await prisma.playerAuctionBid.deleteMany({ where: { lot: { batchId: { in: batchIds } } } });
      await prisma.playerAuctionBatch.updateMany({ where: { id: { in: batchIds } }, data: { currentLotId: null } });
      await prisma.playerAuctionLot.deleteMany({ where: { batchId: { in: batchIds } } });
      await prisma.playerAuctionBatch.deleteMany({ where: { id: { in: batchIds } } });
    }
    if (deviceId) {
      await prisma.wechatIdentityBinding.deleteMany({ where: { deviceId } });
      await prisma.wechatOutboxMessage.deleteMany({ where: { deviceId } });
      await prisma.wechatInboundMessage.deleteMany({ where: { deviceId } });
      await prisma.wechatBridgeRequestReceipt.deleteMany({ where: { deviceId } });
      await prisma.wechatGroupScheduleSource.deleteMany({ where: { groupBinding: { deviceId } } });
      await prisma.wechatGroupCapability.deleteMany({ where: { groupBinding: { deviceId } } });
      await prisma.wechatGroupBinding.deleteMany({ where: { deviceId } });
      await prisma.wechatObservedGroup.deleteMany({ where: { deviceId } });
      await prisma.wechatBotDevice.deleteMany({ where: { id: deviceId } });
    }
    if (adminId) await prisma.adminMutationReceipt.deleteMany({ where: { adminId } });
    await prisma.auditLog.deleteMany({ where: { actorAdminId: adminId } });
    if (leagueIds.length) {
      await prisma.financeLedgerEntry.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await prisma.rosterTransaction.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await prisma.leaguePlayerOwnership.deleteMany({ where: { leagueId: { in: leagueIds } } });
    }
    if (playerIds.length) await prisma.footballPlayerBestCard.deleteMany({ where: { footballPlayerId: { in: playerIds } } });
    if (cardIds.length) await prisma.playerCardAutoBuild.deleteMany({ where: { playerCardId: { in: cardIds } } });
    if (cardIds.length) await prisma.playerCard.deleteMany({ where: { id: { in: cardIds } } });
    if (playerIds.length) await prisma.footballPlayer.deleteMany({ where: { id: { in: playerIds } } });
    if (sourceId) await prisma.dataSource.deleteMany({ where: { id: sourceId } });
    if (roleBindingId) await prisma.userRoleBinding.deleteMany({ where: { id: roleBindingId } });
    if (teamIds.length) await prisma.leagueTeam.deleteMany({ where: { id: { in: teamIds } } });
    if (catalogIds.length) await prisma.teamCatalogItem.deleteMany({ where: { id: { in: catalogIds } } });
    if (salaryRuleId) {
      await prisma.leagueSalaryTier.deleteMany({ where: { salaryRuleVersionId: salaryRuleId } });
      await prisma.leagueSalaryRuleVersion.delete({ where: { id: salaryRuleId } });
    }
    if (seasonId) {
      await prisma.league.update({ where: { id: leagueId }, data: { currentSeasonId: null } });
      await prisma.leagueSeason.delete({ where: { id: seasonId } });
    }
    if (leagueIds.length) await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    if (userIds.length) await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminSession.deleteMany({ where: { adminId } });
    await prisma.adminAccount.deleteMany({ where: { id: adminId } });
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it('runs three lots with automatic bid/no-bid progression, exact countdowns, and background review', async () => {
    const batch = await createPreparedBatch('端到端三人拍卖', 3);
    await groupMessage(contacts[0]!, '开始拍卖');
    const first = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[0]!.id } });
    const startReply = await prisma.wechatOutboxMessage.findFirst({ where: { deviceId }, orderBy: { createdAt: 'desc' } });
    expect(first.status).toBe('ACTIVE');
    expect(startReply?.text).toContain('接下来即将拍卖的球员：');
    expect(startReply?.text).toContain('提名拍卖：第1名球员拍卖开始！');

    const currentIdentity = await prisma.wechatIdentityBinding.findUniqueOrThrow({ where: { deviceId_wechatContactId: { deviceId, wechatContactId: contacts[0]! } } });
    const backlogId = `before-binding-${randomUUID()}`;
    await bridgePost('/v1/wechat-bot/bridge/messages', { messages: [{
      messageId: backlogId, conversationType: 'GROUP', conversationId: groupWechatId, senderId: contacts[0]!,
      sentAt: new Date(currentIdentity.boundAt.getTime() - 1000).toISOString(), sequence: '0001', messageType: 'TEXT', text: '999'
    }] }).expect(200);
    const rejectedBacklog = await prisma.playerAuctionBid.findFirstOrThrow({ where: { wechatMessageId: backlogId } });
    expect(rejectedBacklog).toMatchObject({ result: 'UNBOUND', identityBindingId: null, userId: null });
    expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: first.id } })).currentPrice).toBeNull();

    await groupMessage(contacts[0]!, '40');
    expect((await prisma.playerAuctionBid.findFirstOrThrow({ where: { lotId: first.id, amount: 40 } })).result).toBe('BELOW_STARTING_PRICE');
    await groupMessage(contacts[0]!, '50');
    await groupMessage(contacts[1]!, '70');
    const afterBid = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: first.id } });
    expect(afterBid.currentPrice).toBe(70);
    expect(afterBid.deadlineAt!.getTime()).toBeGreaterThan(Date.now() + 25_000);

    for (const remaining of [20, 10, 5, 4, 3, 2, 1]) {
      await prisma.playerAuctionLot.update({ where: { id: first.id }, data: { deadlineAt: new Date(Date.now() + remaining * 1_000) } });
      await worker.tick();
    }
    const countdowns = await prisma.wechatOutboxMessage.findMany({
      where: { deviceId, businessKey: { startsWith: `auction:${first.id}:epoch:${afterBid.deadlineEpoch}:countdown:` } },
      orderBy: { createdAt: 'asc' }, select: { text: true }
    });
    expect(countdowns.map((message) => message.text)).toEqual(['20', '10', '3', '2', '1']);
    await closeLot(first.id);
    expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('PENDING_REVIEW');
    expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[1]!.id } })).status).toBe('ACTIVE');
    expect((await prisma.playerAuctionBatch.findUniqueOrThrow({ where: { id: batch.id } })).currentLotId).toBe(batch.lots[1]!.id);
    const firstTransition = await prisma.wechatOutboxMessage.findMany({
      where: { businessKey: { in: [
        `auction:${first.id}:epoch:${afterBid.deadlineEpoch}:closed`,
        `auction:${batch.lots[1]!.id}:epoch:1:opened`
      ] } }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]
    });
    expect(firstTransition.map((message) => message.businessKey)).toEqual([
      `auction:${first.id}:epoch:${afterBid.deadlineEpoch}:closed`,
      `auction:${batch.lots[1]!.id}:epoch:1:opened`
    ]);

    await closeLot(batch.lots[1]!.id);
    const noBidLot = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[1]!.id } });
    expect(noBidLot.status).toBe('NO_BID');
    expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[2]!.id } })).status).toBe('ACTIVE');
    await request(app.getHttpServer()).post(`/v1/admin/leagues/${leagueId}/player-auctions/${batch.id}/lots/${noBidLot.id}/review`)
      .set(adminHeaders()).send({ decision: 'CONFIRM', expectedVersion: noBidLot.version }).expect(201);
    expect((await prisma.playerAuctionBatch.findUniqueOrThrow({ where: { id: batch.id } })).currentLotId).toBe(batch.lots[2]!.id);
    expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[2]!.id } })).status).toBe('ACTIVE');

    await groupMessage(contacts[0]!, '90');
    await closeLot(batch.lots[2]!.id);
    expect((await prisma.playerAuctionBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('COMPLETED');

    for (const lotId of [batch.lots[0]!.id, batch.lots[2]!.id]) {
      const lot = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: lotId } });
      await request(app.getHttpServer()).post(`/v1/admin/leagues/${leagueId}/player-auctions/${batch.id}/lots/${lot.id}/review`)
        .set(adminHeaders()).send({ decision: 'CONFIRM', expectedVersion: lot.version }).expect(201);
    }
    expect(await prisma.leaguePlayerOwnership.count({ where: { leagueId, footballPlayerId: { in: [playerIds[0]!, playerIds[2]!] }, status: 'ACTIVE' } })).toBe(2);
    expect(await prisma.rosterTransaction.count({ where: { leagueId, type: 'BUY', footballPlayerId: { in: [playerIds[0]!, playerIds[2]!] } } })).toBe(2);
    expect((await prisma.financeLedgerEntry.findMany({ where: { leagueId, type: 'PLAYER_PURCHASE' }, select: { amountMinor: true } })).map((entry) => entry.amountMinor).sort((a, b) => a - b)).toEqual([70, 90]);
    const ownedDraft = await request(app.getHttpServer()).post(`/v1/admin/leagues/${leagueId}/player-auctions`)
      .set(adminHeaders()).send({ name: '已归属球员不可拍卖', bidChannel: 'MINIPROGRAM' }).expect(201);
    batchIds.push(ownedDraft.body.id as string);
    await request(app.getHttpServer()).put(`/v1/admin/leagues/${leagueId}/player-auctions/${ownedDraft.body.id}/lots`)
      .set(adminHeaders()).send({ expectedVersion: ownedDraft.body.version, lots: [{
        playerId: playerIds[0], playerCardId: cardIds[0], displayOrder: 1, startingPrice: 50, minimumIncrement: 10
      }] }).expect(409).expect(({ body }) => expect(body.error.code).toBe('AUCTION_PLAYER_ALREADY_OWNED'));
    const messages = await prisma.wechatOutboxMessage.findMany({ where: { deviceId }, select: { text: true } });
    expect(messages.some((message) => message.text === '【上海申花】出价有效：⭐50⭐，倒计时重置为 30 秒。')).toBe(true);
    expect(messages.some((message) => message.text === '【成都蓉城】出价有效：⭐70⭐，倒计时重置为 30 秒。')).toBe(true);
    for (const message of messages.filter((item) => item.text.includes('出价有效'))) {
      expect(message.text.match(/⭐/g)).toHaveLength(2);
      expect(message.text).toMatch(/⭐\d+⭐/);
    }
    expect(messages.some((message) => message.text.includes('无人有效出价'))).toBe(true);
    expect(messages.every((message) => !message.text.includes('确认“下一位”'))).toBe(true);
  });

  it('runs independent miniprogram auctions with server-timed idempotent bidding while Bridge availability is irrelevant', async () => {
    const secondLeague = await prisma.league.create({ data: {
      name: `第二拍卖联赛 ${runId.slice(0, 8)}`, shortName: '第二拍卖', edition: 'NATIONAL',
      defaultPlatform: 'MOBILE', defaultServerRegion: 'CN', createdByAdminId: adminId
    } });
    leagueIds.push(secondLeague.id);
    const secondCatalog = await prisma.teamCatalogItem.create({ data: {
      sourceType: 'CUSTOM', nameZh: '第二联赛球队', shortName: '第二队'
    } });
    catalogIds.push(secondCatalog.id);
    const secondTeam = await prisma.leagueTeam.create({ data: {
      leagueId: secondLeague.id, ownerUserId: userIds[1]!, ownerAlias: '竞价球队',
      catalogTeamId: secondCatalog.id, teamNumber: 1, name: '第二联赛球队', shortName: '第二队'
    } });
    teamIds.push(secondTeam.id);
    const secondWechatId = `auction-second-${runId}@chatroom`;
    const observed = await prisma.wechatObservedGroup.create({ data: {
      deviceId, wechatGroupId: secondWechatId, displayName: '第二联赛通知群', lastObservedAt: new Date()
    } });
    const secondBinding = await prisma.wechatGroupBinding.create({ data: {
      deviceId, observedGroupId: observed.id, wechatGroupId: secondWechatId,
      displayName: observed.displayName, leagueId: secondLeague.id, enabled: true,
      capabilities: { create: { capability: 'PLAYER_AUCTION', createdByAdminId: adminId } }
    } });

    const firstBatch = await createPreparedBatch('小程序连续拍卖', 2, { bidChannel: 'MINIPROGRAM', playerOffset: 3 });
    const secondBatch = await createPreparedBatch('第二联赛小程序拍卖', 1, {
      targetLeagueId: secondLeague.id,
      targetGroupBindingId: secondBinding.id,
      bidChannel: 'MINIPROGRAM', playerOffset: 3
    });
    const startedFirst = await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueId}/player-auctions/${firstBatch.id}/start`)
      .set(adminHeaders()).send({ expectedVersion: firstBatch.version }).expect(201);
    const startedSecond = await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${secondLeague.id}/player-auctions/${secondBatch.id}/start`)
      .set(adminHeaders()).send({ expectedVersion: secondBatch.version }).expect(201);
    expect(startedFirst.body.status).toBe('ACTIVE');
    expect(startedSecond.body.status).toBe('ACTIVE');

    const conflicting = await request(app.getHttpServer()).post(`/v1/admin/leagues/${leagueId}/player-auctions`)
      .set(adminHeaders()).send({ groupBindingId, name: '同联赛冲突批次', bidChannel: 'MINIPROGRAM', expectedVersion: 1 }).expect(201);
    batchIds.push(conflicting.body.id as string);
    const conflictingConfigured = await request(app.getHttpServer())
      .put(`/v1/admin/leagues/${leagueId}/player-auctions/${conflicting.body.id}/lots`)
      .set(adminHeaders()).send({ expectedVersion: conflicting.body.version, lots: [{
        playerId: playerIds[3], playerCardId: cardIds[3], displayOrder: 1, startingPrice: 50, minimumIncrement: 10
      }] }).expect(200);
    const conflict = await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueId}/player-auctions/${conflicting.body.id}/prepare`)
      .set(adminHeaders()).send({ expectedVersion: conflictingConfigured.body.version }).expect(409);
    expect(conflict.body.error.code).toBe('AUCTION_LEAGUE_BUSY');

    const firstAuth = { Authorization: `Bearer ${userTokens[0]}` };
    const secondAuth = { Authorization: `Bearer ${userTokens[1]}` };
    const archivedAuth = { Authorization: `Bearer ${userTokens[2]}` };
    const firstRoom = await request(app.getHttpServer()).get(`/v1/me/player-auctions/${firstBatch.id}`)
      .set(firstAuth).expect(200);
    await request(app.getHttpServer()).get(`/v1/me/player-auctions/${secondBatch.id}`)
      .set(firstAuth).expect(200).expect(({ body }) => expect(body).toMatchObject({ team: null, canBid: false }));
    await request(app.getHttpServer()).get(`/v1/me/player-auctions/${firstBatch.id}`)
      .set(archivedAuth).expect(200).expect(({ body }) => expect(body).toMatchObject({ team: null, canBid: false }));
    const secondList = await request(app.getHttpServer()).get('/v1/me/player-auctions?status=active')
      .set(secondAuth).expect(200);
    expect(secondList.body.items.map((item: { batchId: string }) => item.batchId)).toEqual(expect.arrayContaining([firstBatch.id, secondBatch.id]));

    const lotId = firstRoom.body.currentLot.id as string;
    const originalEpoch = firstRoom.body.currentLot.deadlineEpoch as number;
    const bidKeys = [randomUUID(), randomUUID()];
    const bidBody = { amount: 120, lotId, deadlineEpoch: originalEpoch };
    const concurrent = await Promise.all([
      request(app.getHttpServer()).post(`/v1/me/player-auctions/${firstBatch.id}/bids`)
        .set(firstAuth).set('Idempotency-Key', bidKeys[0]!).send(bidBody),
      request(app.getHttpServer()).post(`/v1/me/player-auctions/${firstBatch.id}/bids`)
        .set(secondAuth).set('Idempotency-Key', bidKeys[1]!).send(bidBody)
    ]);
    expect(concurrent.map((response) => response.status)).toEqual([201, 201]);
    const accepted = concurrent.find((response) => response.body.result === 'VALID')!;
    const overtaken = concurrent.find((response) => response.body.result === 'BELOW_MINIMUM_INCREMENT')!;
    expect(accepted.body).toMatchObject({ result: 'VALID', amount: 120 });
    expect(overtaken.body).toMatchObject({ result: 'BELOW_MINIMUM_INCREMENT', amount: 120, requiredMinimum: 130 });
    expect(new Date(accepted.body.deadlineAt as string).getTime()).toBeGreaterThan(Date.now() + 25_000);
    expect(await prisma.playerAuctionBid.count({ where: { lotId, amount: 120, result: 'VALID' } })).toBe(1);
    const publicRoom = await request(app.getHttpServer()).get(`/v1/me/player-auctions/${firstBatch.id}`)
      .set(firstAuth).expect(200);
    expect(publicRoom.body.currentLot.bids).toHaveLength(1);
    expect(publicRoom.body.currentLot.bids[0]).toMatchObject({
      amount: 120,
      teamNumber: expect.any(Number),
      teamName: expect.any(String),
      bidderDisplayName: expect.any(String)
    });
    const acceptedIndex = concurrent.indexOf(accepted);
    const acceptedAuth = acceptedIndex === 0 ? firstAuth : secondAuth;
    const replay = await request(app.getHttpServer()).post(`/v1/me/player-auctions/${firstBatch.id}/bids`)
      .set(acceptedAuth).set('Idempotency-Key', bidKeys[acceptedIndex]!).send(bidBody).expect(201);
    expect(replay.body.id).toBe(accepted.body.id);
    expect(await prisma.playerAuctionBid.count({ where: { lotId, idempotencyKey: bidKeys[acceptedIndex]! } })).toBe(1);
    await request(app.getHttpServer()).post(`/v1/me/player-auctions/${firstBatch.id}/bids`)
      .set(firstAuth).set('Idempotency-Key', randomUUID()).send(bidBody).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('AUCTION_EPOCH_CHANGED'));

    await recovery.onBridgeUnavailable(deviceId, 'HEARTBEAT_TIMEOUT');
    expect((await prisma.playerAuctionBatch.findUniqueOrThrow({ where: { id: firstBatch.id } })).status).toBe('ACTIVE');
    expect((await prisma.playerAuctionBatch.findUniqueOrThrow({ where: { id: secondBatch.id } })).status).toBe('ACTIVE');
    recovery.bridgeAvailable(deviceId);

    await prisma.playerAuctionLot.update({
      where: { id: firstBatch.lots[0]!.id },
      data: { deadlineAt: new Date(Date.now() - 1_000) }
    });
    const settledRoom = await request(app.getHttpServer()).get(`/v1/me/player-auctions/${firstBatch.id}`)
      .set(firstAuth).expect(200);
    expect(settledRoom.body.currentLot.id).toBe(firstBatch.lots[1]!.id);
    expect(settledRoom.body.queue.find((lot: { id: string }) => lot.id === firstBatch.lots[0]!.id)).toMatchObject({
      status: 'PENDING_REVIEW',
      winner: {
        teamNumber: expect.any(Number),
        teamName: expect.any(String),
        bidderDisplayName: expect.any(String),
        price: 120
      }
    });
    await request(app.getHttpServer()).post(`/v1/me/player-auctions/${firstBatch.id}/bids`)
      .set(firstAuth).set('Idempotency-Key', randomUUID()).send(bidBody).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('AUCTION_EPOCH_CHANGED'));
    await prisma.playerAuctionLot.update({
      where: { id: firstBatch.lots[1]!.id },
      data: { deadlineAt: new Date(Date.now() - 1_000) }
    });
    await request(app.getHttpServer()).get(`/v1/admin/leagues/${leagueId}/player-auctions/${firstBatch.id}`)
      .set(adminHeaders()).expect(200).expect(({ body }) => expect(body.status).toBe('COMPLETED'));
    expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: firstBatch.lots[1]!.id } })).status).toBe('NO_BID');
    expect((await prisma.playerAuctionBatch.findUniqueOrThrow({ where: { id: firstBatch.id } })).status).toBe('COMPLETED');
    await closeLot(secondBatch.lots[0]!.id);

    const soldLot = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: firstBatch.lots[0]!.id } });
    await request(app.getHttpServer())
      .post(`/v1/admin/leagues/${leagueId}/player-auctions/${firstBatch.id}/lots/${soldLot.id}/review`)
      .set(adminHeaders()).send({ decision: 'CONFIRM', expectedVersion: soldLot.version }).expect(201);
    expect(await prisma.playerAuctionReview.count({ where: { lotId: soldLot.id } })).toBe(1);
    expect(await prisma.leaguePlayerOwnership.findUnique({ where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: playerIds[3]! } } })).toMatchObject({ status: 'ACTIVE', currentPlayerCardId: cardIds[3] });
  });

  it('fails closed on heartbeat loss, deduplicates messages, resumes for 30 seconds, and leaves finance and roster untouched', async () => {
    const baseline = {
      finance: await prisma.financeLedgerEntry.count({ where: { leagueId } }),
      roster: await prisma.rosterTransaction.count({ where: { leagueId } }),
      ownership: await prisma.leaguePlayerOwnership.count({ where: { leagueId } })
    };
    const batch = await createPreparedBatch('恢复保护拍卖', 1, { playerOffset: 5 });
    await groupMessage(contacts[0]!, '开始拍卖');
    await groupMessage(contacts[1]!, '50');
    await recovery.onBridgeUnavailable(deviceId, 'HEARTBEAT_TIMEOUT');
    expect((await prisma.playerAuctionBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('RECOVERY_REQUIRED');

    const messageId = `recovery-bid-${runId}`;
    const firstUpload = await groupMessage(contacts[0]!, '70', messageId);
    const duplicateUpload = await groupMessage(contacts[0]!, '70', messageId);
    expect(firstUpload.result.status).toBe('ACCEPTED');
    expect(duplicateUpload.result.status).toBe('DUPLICATE');
    expect((await prisma.playerAuctionBid.findUniqueOrThrow({ where: { inboundMessageId: firstUpload.result.inboundId! } })).result).toBe('RECOVERY_REQUIRED');

    await bridgePost('/v1/wechat-bot/bridge/heartbeat', {
      wechatVersion: 'test', loginStatus: 'LOGGED_IN', listenerWatermark: `recovered-${runId}`,
      screenLocked: false, outboundQueueDepth: 0,
      observedGroups: [{ wechatGroupId: groupWechatId, displayName: 'CELL 拍卖验收群' }]
    }).expect(200);
    await groupMessage(contacts[0]!, '继续拍卖');
    const recoveredLot = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[0]!.id } });
    expect(recoveredLot.deadlineAt!.getTime()).toBeGreaterThan(Date.now() + 29_000);
    await closeLot(batch.lots[0]!.id);
    const lot = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[0]!.id } });
    await request(app.getHttpServer()).post(`/v1/admin/leagues/${leagueId}/player-auctions/${batch.id}/lots/${lot.id}/review`)
      .set(adminHeaders()).send({ decision: 'VOID', expectedVersion: lot.version, reason: '恢复场景仅验证记录，不成交' }).expect(201);

    expect(await prisma.financeLedgerEntry.count({ where: { leagueId } })).toBe(baseline.finance);
    expect(await prisma.rosterTransaction.count({ where: { leagueId } })).toBe(baseline.roster);
    expect(await prisma.leaguePlayerOwnership.count({ where: { leagueId } })).toBe(baseline.ownership);
  });

  it('keeps the sale pending with no charge when the winning team exceeds its salary cap', async () => {
    const batch = await createPreparedBatch('工资帽保护拍卖', 1, { bidChannel: 'MINIPROGRAM', playerOffset: 6 });
    await request(app.getHttpServer()).post(`/v1/admin/leagues/${leagueId}/player-auctions/${batch.id}/start`)
      .set(adminHeaders()).send({ expectedVersion: batch.version }).expect(201);
    const room = await request(app.getHttpServer()).get(`/v1/me/player-auctions/${batch.id}`)
      .set({ Authorization: `Bearer ${userTokens[0]}` }).expect(200);
    await request(app.getHttpServer()).post(`/v1/me/player-auctions/${batch.id}/bids`)
      .set({ Authorization: `Bearer ${userTokens[0]}`, 'Idempotency-Key': randomUUID() })
      .send({ lotId: room.body.currentLot.id, deadlineEpoch: room.body.currentLot.deadlineEpoch, amount: 100 }).expect(201);
    await closeLot(batch.lots[0]!.id);
    await prisma.leagueTeam.update({ where: { id: teamIds[0]! }, data: { salaryCapMinor: 1 } });
    const lot = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[0]!.id } });
    const reviewPath = `/v1/admin/leagues/${leagueId}/player-auctions/${batch.id}/lots/${lot.id}/review`;
    await request(app.getHttpServer()).post(reviewPath).set(adminHeaders())
      .send({ decision: 'CONFIRM', expectedVersion: lot.version }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('TEAM_SALARY_CAP_EXCEEDED'));
    expect(await prisma.playerAuctionReview.count({ where: { lotId: lot.id } })).toBe(0);
    expect(await prisma.leaguePlayerOwnership.count({ where: { leagueId, footballPlayerId: playerIds[6]! } })).toBe(0);
    expect(await prisma.financeLedgerEntry.count({ where: { leagueId, amountMinor: 100, leagueTeamId: teamIds[0]! } })).toBe(0);
    await prisma.leagueTeam.update({ where: { id: teamIds[0]! }, data: { salaryCapMinor: 10_000 } });
    const confirmationHeaders = adminHeaders();
    await request(app.getHttpServer()).post(reviewPath).set(confirmationHeaders)
      .send({ decision: 'CONFIRM', expectedVersion: lot.version }).expect(201);
    await request(app.getHttpServer()).post(reviewPath).set(confirmationHeaders)
      .send({ decision: 'CONFIRM', expectedVersion: lot.version }).expect(201);
    expect(await prisma.leaguePlayerOwnership.findUnique({ where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: playerIds[6]! } } })).toMatchObject({ leagueTeamId: teamIds[0], status: 'ACTIVE' });
    expect(await prisma.financeLedgerEntry.count({ where: { leagueId, amountMinor: 100, leagueTeamId: teamIds[0]! } })).toBe(1);
  });
});

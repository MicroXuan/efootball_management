import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PasswordService } from '../src/admin-auth/password.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
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
  let roleBindingId = '';
  const userIds: string[] = [];
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
    const result = await bridgePost('/v1/wechat-bot/bridge/messages', { messages: [{
      messageId, conversationType: 'GROUP', conversationId: groupWechatId, senderId,
      sentAt: new Date().toISOString(), sequence: `${Date.now()}-${messageId}`, messageType: 'TEXT', text
    }] }).expect(200);
    return { messageId, result: result.body.results[0] as { status: string; inboundId: string | null } };
  };
  const createPreparedBatch = async (name: string, lotCount: number) => {
    const created = await request(app.getHttpServer()).post(`/v1/admin/leagues/${leagueId}/player-auctions`)
      .set(adminHeaders()).send({ groupBindingId, name, expectedVersion: 1 }).expect(201);
    const batchId = created.body.id as string; batchIds.push(batchId);
    const configured = await request(app.getHttpServer()).put(`/v1/admin/leagues/${leagueId}/player-auctions/${batchId}/lots`)
      .set(adminHeaders()).send({ expectedVersion: created.body.version, lots: playerIds.slice(0, lotCount).map((playerId, index) => ({
        playerId, playerCardId: cardIds[index], displayOrder: index + 1,
        startingPrice: 50 + index * 20, minimumIncrement: 10 + index * 10
      })) }).expect(200);
    const prepared = await request(app.getHttpServer()).post(`/v1/admin/leagues/${leagueId}/player-auctions/${batchId}/prepare`)
      .set(adminHeaders()).send({ expectedVersion: configured.body.version }).expect(201);
    return prepared.body as { id: string; version: number; lots: Array<{ id: string; version: number }> };
  };
  const closeLot = async (lotId: string) => {
    const lot = await prisma.playerAuctionLot.update({ where: { id: lotId }, data: { deadlineAt: new Date(Date.now() - 1_000) } });
    expect(await worker.closeDueLot(lot.id, lot.deadlineEpoch)).toBe(true);
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

    const users = await Promise.all(['拍卖管理员', '竞价球队'].map((displayName, index) => prisma.user.create({ data: {
      wechatOpenId: `auction-openid-${index}-${runId}`, displayName
    } })));
    userIds.push(...users.map((user) => user.id));
    const league = await prisma.league.create({ data: {
      name: `拍卖验收联赛 ${runId.slice(0, 8)}`, shortName: '拍卖验收', edition: 'NATIONAL',
      defaultPlatform: 'MOBILE', defaultServerRegion: 'CN', createdByAdminId: adminId
    } });
    leagueId = league.id;
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
    const teamNames = [{ name: '上海申花', shortName: '申花' }, { name: '成都蓉城', shortName: '蓉城' }] as const;
    for (let index = 0; index < users.length; index += 1) {
      const teamName = teamNames[index]!;
      const catalog = await prisma.teamCatalogItem.create({ data: {
        sourceType: 'CUSTOM', nameZh: teamName.name, shortName: teamName.shortName
      } });
      catalogIds.push(catalog.id);
      const team = await prisma.leagueTeam.create({ data: {
        leagueId, ownerUserId: users[index]!.id, ownerAlias: users[index]!.displayName,
        catalogTeamId: catalog.id, teamNumber: index + 1, name: teamName.name, shortName: teamName.shortName
      } });
      teamIds.push(team.id);
    }
    const source = await prisma.dataSource.create({ data: { code: `auction-${runId}`, name: '拍卖验收数据源', type: 'MANUAL' } });
    sourceId = source.id;
    const playerNames = ['车范根', '詹卢卡·赞布罗塔', '马赛洛'] as const;
    for (let index = 0; index < 3; index += 1) {
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
    }

    const device = await request(app.getHttpServer()).post('/v1/admin/wechat-bot/devices')
      .set({ Authorization: `Bearer ${adminToken}` }).send({ name: 'Windows 拍卖验收机器人' }).expect(201);
    deviceId = device.body.device.id as string; deviceToken = device.body.token as string;
    await bridgePost('/v1/wechat-bot/bridge/heartbeat', {
      wechatAccountId: `auction-bot-${runId}`, wechatVersion: '4.1.15.13', loginStatus: 'LOGGED_IN',
      listenerWatermark: 'auction-setup', screenLocked: false, outboundQueueDepth: 0,
      observedGroups: [{ wechatGroupId: groupWechatId, displayName: 'CELL 拍卖验收群' }]
    }).expect(200);
    const observed = await prisma.wechatObservedGroup.findUniqueOrThrow({ where: { deviceId_wechatGroupId: { deviceId, wechatGroupId: groupWechatId } } });
    const binding = await request(app.getHttpServer()).put(`/v1/admin/leagues/${leagueId}/wechat-bot/group`)
      .set({ Authorization: `Bearer ${adminToken}` }).send({ deviceId, observedGroupId: observed.id, enabled: true, scheduleSourceIds: [] }).expect(200);
    groupBindingId = binding.body.id as string;
    await Promise.all(users.map((user, index) => prisma.wechatIdentityBinding.create({ data: {
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
      await prisma.wechatGroupBinding.deleteMany({ where: { deviceId } });
      await prisma.wechatObservedGroup.deleteMany({ where: { deviceId } });
      await prisma.wechatBotDevice.deleteMany({ where: { id: deviceId } });
    }
    if (adminId) await prisma.adminMutationReceipt.deleteMany({ where: { adminId } });
    await prisma.auditLog.deleteMany({ where: { actorAdminId: adminId } });
    if (cardIds.length) await prisma.playerCard.deleteMany({ where: { id: { in: cardIds } } });
    if (playerIds.length) await prisma.footballPlayer.deleteMany({ where: { id: { in: playerIds } } });
    if (sourceId) await prisma.dataSource.deleteMany({ where: { id: sourceId } });
    if (roleBindingId) await prisma.userRoleBinding.deleteMany({ where: { id: roleBindingId } });
    if (teamIds.length) await prisma.leagueTeam.deleteMany({ where: { id: { in: teamIds } } });
    if (catalogIds.length) await prisma.teamCatalogItem.deleteMany({ where: { id: { in: catalogIds } } });
    if (leagueId) await prisma.league.deleteMany({ where: { id: leagueId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminSession.deleteMany({ where: { adminId } });
    await prisma.adminAccount.deleteMany({ where: { id: adminId } });
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it('runs three lots with numeric bids, server deadlines, manual next, no-bid, and review', async () => {
    const batch = await createPreparedBatch('端到端三人拍卖', 3);
    await groupMessage(contacts[0]!, '开始拍卖');
    const first = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[0]!.id } });
    const startReply = await prisma.wechatOutboxMessage.findFirst({ where: { deviceId }, orderBy: { createdAt: 'desc' } });
    expect(first.status).toBe('ACTIVE');
    expect(startReply?.text).toContain('接下来即将拍卖的球员：');
    expect(startReply?.text).toContain('提名拍卖：第1名球员拍卖开始！');

    await groupMessage(contacts[0]!, '40');
    expect((await prisma.playerAuctionBid.findFirstOrThrow({ where: { lotId: first.id, amount: 40 } })).result).toBe('BELOW_STARTING_PRICE');
    await groupMessage(contacts[0]!, '50');
    await groupMessage(contacts[1]!, '70');
    const afterBid = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: first.id } });
    expect(afterBid.currentPrice).toBe(70);
    expect(afterBid.deadlineAt!.getTime()).toBeGreaterThan(Date.now() + 25_000);

    await prisma.playerAuctionLot.update({ where: { id: first.id }, data: { deadlineAt: new Date(Date.now() + 19_000) } });
    await worker.tick();
    expect(await prisma.wechatOutboxMessage.count({ where: { deviceId, text: '20' } })).toBeGreaterThan(0);
    await closeLot(first.id);
    expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('PENDING_REVIEW');
    expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[1]!.id } })).status).toBe('QUEUED');

    await groupMessage(contacts[0]!, '下一位');
    expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[1]!.id } })).status).toBe('ACTIVE');
    await closeLot(batch.lots[1]!.id);
    expect((await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[1]!.id } })).status).toBe('NO_BID');
    await groupMessage(contacts[0]!, '下一位');
    await groupMessage(contacts[0]!, '90');
    await closeLot(batch.lots[2]!.id);
    expect((await prisma.playerAuctionBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('COMPLETED');

    for (const lotId of [batch.lots[0]!.id, batch.lots[2]!.id]) {
      const lot = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: lotId } });
      await request(app.getHttpServer()).post(`/v1/admin/leagues/${leagueId}/player-auctions/${batch.id}/lots/${lot.id}/review`)
        .set(adminHeaders()).send({ decision: 'CONFIRM', expectedVersion: lot.version }).expect(201);
    }
    const messages = await prisma.wechatOutboxMessage.findMany({ where: { deviceId }, select: { text: true } });
    expect(messages.some((message) => message.text === '【上海申花】出价有效：⭐50⭐，倒计时重置为 30 秒。')).toBe(true);
    expect(messages.some((message) => message.text === '【成都蓉城】出价有效：⭐70⭐，倒计时重置为 30 秒。')).toBe(true);
    for (const message of messages.filter((item) => item.text.includes('出价有效'))) {
      expect(message.text.match(/⭐/g)).toHaveLength(2);
      expect(message.text).toMatch(/⭐\d+⭐/);
    }
  });

  it('fails closed on heartbeat loss, deduplicates messages, resumes for 30 seconds, and leaves finance and roster untouched', async () => {
    const baseline = {
      finance: await prisma.financeLedgerEntry.count({ where: { leagueId } }),
      roster: await prisma.rosterTransaction.count({ where: { leagueId } }),
      ownership: await prisma.leaguePlayerOwnership.count({ where: { leagueId } })
    };
    const batch = await createPreparedBatch('恢复保护拍卖', 1);
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

    await groupMessage(contacts[0]!, '继续拍卖');
    const recoveredLot = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[0]!.id } });
    expect(recoveredLot.deadlineAt!.getTime()).toBeGreaterThan(Date.now() + 29_000);
    await closeLot(batch.lots[0]!.id);
    const lot = await prisma.playerAuctionLot.findUniqueOrThrow({ where: { id: batch.lots[0]!.id } });
    await request(app.getHttpServer()).post(`/v1/admin/leagues/${leagueId}/player-auctions/${batch.id}/lots/${lot.id}/review`)
      .set(adminHeaders()).send({ decision: 'CONFIRM', expectedVersion: lot.version }).expect(201);

    expect(await prisma.financeLedgerEntry.count({ where: { leagueId } })).toBe(baseline.finance);
    expect(await prisma.rosterTransaction.count({ where: { leagueId } })).toBe(baseline.roster);
    expect(await prisma.leaguePlayerOwnership.count({ where: { leagueId } })).toBe(baseline.ownership);
  });
});

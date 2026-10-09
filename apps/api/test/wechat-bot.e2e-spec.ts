import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import request from 'supertest';
import { PasswordService } from '../src/admin-auth/password.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp } from './test-app.js';

config({ path: '../../.env', quiet: true });

describe('WeChat bot foundation acceptance', () => {
  const prisma = new PrismaService();
  const runId = randomUUID();
  const groupWechatId = `group-${runId}@chatroom`;
  const contactWechatId = `contact-${runId}`;
  const adminUsername = `wechat-bot-${runId}`;
  const mainOpenId = `test-openid-wechat-bot-main-${runId}`;
  const opponentOpenId = `test-openid-wechat-bot-opponent-${runId}`;
  let app: INestApplication;
  let adminId = '';
  let adminToken = '';
  let userId = '';
  let opponentUserId = '';
  let userToken = '';
  let leagueId = '';
  let seasonId = '';
  let competitionId = '';
  let stageId = '';
  let teamCatalogId = '';
  let leagueTeamId = '';
  let deviceId = '';
  let deviceToken = '';

  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  function bridgeHeaders(path: string) {
    const timestamp = new Date().toISOString();
    const nonce = randomUUID();
    const signature = createHmac('sha256', deviceToken)
      .update(`POST\n${path}\n${timestamp}\n${nonce}`)
      .digest('hex');
    return {
      Authorization: `Bridge ${deviceToken}`,
      'X-Bridge-Device': deviceId,
      'X-Bridge-Timestamp': timestamp,
      'X-Bridge-Nonce': nonce,
      'X-Bridge-Signature': signature,
    };
  }

  function bridgePost(path: string, body: object) {
    return request(app.getHttpServer()).post(path).set(bridgeHeaders(path)).send(body);
  }

  beforeAll(async () => {
    await prisma.$connect();
    app = await createTestApp();
    const passwordService = app.get(PasswordService);
    const admin = await prisma.adminAccount.create({
      data: {
        username: adminUsername,
        displayName: '机器人验收管理员',
        passwordHash: await passwordService.hash('wechat-bot-password-123'),
        platformRole: 'PLATFORM_ADMIN',
      },
    });
    adminId = admin.id;
    const loggedIn = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ username: adminUsername, password: 'wechat-bot-password-123' })
      .expect(200);
    adminToken = loggedIn.body.accessToken as string;

    const mainLogin = await request(app.getHttpServer())
      .post('/v1/auth/wechat')
      .send({ code: `test-code-wechat-bot-main-${runId}` })
      .expect(200);
    userToken = mainLogin.body.accessToken as string;
    userId = (await prisma.user.findUniqueOrThrow({ where: { wechatOpenId: mainOpenId } })).id;

    await request(app.getHttpServer())
      .post('/v1/auth/wechat')
      .send({ code: `test-code-wechat-bot-opponent-${runId}` })
      .expect(200);
    opponentUserId = (await prisma.user.findUniqueOrThrow({ where: { wechatOpenId: opponentOpenId } })).id;

    const league = await prisma.league.create({
      data: {
        name: `微信机器人验收联赛 ${runId.slice(0, 8)}`,
        shortName: '机器人验收',
        edition: 'NATIONAL',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN',
        createdByAdminId: adminId,
      },
    });
    leagueId = league.id;
    const now = Date.now();
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId,
        seasonNumber: 1,
        displayName: '机器人验收赛季',
        isFirstSeason: true,
        registrationOpensAt: new Date(now - 7 * 86_400_000),
        registrationClosesAt: new Date(now - 86_400_000),
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 30 * 86_400_000),
        superCapacity: 2,
        championCapacity: 2,
        promotionCount: 1,
        status: 'IN_PROGRESS',
        createdByAdminId: adminId,
      },
    });
    seasonId = season.id;

    const competition = await prisma.competition.create({
      data: {
        seasonId,
        competitionType: 'DIVISION_LEAGUE',
        name: '甲级联赛',
        description: '微信机器人端到端验收赛程',
        platform: 'MOBILE',
        serverRegion: 'CN',
        participantType: 'INDIVIDUAL',
        format: 'ROUND_ROBIN',
        status: 'IN_PROGRESS',
        registrationOpensAt: new Date(now - 7 * 86_400_000),
        registrationClosesAt: new Date(now - 86_400_000),
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 30 * 86_400_000),
        participantLimit: 2,
        createdByAdminId: adminId,
      },
    });
    competitionId = competition.id;
    const [home, away] = await Promise.all([
      prisma.competitionParticipant.create({
        data: {
          competitionId,
          individualUserId: userId,
          admissionSequence: 1,
          displayNameSnapshot: '上海申花',
        },
      }),
      prisma.competitionParticipant.create({
        data: {
          competitionId,
          individualUserId: opponentUserId,
          admissionSequence: 2,
          displayNameSnapshot: '成都蓉城',
        },
      }),
    ]);
    const stage = await prisma.competitionStage.create({
      data: {
        competitionId,
        stageCode: 'LEAGUE',
        displayName: '常规赛',
        sequence: 1,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    stageId = stage.id;
    await prisma.competitionMatch.create({
      data: {
        stageId,
        roundNumber: 1,
        pairingKey: `${home.id}:${away.id}`,
        matchNumber: 1,
        homeParticipantId: home.id,
        awayParticipantId: away.id,
        plannedAt: new Date(now + 86_400_000),
      },
    });
    const catalog = await prisma.teamCatalogItem.create({
      data: { sourceType: 'CUSTOM', nameZh: '上海申花', shortName: '申花' },
    });
    teamCatalogId = catalog.id;
    leagueTeamId = (await prisma.leagueTeam.create({
      data: {
        leagueId,
        ownerUserId: userId,
        ownerAlias: '验收用户',
        catalogTeamId: teamCatalogId,
        teamNumber: 1,
        name: '上海申花',
        shortName: '申花',
      },
    })).id;
  });

  afterAll(async () => {
    if (deviceId) {
      await prisma.wechatBindingCode.deleteMany({ where: { OR: [{ consumedByDeviceId: deviceId }, { userId }] } });
      await prisma.wechatIdentityBinding.deleteMany({ where: { deviceId } });
      await prisma.wechatOutboxMessage.deleteMany({ where: { deviceId } });
      await prisma.wechatInboundMessage.deleteMany({ where: { deviceId } });
      await prisma.wechatBridgeRequestReceipt.deleteMany({ where: { deviceId } });
      await prisma.wechatGroupScheduleSource.deleteMany({ where: { groupBinding: { deviceId } } });
      await prisma.wechatGroupBinding.deleteMany({ where: { deviceId } });
      await prisma.wechatObservedGroup.deleteMany({ where: { deviceId } });
      await prisma.wechatBotDevice.deleteMany({ where: { id: deviceId } });
    }
    if (stageId) {
      await prisma.competitionMatch.deleteMany({ where: { stageId } });
      await prisma.competitionStage.deleteMany({ where: { id: stageId } });
    }
    if (competitionId) {
      await prisma.competitionParticipant.deleteMany({ where: { competitionId } });
      await prisma.competition.deleteMany({ where: { id: competitionId } });
    }
    if (leagueTeamId) await prisma.leagueTeam.deleteMany({ where: { id: leagueTeamId } });
    if (teamCatalogId) await prisma.teamCatalogItem.deleteMany({ where: { id: teamCatalogId } });
    if (seasonId) await prisma.leagueSeason.deleteMany({ where: { id: seasonId } });
    await prisma.auditLog.deleteMany({ where: { actorAdminId: adminId } });
    if (leagueId) await prisma.league.deleteMany({ where: { id: leagueId } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: [userId, opponentUserId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, opponentUserId].filter(Boolean) } } });
    await prisma.adminSession.deleteMany({ where: { adminId } });
    await prisma.adminAccount.deleteMany({ where: { id: adminId } });
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it('binds identity, answers schedule commands, and deduplicates retried inbound batches', async () => {
    const createdDevice = await request(app.getHttpServer())
      .post('/v1/admin/wechat-bot/devices')
      .set(adminAuth())
      .send({ name: 'Windows 验收机器人' })
      .expect(201);
    deviceId = createdDevice.body.device.id as string;
    deviceToken = createdDevice.body.token as string;

    await bridgePost('/v1/wechat-bot/bridge/heartbeat', {
      wechatAccountId: `bot-${runId}`,
      wechatVersion: '4.1.15.13',
      loginStatus: 'LOGGED_IN',
      listenerWatermark: 'acceptance-1',
      screenLocked: false,
      outboundQueueDepth: 0,
      observedGroups: [{ wechatGroupId: groupWechatId, displayName: 'CELL 联赛群' }],
    }).expect(200);

    const group = await prisma.wechatObservedGroup.findUniqueOrThrow({
      where: { deviceId_wechatGroupId: { deviceId, wechatGroupId: groupWechatId } },
    });
    await request(app.getHttpServer())
      .put(`/v1/admin/leagues/${leagueId}/wechat-bot/group`)
      .set(adminAuth())
      .send({
        deviceId,
        observedGroupId: group.id,
        enabled: true,
        scheduleSourceIds: [competitionId],
      })
      .expect(200);

    const issued = await request(app.getHttpServer())
      .post('/v1/me/wechat-bot/binding-code')
      .set({ Authorization: `Bearer ${userToken}` })
      .expect(201);
    expect(issued.body.code).toMatch(/^\d{6}$/);

    const sentAt = new Date().toISOString();
    const batch = {
      messages: [
        {
          messageId: `private-bind-${runId}`,
          conversationType: 'PRIVATE',
          conversationId: contactWechatId,
          senderId: contactWechatId,
          sentAt,
          messageType: 'TEXT',
          text: `绑定 ${issued.body.code as string}`,
        },
        {
          messageId: `group-schedule-${runId}`,
          conversationType: 'GROUP',
          conversationId: groupWechatId,
          senderId: contactWechatId,
          sentAt,
          messageType: 'TEXT',
          text: '查询赛程',
        },
        {
          messageId: `group-my-schedule-${runId}`,
          conversationType: 'GROUP',
          conversationId: groupWechatId,
          senderId: contactWechatId,
          sentAt,
          messageType: 'TEXT',
          text: '我的赛程',
        },
      ],
    } as const;

    await bridgePost('/v1/wechat-bot/bridge/messages', batch)
      .expect(200)
      .expect(({ body }) => expect(body.results.map((item: { status: string }) => item.status))
        .toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']));

    await bridgePost('/v1/wechat-bot/bridge/messages', batch)
      .expect(200)
      .expect(({ body }) => expect(body.results.map((item: { status: string }) => item.status))
        .toEqual(['DUPLICATE', 'DUPLICATE', 'DUPLICATE']));

    expect(await prisma.wechatInboundMessage.count({ where: { deviceId } })).toBe(3);
    const persistedReplies = await prisma.wechatOutboxMessage.findMany({
      where: { deviceId },
      orderBy: { createdAt: 'asc' },
    });
    expect(persistedReplies).toHaveLength(3);
    expect(new Set(persistedReplies.map((message) => message.businessKey)).size).toBe(3);
    expect(persistedReplies.map((message) => message.text).join('\n')).toContain('绑定成功');
    expect(persistedReplies.map((message) => message.text).join('\n')).toContain('赛程（1场）');
    expect(persistedReplies.map((message) => message.text).join('\n')).toContain('我的赛程（1场）');
    expect(persistedReplies.map((message) => message.text).join('\n')).toContain('上海申花 vs 成都蓉城');

    const claim = await bridgePost('/v1/wechat-bot/bridge/outbox/claim', { limit: 20 }).expect(200);
    expect(claim.body.messages).toHaveLength(3);
    for (const [index, message] of (claim.body.messages as Array<{ id: string }>).entries()) {
      await bridgePost(`/v1/wechat-bot/bridge/outbox/${message.id}/ack`, {
        status: 'SENT',
        readbackMessageId: `wechat-readback-${runId}-${index + 1}`,
      }).expect(200);
    }
    expect(await prisma.wechatOutboxMessage.count({ where: { deviceId, status: 'SENT' } })).toBe(3);

    await request(app.getHttpServer())
      .get('/v1/me/wechat-bot/binding')
      .set({ Authorization: `Bearer ${userToken}` })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'BOUND', deviceName: 'Windows 验收机器人' }));
  });
});

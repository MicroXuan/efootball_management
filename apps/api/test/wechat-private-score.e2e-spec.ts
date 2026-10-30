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

describe('private administrator score integration', () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/test|verify/.test(url.pathname)) throw new Error('isolated database required');
  const db = new PrismaService();
  const adminId = randomUUID(), managerId = randomUUID(), deviceId = randomUUID(), userId = randomUUID(), leagueId = randomUUID();
  const seasonId = randomUUID(), competitionId = randomUUID(), stageId = randomUUID(), matchId = randomUUID();
  let contactId: string, reference: number;
  const config = { privateScoreEnabled: true } as WechatBotRuntimeConfig;
  const results = new ResultsService(db, new MutationReceiptService(db), new StandingsService(db), new CupProgressionService());
  const scores = new WechatPrivateScoreService(db, results, config);
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
    await db.adminAccount.createMany({ data: [
      { id: adminId, username: `score-platform-${adminId}`, displayName: '录分平台测试', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN' },
      { id: managerId, username: `score-manager-${managerId}`, displayName: '录分联赛测试', passwordHash: 'unused' }
    ] });
    await db.user.create({ data: { id: userId, wechatOpenId: `score-${userId}`, displayName: '录分测试用户' } });
    await db.league.create({ data: { id: leagueId, name: `录分测试${leagueId}`, shortName: '录分测试', defaultPlatform: 'MOBILE', defaultServerRegion: 'verify', createdByAdminId: adminId } });
    await db.adminLeagueRole.create({ data: { adminId: managerId, leagueId, grantedById: adminId } });
    await db.leagueSeason.create({ data: { id: seasonId, leagueId, seasonNumber: 1, displayName: '验证赛季', registrationOpensAt: new Date(), registrationClosesAt: new Date(), startsAt: new Date(), endsAt: new Date(), superCapacity: 2, championCapacity: 2, promotionCount: 1, createdByAdminId: adminId } });
    await db.league.update({ where: { id: leagueId }, data: { currentSeasonId: seasonId } });
    await db.competition.create({ data: { id: competitionId, name: '录分验证赛事', description: '', platform: 'MOBILE', serverRegion: 'GLOBAL', participantType: 'INDIVIDUAL', format: 'ROUND_ROBIN', competitionType: 'DIVISION_LEAGUE', status: 'IN_PROGRESS', seasonId,
      registrationOpensAt: new Date(), registrationClosesAt: new Date(), startsAt: new Date(), endsAt: new Date(), participantLimit: 2, createdById: userId } });
    const home = await db.competitionParticipant.create({ data: { competitionId, individualUserId: userId, admissionSequence: 1, displayNameSnapshot: '主队' } });
    const away = await db.competitionParticipant.create({ data: { competitionId, admissionSequence: 2, displayNameSnapshot: '客队' } });
    await db.competitionStage.create({ data: { id: stageId, competitionId, sequence: 1, status: 'PUBLISHED' } });
    await db.stageParticipant.createMany({ data: [home, away].map((p, i) => ({ stageId, participantId: p.id, seed: i + 1 })) });
    await db.competitionMatch.create({ data: { id: matchId, stageId, roundNumber: 1, matchNumber: 1, pairingKey: randomUUID(), homeParticipantId: home.id, awayParticipantId: away.id, status: 'AWAITING_RESULT' } });
    await db.wechatBotDevice.create({ data: { id: deviceId, name: '录分验证设备', tokenHash: 'unused', createdByAdminId: adminId } });
    expect(await command('帮助')).toContain('关联管理员账号');
    contactId = (await db.wechatAdminContact.findUniqueOrThrow({ where: { deviceId_wechatContactId: { deviceId, wechatContactId: 'wxid_score_admin' } } })).id;
    await identities.bind(adminId, deviceId, contactId, { adminId: managerId, expectedVersion: 1, reason: '', idempotencyKey: randomUUID() });
    const schedule = await command('赛程');
    expect(schedule).toContain('主：主队 / 客：客队');
    reference = Number(/M(\d+)/.exec(schedule)![1]);
  });
  afterAll(async () => {
    await db.$transaction(async (tx) => {
      await tx.wechatScoreOperation.deleteMany({ where: { contact: { deviceId } } });
      await tx.wechatMatchReference.deleteMany({ where: { matchId } });
      await tx.wechatAdminContact.deleteMany({ where: { deviceId } });
      await tx.wechatInboundMessage.deleteMany({ where: { deviceId } });
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
      await tx.user.deleteMany({ where: { id: userId } });
    });
    expect(await db.wechatAdminContact.count({ where: { deviceId } })).toBe(0);
    expect(await db.competitionMatch.count({ where: { id: matchId } })).toBe(0);
    await db.$disconnect();
  });
  it('shows settings and supports a reason-free first score preview without writing', async () => {
    expect(await command('当前设置')).toContain('验证赛季');
    expect(await command('查询赛程')).toContain(`M${reference}`);
    expect(await command('录分帮助')).toContain('首次录分');
    const answer = await command(`报分 M${reference} 2:1`);
    expect(answer).toContain('管理员录入赛果');
    expect(answer).toContain('北京时间');
    expect(await db.matchResultVersion.count({ where: { matchId } })).toBe(0);
    const code = /确认 ([0-9A-F]{12})/.exec(answer)![1];
    expect(await command(`取消 ${code}`)).toContain('已取消');
  });
  it('previews without writing then concurrently confirms once using real official result and standings', async () => {
    const code = await preview();
    expect(await db.matchResultVersion.count({ where: { matchId } })).toBe(0);
    const answers = await Promise.all([command(`确认 ${code}`), command(`确认 ${code}`)]);
    expect(answers[0]).toContain('录分成功'); expect(answers[1]).toBe(answers[0]);
    expect(await db.matchResultVersion.count({ where: { matchId } })).toBe(1);
    expect(await db.standingsSnapshot.count({ where: { competitionId } })).toBe(1);
    expect(await db.auditLog.count({ where: { actorAdminId: managerId, action: 'admin.competition-result.record' } })).toBe(1);
  });
  it('rejects group commands, another sender and revoked league permissions', async () => {
    expect(await command(`报分 M${reference} 3:1`)).toContain('更正已有赛果必须填写原因');
    const code = await preview('3:1');
    const group = await inbound(`确认 ${code}`);
    expect(await scores.handle({ ...group, conversationType: 'GROUP' })).toContain('仅限管理员');
    expect(await scores.handle(await inbound(`确认 ${code}`, 'wxid_outsider'))).toContain('关联管理员');
    await db.adminLeagueRole.updateMany({ where: { adminId: managerId }, data: { revokedAt: new Date() } });
    expect(await command(`确认 ${code}`)).toContain('没有该联赛');
    expect(await db.matchResultVersion.count({ where: { matchId } })).toBe(1);
    await db.adminLeagueRole.updateMany({ where: { adminId: managerId }, data: { revokedAt: null } });
  });
  it('keeps bound administrators manageable after more than 100 newer candidates', async () => {
    await db.wechatAdminContact.update({ where: { id: contactId }, data: { lastObservedAt: new Date(0) } });
    await db.wechatAdminContact.createMany({ data: Array.from({ length: 101 }, (_, i) => ({ deviceId, wechatContactId: `wxid_candidate_${i}` })) });
    const list = await identities.list(adminId, deviceId);
    expect(list.items.some((item) => item.id === contactId)).toBe(true);
  });
  it('rejects stale previews, expiration, and confirmation after unlinking', async () => {
    const stale = await preview('4:1');
    await db.competitionMatch.update({ where: { id: matchId }, data: { version: { increment: 1 } } });
    expect(await command(`确认 ${stale}`)).toContain('已被其他操作修改');
    const expired = await preview('4:1');
    await db.wechatScoreOperation.update({ where: { code: expired }, data: { expiresAt: new Date(0) } });
    expect(await command(`确认 ${expired}`)).toContain(`请重新发送：报分 M${reference} 4:1 原因：赛后核对`);
    const unlinked = await preview('4:1');
    const contact = await db.wechatAdminContact.findUniqueOrThrow({ where: { id: contactId } });
    await identities.bind(adminId, deviceId, contactId, { adminId: null, expectedVersion: contact.version, reason: '', idempotencyKey: randomUUID() });
    expect(await command(`确认 ${unlinked}`)).toContain('关联管理员');
    expect((await db.wechatScoreOperation.findUniqueOrThrow({ where: { code: unlinked } })).status).toBe('CANCELLED');
    expect(await db.matchResultVersion.count({ where: { matchId } })).toBe(1);
  });
  it('revokes administrator bindings when the robot account changes', async () => {
    const contact = await db.wechatAdminContact.findUniqueOrThrow({ where: { id: contactId } });
    await identities.bind(adminId, deviceId, contactId, { adminId: managerId, expectedVersion: contact.version, reason: '', idempotencyKey: randomUUID() });
    const code = await preview();
    await db.wechatBotDevice.update({ where: { id: deviceId }, data: { wechatAccountId: 'wxid_old_robot' } });
    const bridge = new WechatBridgeService(db, undefined, undefined, config);
    await expect(bridge.heartbeat(deviceId, { wechatAccountId: 'wxid_new_robot', wechatVersion: '4.1', loginStatus: 'LOGGED_IN', screenLocked: false, outboundQueueDepth: 0, observedGroups: [] })).rejects.toThrow();
    expect((await db.wechatAdminContact.findUniqueOrThrow({ where: { id: contactId } })).adminId).toBeNull();
    expect((await db.wechatScoreOperation.findUniqueOrThrow({ where: { code } })).status).toBe('CANCELLED');
  });

});

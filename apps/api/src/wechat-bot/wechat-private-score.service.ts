import { normalizeWechatCommand, commandHelp, SCORE_HELP, TRANSFER_HELP, syntaxHint, confirmationInstructions } from './wechat-command-ux.js';
import { WechatPrivateManagementService, MANAGEMENT_HELP } from './wechat-private-management.service.js';
import { randomBytes } from 'node:crypto';
import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService, PRISMA_TRANSACTION_OPTIONS } from '../database/prisma.service.js';
import { Prisma, type WechatAdminContact, type WechatInboundMessage } from '../generated/prisma/client.js';
import { ResultsService } from '../competitions/results.service.js';
import { WECHAT_BOT_CONFIG, type WechatBotRuntimeConfig } from './wechat-bot.config.js';

type Tx = Prisma.TransactionClient;
const fail = (message: string): never => { throw new HttpException({ message }, 409); };
export function parseScoreCommand(text: string) {
  const match = /^报分\s+M([1-9]\d{0,8})\s+(\d{1,2})[:：](\d{1,2})(?:\s+原因[:：]\s*(\S.{0,511}))?$/u.exec(text);
  return match ? { reference: Number(match[1]), homeScore: Number(match[2]), awayScore: Number(match[3]), reason: match[4]?.trim() ?? '' } : null;
}

export function parseSchedulePageCommand(text: string): number | null {
  const match = /^赛程(?:\s*([1-9]\d{0,3}))?$/.exec(text);
  return match ? Number(match[1] ?? 1) : null;
}

@Injectable()
export class WechatPrivateScoreService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ResultsService) private readonly results: ResultsService,
    @Inject(WECHAT_BOT_CONFIG) private readonly config: WechatBotRuntimeConfig,
    @Optional() @Inject(WechatPrivateManagementService) private readonly management?: WechatPrivateManagementService) {}

  async handle(inbound: WechatInboundMessage): Promise<string> {
    if (!this.config.privateScoreEnabled) return '管理员私聊录分尚未启用，请使用管理后台。';
    if (inbound.conversationType !== 'PRIVATE' || inbound.conversationId !== inbound.senderId) return '管理操作仅限管理员本人私聊机器人。';
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM wechat_bot_devices WHERE id=${inbound.deviceId} FOR UPDATE`;
        const device = await tx.wechatBotDevice.findUnique({ where: { id: inbound.deviceId } });
        if (device?.status !== 'ACTIVE') return fail('机器人设备已停用。');
        const text = normalizeWechatCommand(inbound.commandText ?? '');
        if (text === '帮助') {
          await tx.wechatAdminContact.upsert({ where: { deviceId_wechatContactId: { deviceId: inbound.deviceId, wechatContactId: inbound.senderId } },
            create: { deviceId: inbound.deviceId, wechatContactId: inbound.senderId }, update: { lastObservedAt: new Date() } });
        }
        const contact = await tx.wechatAdminContact.findUnique({ where: { deviceId_wechatContactId: { deviceId: inbound.deviceId, wechatContactId: inbound.senderId } } });
        if (!contact?.adminId) return '请联系平台管理员，在后台“私聊管理员”中关联管理员账号。关联普通用户不会获得管理权限。';
        await tx.$queryRaw`SELECT id FROM admin_accounts WHERE id=${contact.adminId} FOR UPDATE`;
        const admin = await tx.adminAccount.findUnique({ where: { id: contact.adminId } });
        if (admin?.status !== 'ACTIVE') return fail('管理员账号已停用。');
        if (text !== '帮助' && (!contact.boundAt || inbound.receivedAt < contact.boundAt)) return fail('此指令早于当前管理员绑定，请重新发送。');
        if (text === '帮助') return commandHelp(!!this.config.privateManagementEnabled);
        if (text === '录分帮助') return SCORE_HELP;
        if (text === '转会帮助' || text === '拍卖帮助') return this.config.privateManagementEnabled ? (text === '转会帮助' ? TRANSFER_HELP : MANAGEMENT_HELP.slice(MANAGEMENT_HELP.indexOf('拍卖查询与控制：'))) : '转会及拍卖管理尚未启用，请联系平台管理员。';
        const action = /^(确认|取消|操作)\s+([0-9a-f]{12})$/i.exec(text);
        if (/^(确认|取消|操作)(?:\s|$|[0-9a-f])/i.test(text) && !action) return syntaxHint(text);
        if (action) return this.operation(tx, contact, action[1]!, action[2]!.toUpperCase());
        const leagueFilter: Prisma.LeagueWhereInput = { isDeleted: false,
          ...(admin.platformRole === 'PLATFORM_ADMIN' ? {} : { adminRoles: { some: { adminId: admin.id, role: 'LEAGUE_MANAGER', revokedAt: null } } }) };
        const leagues = await tx.league.findMany({ where: leagueFilter, orderBy: { name: 'asc' } });
        if (!leagues.length) return '你目前没有可管理的联赛。';
        if (text === '联赛') return '可管理联赛：\n' + leagues.map((l) => `${l.name}（${l.id}）`).join('\n') + '\n发送：切换联赛 名称或ID';
        if (text.startsWith('切换联赛 ')) {
          const query = text.slice(5).trim();
          const matches = leagues.filter((l) => l.id === query || l.name === query);
          if (matches.length !== 1) return '联赛不存在、无权限或名称重复，请发送“联赛”并使用准确ID。';
          await tx.wechatAdminContact.update({ where: { id: contact.id }, data: { leagueId: matches[0]!.id, seasonId: null } });
          return `已切换联赛：${matches[0]!.name}。发送“赛季”或“赛程”。`;
        }
        const league = leagues.find((l) => l.id === contact.leagueId) ?? (leagues.length === 1 ? leagues[0] : undefined);
        if (text === '当前设置' && !league) return `管理员：${admin.displayName}\n微信已关联\n当前联赛：未选择\n当前赛季：未选择\n下一步：联赛`;
        if (!league) return '请先发送“联赛”，再发送“切换联赛 名称或ID”。';
        await this.requireLeague(tx, admin.id, league.id);
        const seasons = await tx.leagueSeason.findMany({ where: { leagueId: league.id }, orderBy: { seasonNumber: 'desc' } });
        if (text === '赛季') return `${league.name}的赛季：\n` + seasons.map((s) => `${s.displayName}（${s.id}）`).join('\n') + '\n发送：切换赛季 名称或ID';
        if (text.startsWith('切换赛季 ')) {
          const query = text.slice(5).trim();
          const matches = seasons.filter((s) => s.id === query || s.displayName === query);
          if (matches.length !== 1) return '赛季不存在或名称重复，请发送“赛季”并使用准确ID。';
          await tx.wechatAdminContact.update({ where: { id: contact.id }, data: { leagueId: league.id, seasonId: matches[0]!.id } });
          return `已切换：${league.name} / ${matches[0]!.displayName}。发送“赛程”。`;
        }
        const season = seasons.find((s) => s.id === contact.seasonId) ?? seasons.find((s) => s.id === league.currentSeasonId) ?? (seasons.length === 1 ? seasons[0] : undefined);
        if (text === '当前设置') return `管理员：${admin.displayName}\n微信已关联\n当前联赛：${league.name}\n当前赛季：${season?.displayName ?? '未选择'}\n${season ? '下一步：赛程 / 球队 / 拍卖列表' : '下一步：赛季'}`;
        if (!season) return '请先发送“赛季”，再选择要管理的赛季。';
        const managementReply = await this.management?.handle(tx, contact, { adminId: admin.id, deviceId: inbound.deviceId, leagueId: league.id, seasonId: season.id }, text, inbound);
        if (managementReply != null) return `${league.name} / ${season.displayName}\n\n${managementReply}`;
        const pageNo = parseSchedulePageCommand(text);
        if (pageNo !== null) {
          const matches = await tx.competitionMatch.findMany({ where: { stage: { status: 'PUBLISHED', competition: { seasonId: season.id, status: { in: ['IN_PROGRESS', 'COMPLETED'] } } } },
            include: { stage: { include: { competition: true } }, homeParticipant: true, awayParticipant: true, officialResultVersion: true },
            orderBy: [{ plannedAt: 'asc' }, { id: 'asc' }], skip: (pageNo - 1) * 8, take: 9 });
          const lines = [];
          for (const match of matches.slice(0, 8)) {
            const ref = await tx.wechatMatchReference.upsert({ where: { matchId: match.id }, create: { matchId: match.id }, update: {} });
            lines.push(`M${ref.id} ${match.stage.competition.name} 第${match.roundNumber}轮\n主：${match.homeParticipant.displayNameSnapshot} / 客：${match.awayParticipant.displayNameSnapshot}\n${match.advancementWinnerParticipantId ? `裁定${match.advancementWinnerParticipantId === match.homeParticipantId ? '主队' : '客队'}晋级（无比分）` : match.officialResultVersion ? `${match.officialResultVersion.homeScore}:${match.officialResultVersion.awayScore}` : '未录分'} · ${match.status}\n录分格式：报分 M${ref.id} 主队比分:客队比分 原因：说明${match.stage.format === 'SINGLE_ELIMINATION' ? `\n晋级格式：晋级 M${ref.id} 主队/客队 原因：说明` : ''}`);
          }
          return `${league.name} / ${season.displayName}（第${pageNo}页）\n${lines.join('\n\n') || '没有可录分的已发布比赛。'}${matches.length > 8 ? `\n下一页：赛程 ${pageNo + 1}` : ''}`;
        }
        const score = parseScoreCommand(text);
        if (!score) return syntaxHint(text);
        const existing = await tx.wechatScoreOperation.findUnique({ where: { inboundId: inbound.id } });
        if (existing) return existing.preview;
        const reference = await tx.wechatMatchReference.findUnique({ where: { id: score.reference }, include: { match: { include: {
          stage: { include: { competition: true } }, homeParticipant: true, awayParticipant: true, officialResultVersion: true
        } } } });
        const match = reference?.match;
        if (!match || match.stage.competition.seasonId !== season.id) return fail('比赛不存在或不属于当前联赛、赛季，请重新查询赛程。');
        if (!score.reason && (match.officialResultVersion || match.advancementWinnerParticipantId)) return fail('更正已有赛果必须填写原因。\n格式：报分 M编号 主队比分:客队比分 原因：更正说明');
        score.reason ||= '管理员录入赛果';
        if (match.stage.status !== 'PUBLISHED' || !['IN_PROGRESS', 'COMPLETED'].includes(match.stage.competition.status)) return fail('比赛当前不可录分。');
        if (match.stage.format === 'SINGLE_ELIMINATION' && score.homeScore === score.awayScore) return fail('淘汰赛比分不能为平局。');
        const code = randomBytes(6).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + 120_000);
        const preview = `录分预览（尚未提交）\n${league.name} / ${season.displayName}\n${match.stage.competition.name} 第${match.roundNumber}轮 M${reference!.id}\n主：${match.homeParticipant.displayNameSnapshot}\n客：${match.awayParticipant.displayNameSnapshot}\n原比分：${match.officialResultVersion ? `${match.officialResultVersion.homeScore}:${match.officialResultVersion.awayScore}` : match.advancementWinnerParticipantId ? '已裁定晋级（无比分），本次将改为比分结果' : '未录入'}\n新比分：${score.homeScore}:${score.awayScore}\n原因：${score.reason}\n将按赛事规则更新积分或淘汰赛签表。\n${confirmationInstructions(expiresAt, code)}`;
        await tx.wechatScoreOperation.create({ data: { code, contactId: contact.id, bindingVersion: contact.version, inboundId: inbound.id,
          adminId: admin.id, matchId: match.id, leagueId: league.id, expectedVersion: match.version, homeScore: score.homeScore, awayScore: score.awayScore,
          reason: score.reason, preview, expiresAt } });
        return preview;
      }, { ...PRISMA_TRANSACTION_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      const response = error.getResponse();
      const code = typeof response === 'object' && response !== null && 'code' in response ? String(response.code) : '';
      const messages: Record<string, string> = { VERSION_CONFLICT: '相关数据已被其他操作修改，本次未执行变更。请重新查询并预览。', DISPUTE_NOT_READY: '比赛争议尚未进入可裁决阶段，请在后台查看。',
        KNOCKOUT_DRAW_NOT_ALLOWED: '淘汰赛不能录入平局。', MATCH_RESULT_NOT_ALLOWED: '比赛当前不可录分。', TEAM_ARCHIVED: '球队已退出，不能执行本次操作。' };
      if (messages[code]) return messages[code]!;
      const businessMessages: Record<string, string> = { TRANSFER_WINDOW_CLOSED: '转会窗口尚未开放，本次未执行转会。请到联赛工作区的窗口设置核对时间。', AUCTION_STATE_INVALID: '拍卖状态不允许本次操作，未执行变更。请发送“拍卖 A编号”查看状态和下一步。' };
      if (businessMessages[code]) return businessMessages[code]!;
      if (code) return `操作未完成（${code}）。${typeof response === 'object' && response !== null && 'message' in response ? String(response.message) : '请到管理后台核查。'}`;
      return typeof response === 'object' && response !== null && 'message' in response ? String(response.message) : '操作未完成，请重试或查看管理后台。';
    }
  }

  private async requireLeague(tx: Tx, adminId: string, leagueId: string) {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id=${leagueId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM admin_league_roles WHERE admin_id=${adminId} AND league_id=${leagueId} FOR UPDATE`;
    const [admin, league, role] = await Promise.all([
      tx.adminAccount.findUnique({ where: { id: adminId } }), tx.league.findUnique({ where: { id: leagueId } }),
      tx.adminLeagueRole.findFirst({ where: { adminId, leagueId, role: 'LEAGUE_MANAGER', revokedAt: null } })
    ]);
    if (!league || league.isDeleted || admin?.status !== 'ACTIVE' || (admin.platformRole !== 'PLATFORM_ADMIN' && !role)) return fail('你已没有该联赛的管理权限。');
  }

  private async operation(tx: Tx, contact: WechatAdminContact, action: string, code: string) {
    const op = await tx.wechatScoreOperation.findUnique({ where: { code } });
    if (!op && this.management) return this.management.operation(tx, contact, action, code, (leagueId) => this.requireLeague(tx, contact.adminId!, leagueId));
    if (!op || op.contactId !== contact.id || op.adminId !== contact.adminId || op.bindingVersion !== contact.version) return fail('确认码不存在或不属于当前管理员绑定。');
    await this.requireLeague(tx, contact.adminId!, op.leagueId);
    if (action === '操作') return `操作 ${code}：${op.status}${op.result ? `\n${op.result}` : op.expiresAt <= new Date() ? '\n已过期，请重新报分。' : '\n等待确认。'}`;
    if (op.status === 'COMPLETED') return action === '取消' ? `此操作已完成，取消确认码不能撤销已录入的赛果。\n${op.result}` : op.result!;
    if (op.status !== 'PENDING') return '此操作已取消或失效，请重新报分。';
    if (action === '取消') {
      await tx.wechatScoreOperation.update({ where: { id: op.id }, data: { status: 'CANCELLED', completedAt: new Date() } });
      return `已取消操作 ${code}，没有修改比分。`;
    }
    if (op.expiresAt <= new Date()) {
      const original = await tx.wechatInboundMessage.findUnique({ where: { id: op.inboundId } });
      return fail(`确认已过期，未执行本次录分。\n请重新发送：${original?.commandText ?? '报分 M编号 主队比分:客队比分 原因：说明'}`);
    }
    await this.results.lockForOfficialResult(tx, op.matchId);
    const official = await this.results.applyAdministratorResult(tx, op.matchId,
      { homeScore: op.homeScore, awayScore: op.awayScore, expectedVersion: op.expectedVersion, reason: op.reason },
      { adminId: contact.adminId!, leagueId: op.leagueId }, new Date());
    const result = `录分成功：${official.homeScore}:${official.awayScore}（主:客）。\n${op.preview.split('\n').slice(1, 5).join('\n')}\n操作 ${code} 已完成，重复确认不会再次录入。`;
    await tx.wechatScoreOperation.update({ where: { id: op.id }, data: { status: 'COMPLETED', result, completedAt: new Date() } });
    return result;
  }
}

import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WechatAdminContact, WechatInboundMessage } from '../generated/prisma/client.js';
import { WECHAT_BOT_CONFIG, type WechatBotRuntimeConfig } from './wechat-bot.config.js';
import { parseAdminCommand } from './wechat-admin-command.js';
import { WechatManagementEffectsService, managementFail, outcomeHash, previewWithRollback, type ManagementPayload, type ManagementScope, type ManagementTx } from './wechat-management-effects.service.js';

export const MANAGEMENT_HELP = '\n\n' + [
  '赛事与球队：',
  '晋级 M编号 主队/客队 原因：弃权说明',
  '球队',
  '阵容 T球队编号',
  '转会 P编号 T转出 T转入 金额 原因：说明',
  '',
  '拍卖查询与控制：',
  '拍卖列表',
  '拍卖 A编号 [页码]',
  '开始拍卖 A编号',
  '暂停拍卖 A编号',
  '继续拍卖 A编号',
  '取消拍卖 A编号 原因：说明',
  '恢复拍卖 A编号 原因：已核对群消息',
  '',
  '拍卖成交审核：',
  '审核成交 L编号',
  '调整成交 L编号 T球队编号 金额 原因：说明',
  '作废成交 L编号 原因：说明',
  '',
  '除紧急暂停外先预览后确认。金额使用后台系统单位。',
].join('\n');
@Injectable()
export class WechatPrivateManagementService {
  constructor(@Inject(WechatManagementEffectsService) private readonly effects: WechatManagementEffectsService,
    @Inject(WECHAT_BOT_CONFIG) private readonly config: WechatBotRuntimeConfig) {}

  async handle(tx: ManagementTx, contact: WechatAdminContact, scope: ManagementScope, text: string, inbound: WechatInboundMessage): Promise<string | null> {
    const query = /^(球队|阵容\s+T[1-9]\d{0,8}|拍卖列表|拍卖\s+A[1-9]\d{0,8}(?:\s+[1-9]\d{0,3})?)$/.test(text);
    const command = parseAdminCommand(text);
    if (!query && !command) return null;
    if (!this.config.privateManagementEnabled) return '私聊晋级、转会及拍卖管理尚未启用。';
    const result = await this.query(tx, scope, text);
    if (result !== null) return result;
    if (!command) return MANAGEMENT_HELP;
    const existing = await tx.wechatAdminOperation.findUnique({ where: { inboundId: inbound.id } });
    if (existing) return existing.result ?? existing.preview;
    const payload = await this.effects.prepare(tx, scope, command);
    const id = randomUUID();
    // A distinct first hex nibble is not needed: both stores are checked before assigning a code.
    let code: string;
    do { code = randomBytes(6).toString('hex').toUpperCase(); }
    while (await tx.wechatScoreOperation.findUnique({ where: { code } }) || await tx.wechatAdminOperation.findUnique({ where: { code } }));
    const effect = command.kind === 'PAUSE' ? await this.effects.run(tx, scope, payload, id)
      : await previewWithRollback(tx, () => this.effects.run(tx, scope, payload, id));
    payload.expectedOutcome = outcomeHash(effect.fingerprint);
    const [league, season] = await Promise.all([tx.league.findUniqueOrThrow({ where: { id: scope.leagueId } }), tx.leagueSeason.findUniqueOrThrow({ where: { id: scope.seasonId } })]);
    const preview = `管理操作预览（尚未提交）\n${league.name} / ${season.displayName}\n${payload.title}\n原因：${command.reason}\n执行效果：${effect.text}\n2分钟内回复：确认 ${code}\n放弃：取消 ${code}`;
    const completed = command.kind === 'PAUSE';
    const reply = completed ? `${payload.title}\n${effect.text}\n操作 ${code} 已完成。` : preview;
    await tx.wechatAdminOperation.create({ data: { id, code, contactId: contact.id, bindingVersion: contact.version, inboundId: inbound.id,
      adminId: scope.adminId, leagueId: scope.leagueId, seasonId: scope.seasonId, kind: command.kind, payload: payload as unknown as Prisma.InputJsonValue,
      preview, expiresAt: new Date(Date.now() + 120_000), ...(completed ? { status: 'COMPLETED', result: reply, completedAt: new Date() } : {}) } });
    return reply;
  }

  async operation(tx: ManagementTx, contact: WechatAdminContact, action: string, code: string, authorize: (leagueId: string) => Promise<void>): Promise<string> {
    if (!this.config.privateManagementEnabled) return '此操作不存在或管理功能尚未启用。';
    const op = await tx.wechatAdminOperation.findUnique({ where: { code } });
    if (!op || op.contactId !== contact.id || op.adminId !== contact.adminId || op.bindingVersion !== contact.version) return managementFail('确认码不存在或不属于当前管理员绑定。');
    await authorize(op.leagueId);
    if (op.status === 'COMPLETED') return op.result!;
    if (action === '操作') return `操作 ${code}：${op.status}${op.expiresAt <= new Date() ? '，已过期' : ''}\n${op.preview}`;
    if (op.status !== 'PENDING') return '操作已取消或失效，请重新预览。';
    if (action === '取消') {
      await tx.wechatAdminOperation.update({ where: { id: op.id }, data: { status: 'CANCELLED', completedAt: new Date() } });
      return `已取消 ${code}，没有执行业务操作。`;
    }
    if (op.expiresAt <= new Date()) return managementFail('确认已过期，请重新预览。');
    const scope = { adminId: op.adminId, deviceId: contact.deviceId, leagueId: op.leagueId, seasonId: op.seasonId };
    const payload = op.payload as unknown as ManagementPayload;
    const effect = await this.effects.run(tx, scope, payload, op.id);
    if (outcomeHash(effect.fingerprint) !== payload.expectedOutcome) return managementFail('费用、入队结果或相关数据已变化，本次操作已回滚，请重新预览。');
    const reply = `操作成功\n${payload.title}\n${effect.text}\n操作 ${code} 已完成，重复确认不会再次执行。`;
    await tx.wechatAdminOperation.update({ where: { id: op.id }, data: { status: 'COMPLETED', result: reply, completedAt: new Date() } });
    return reply;
  }

  private async ref(tx: ManagementTx, kind: string, entityId: string, prefix: string) {
    const r = await tx.wechatEntityReference.upsert({ where: { kind_entityId: { kind, entityId } }, create: { kind, entityId }, update: {} });
    return `${prefix}${r.id}`;
  }
  private async query(tx: ManagementTx, scope: ManagementScope, text: string): Promise<string | null> {
    if (text === '球队') {
      const teams = await tx.leagueTeam.findMany({ where: { leagueId: scope.leagueId, status: 'ACTIVE' }, orderBy: { teamNumber: 'asc' } });
      return '当前联赛球队：\n' + teams.map((t) => `T${t.teamNumber} ${t.name}`).join('\n') + '\n发送：阵容 T球队编号';
    }
    const roster = /^阵容\s+T([1-9]\d{0,8})$/.exec(text);
    if (roster) {
      const team = await tx.leagueTeam.findFirst({ where: { leagueId: scope.leagueId, teamNumber: +roster[1]!, status: 'ACTIVE' } });
      if (!team) return managementFail('当前联赛没有该现役球队。');
      const rows = await tx.leaguePlayerOwnership.findMany({ where: { leagueTeamId: team.id, status: 'ACTIVE' }, include: { footballPlayer: true }, orderBy: { id: 'asc' } });
      const lines = [];
      for (const r of rows) lines.push(`${await this.ref(tx, 'OWNERSHIP', r.id, 'P')} ${(r.footballPlayer.nameZh ?? r.footballPlayer.nameEn ?? '未命名球员')} / 工资 ${r.salaryMinor}\n卡ID ${r.currentPlayerCardId}`);
      return `${team.name} 当前阵容：\n${lines.join('\n') || '暂无球员'}`;
    }
    if (text === '拍卖列表') {
      const batches = await tx.playerAuctionBatch.findMany({ where: { leagueId: scope.leagueId, bidChannel: 'WECHAT_GROUP', status: { not: 'COMPLETED' }, groupBinding: { deviceId: scope.deviceId } }, orderBy: { createdAt: 'desc' }, take: 30 });
      const lines = [];
      for (const b of batches) lines.push(`${await this.ref(tx, 'BATCH', b.id, 'A')} ${b.name} / ${b.status}`);
      return '最近30个本机器人未完成的拍卖批次：\n' + (lines.join('\n') || '暂无未完成批次，请先在后台创建并准备。');
    }
    const detail = /^拍卖\s+A([1-9]\d{0,8})(?:\s+([1-9]\d{0,3}))?$/.exec(text);
    if (!detail) return null;
    const reference = await tx.wechatEntityReference.findUnique({ where: { id: +detail[1]! } });
    if (reference?.kind !== 'BATCH') return managementFail('拍卖编号不存在。');
    const batch = await tx.playerAuctionBatch.findFirst({ where: { id: reference.entityId, leagueId: scope.leagueId, bidChannel: 'WECHAT_GROUP', groupBinding: { deviceId: scope.deviceId } }, include: { groupBinding: true } });
    if (!batch) return managementFail('拍卖不在当前联赛或机器人范围。');
    const page = Number(detail[2] ?? 1);
    const lots = await tx.playerAuctionLot.findMany({ where: { batchId: batch.id }, orderBy: { displayOrder: 'asc' }, skip: (page - 1) * 8, take: 9 });
    const lines = [];
    for (const l of lots.slice(0, 8)) lines.push(`${await this.ref(tx, 'LOT', l.id, 'L')} ${l.playerNameSnapshot} / ${l.status} / 起拍价 ${l.startingPrice} / 当前价 ${l.currentPrice ?? '无'}`);
    return `${batch.name} / ${batch.status}\n目标群：${batch.groupBinding?.displayName}\n${lines.join('\n') || '本页无拍品'}${lots.length > 8 ? `\n下一页：拍卖 A${detail[1]} ${page + 1}` : ''}`;
  }
}

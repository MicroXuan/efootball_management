import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  CreateTransactionFeeRuleRequest,
  LeagueTransactionListResponse,
  TransactionFeeRuleVersion
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LeagueError } from '../leagues/league.errors.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

export type TransactionFeeQuote = {
  valuationSnapshotMinor: number;
  transactionFeeMinor: number;
  transactionFeeRuleVersionId: string;
};

@Injectable()
export class TransactionFeesService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  quote(leagueId: string, playerId: string, at = new Date()) {
    return this.quoteWithClient(this.prisma, leagueId, playerId, at);
  }

  async quoteWithClient(
    client: PrismaService | Prisma.TransactionClient,
    leagueId: string,
    playerId: string,
    at = new Date()
  ): Promise<TransactionFeeQuote> {
    await this.visibility.requireVisible(
      { type: 'LEAGUE', id: leagueId },
      client as Prisma.TransactionClient
    );
    const rule = await client.leagueTransactionFeeRuleVersion.findFirst({
      where: { leagueId, effectiveAt: { lte: at } },
      orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }]
    });
    if (!rule) throw this.error('TRANSACTION_FEE_RULE_NOT_FOUND', '当前没有生效的交易手续费规则', 409);
    const valuation = await client.leaguePlayerValuation.findUnique({
      where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: playerId } }
    });
    if (!valuation) {
      throw this.error('PLAYER_VALUATION_REQUIRED_FOR_FEE', '球员没有正式身价，无法自动计算手续费', 409);
    }
    const calculated = Math.ceil((valuation.currentValueMinor * rule.rateBps) / 10_000);
    return {
      valuationSnapshotMinor: valuation.currentValueMinor,
      transactionFeeMinor: Math.max(calculated, rule.minimumFeeMinor),
      transactionFeeRuleVersionId: rule.id
    };
  }

  async quoteIfConfiguredWithClient(
    client: Prisma.TransactionClient,
    leagueId: string,
    playerId: string,
    at = new Date()
  ): Promise<TransactionFeeQuote | null> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId }, client);
    const configured = await client.leagueTransactionFeeRuleVersion.findFirst({
      where: { leagueId, effectiveAt: { lte: at } },
      select: { id: true }
    });
    return configured ? this.quoteWithClient(client, leagueId, playerId, at) : null;
  }

  async createRuleVersion(
    adminId: string,
    leagueId: string,
    input: CreateTransactionFeeRuleRequest,
    key: string
  ): Promise<TransactionFeeRuleVersion> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    await this.authorization.requireLeagueManager(adminId, leagueId);
    return this.receipts.execute(adminId, `transaction-fee-rule.create:${leagueId}`, key, async (tx) => {
      await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`;
      const league = await tx.league.findUnique({ where: { id: leagueId }, select: { id: true } });
      if (!league) throw this.error('LEAGUE_NOT_FOUND', '联赛不存在', 404);
      const current = await tx.leagueTransactionFeeRuleVersion.findFirst({
        where: { leagueId }, orderBy: { version: 'desc' }
      });
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== input.expectedCurrentVersion) {
        throw this.error('VERSION_CONFLICT', '手续费规则已被其他管理员更新', 409);
      }
      const created = await tx.leagueTransactionFeeRuleVersion.create({
        data: {
          leagueId,
          version: currentVersion + 1,
          rateBps: input.rateBps,
          minimumFeeMinor: input.minimumFeeMinor,
          effectiveAt: new Date(input.effectiveAt),
          createdByAdminId: adminId
        }
      });
      await this.audit.record(tx, {
        actorAdminId: adminId,
        leagueId,
        action: 'TRANSACTION_FEE_RULE_CREATED',
        resourceType: 'LEAGUE_TRANSACTION_FEE_RULE_VERSION',
        resourceId: created.id,
        metadata: { version: created.version, rateBps: created.rateBps, minimumFeeMinor: created.minimumFeeMinor }
      });
      return this.presentRule(created);
    }, input);
  }

  async listRuleVersions(leagueId: string): Promise<{ items: TransactionFeeRuleVersion[] }> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const rules = await this.prisma.leagueTransactionFeeRuleVersion.findMany({
      where: { leagueId }, orderBy: { version: 'desc' }
    });
    return { items: rules.map((rule) => this.presentRule(rule)) };
  }

  async listTransactions(
    leagueId: string,
    cursor?: string,
    limit = 30
  ): Promise<LeagueTransactionListResponse> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const rows = await this.prisma.rosterTransaction.findMany({
      where: { leagueId },
      include: {
        footballPlayer: true,
        sourceLeagueTeam: { select: { name: true } },
        targetLeagueTeam: { select: { name: true } }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        leagueId: row.leagueId,
        seasonId: row.seasonId,
        type: row.type,
        playerId: row.footballPlayerId,
        playerName: row.footballPlayer.nameZh ?? row.footballPlayer.nameEn ?? row.footballPlayer.shortName ?? '未命名球员',
        sourceLeagueTeamId: row.sourceLeagueTeamId,
        sourceTeamName: row.sourceLeagueTeam?.name ?? null,
        targetLeagueTeamId: row.targetLeagueTeamId,
        targetTeamName: row.targetLeagueTeam?.name ?? null,
        amountMinor: row.amountMinor,
        valuationSnapshotMinor: row.valuationSnapshotMinor,
        transactionFeeMinor: row.transactionFeeMinor,
        transactionFeeRuleVersionId: row.transactionFeeRuleVersionId,
        reason: row.reason,
        createdByAdminId: row.createdByAdminId,
        createdAt: row.createdAt.toISOString()
      })),
      nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null
    };
  }

  async listTransactionsForParticipant(userId: string, leagueId: string, cursor?: string, limit = 30) {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const entry = await this.prisma.seasonEntry.findFirst({
      where: { ownerUserId: userId, status: 'APPROVED', season: { leagueId } }, select: { id: true }
    });
    if (!entry) throw this.error('LEAGUE_PARTICIPANT_REQUIRED', '只有联赛参赛用户可以查看交易记录', 403);
    return this.listTransactions(leagueId, cursor, limit);
  }

  private presentRule(rule: {
    id: string; leagueId: string; version: number; rateBps: number; minimumFeeMinor: number;
    effectiveAt: Date; createdByAdminId: string; createdAt: Date;
  }): TransactionFeeRuleVersion {
    return {
      ...rule,
      effectiveAt: rule.effectiveAt.toISOString(),
      createdAt: rule.createdAt.toISOString()
    };
  }

  private error(code: string, message: string, status: number) {
    return new LeagueError(code, message, status);
  }
}

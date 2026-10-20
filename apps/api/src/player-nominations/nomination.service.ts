import { Inject, Injectable } from '@nestjs/common';
import { SubmitNominationRequestSchema, type MyNominationWorkspace, type NominationCandidate, type PlayerNomination, type SubmitNominationRequest } from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type NominationWindow, type PlayerNomination as DbNomination } from '../generated/prisma/client.js';
import { PlayerMarketAccessService } from '../player-market/player-market-access.service.js';
import { LeagueError } from '../leagues/league.errors.js';

type Window = NominationWindow & { season: { leagueId: string } };

@Injectable()
export class NominationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerMarketAccessService) private readonly access: PlayerMarketAccessService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService
  ) {}

  async listWindows(userId: string, leagueId: string, seasonId: string) {
    await this.access.requireParticipant(userId, leagueId, seasonId);
    const windows = await this.prisma.nominationWindow.findMany({
      where: { seasonId }, include: { season: true }, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }]
    });
    return { items: windows.map((window) => this.presentWindow(window)) };
  }

  async workspace(userId: string, windowId: string, now = new Date()): Promise<MyNominationWorkspace> {
    const window = await this.requireWindow(windowId);
    const team = await this.access.requireParticipant(userId, window.season.leagueId, window.seasonId);
    const nominations = await this.prisma.playerNomination.findMany({
      where: { windowId, leagueTeamId: team.leagueTeamId, withdrawnAt: null },
      include: { footballPlayer: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    return {
      window: this.presentWindow(window), leagueTeamId: team.leagueTeamId,
      isOpen: now >= window.startsAt && now < window.endsAt,
      remainingSlots: Math.max(0, window.perTeamLimit - nominations.length),
      nominations: nominations.map((nomination) => this.present(nomination, nomination.footballPlayer.nameZh ?? nomination.footballPlayer.nameEn ?? '未知球员'))
    };
  }

  async submit(userId: string, windowId: string, raw: SubmitNominationRequest, key: string, at?: Date): Promise<PlayerNomination> {
    const input = SubmitNominationRequestSchema.parse(raw);
    const window = await this.requireWindow(windowId);
    const team = await this.access.requireParticipant(userId, window.season.leagueId, window.seasonId);
    return this.receipts.execute(userId, `nomination.submit:${windowId}:${input.playerId}`, key, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM league_teams WHERE id = ${team.leagueTeamId} FOR UPDATE`);
      const current = await tx.nominationWindow.findUnique({ where: { id: windowId }, include: { season: true } });
      if (!current) throw this.error('NOMINATION_WINDOW_NOT_FOUND', '提名期不存在', 404);
      this.assertOpen(current, at ?? new Date());
      const existing = await tx.playerNomination.findUnique({
        where: { windowId_leagueTeamId_footballPlayerId: { windowId, leagueTeamId: team.leagueTeamId, footballPlayerId: input.playerId } }
      });
      const player = await tx.footballPlayer.findFirst({ where: { id: input.playerId, publishedAt: { not: null } } });
      if (!player) throw this.error('NOMINATION_PLAYER_NOT_FOUND', '球员不存在或尚未发布', 404);
      const ownership = await tx.leaguePlayerOwnership.findUnique({
        where: { leagueId_footballPlayerId: { leagueId: current.season.leagueId, footballPlayerId: input.playerId } }
      });
      if (ownership?.status === 'ACTIVE') throw this.error('NOMINATION_PLAYER_OWNED', '该球员已有归属球队', 409);
      const name = player.nameZh ?? player.nameEn ?? '未知球员';
      if (existing && !existing.withdrawnAt) return this.present(existing, name);
      const count = await tx.playerNomination.count({ where: { windowId, leagueTeamId: team.leagueTeamId, withdrawnAt: null } });
      if (count >= current.perTeamLimit) throw this.error('NOMINATION_LIMIT_REACHED', '球队提名名额已用完', 409);
      const nomination = existing
        ? await tx.playerNomination.update({ where: { id: existing.id }, data: { withdrawnAt: null } })
        : await tx.playerNomination.create({ data: { windowId, leagueTeamId: team.leagueTeamId, footballPlayerId: input.playerId } });
      return this.present(nomination, name);
    });
  }

  async withdraw(userId: string, windowId: string, nominationId: string, key: string, at?: Date): Promise<PlayerNomination> {
    const window = await this.requireWindow(windowId);
    const team = await this.access.requireParticipant(userId, window.season.leagueId, window.seasonId);
    return this.receipts.execute(userId, `nomination.withdraw:${nominationId}`, key, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM league_teams WHERE id = ${team.leagueTeamId} FOR UPDATE`);
      const current = await tx.nominationWindow.findUnique({ where: { id: windowId }, include: { season: true } });
      if (!current) throw this.error('NOMINATION_WINDOW_NOT_FOUND', '提名期不存在', 404);
      const now = at ?? new Date();
      this.assertOpen(current, now);
      const nomination = await tx.playerNomination.findUnique({ where: { id: nominationId }, include: { footballPlayer: true } });
      if (!nomination || nomination.windowId !== windowId || nomination.leagueTeamId !== team.leagueTeamId) throw this.error('NOMINATION_NOT_FOUND', '提名不存在', 404);
      const updated = nomination.withdrawnAt ? nomination : await tx.playerNomination.update({ where: { id: nominationId }, data: { withdrawnAt: now } });
      return this.present(updated, nomination.footballPlayer.nameZh ?? nomination.footballPlayer.nameEn ?? '未知球员');
    });
  }

  async candidates(adminId: string, leagueId: string, windowId: string): Promise<{ items: NominationCandidate[] }> {
    const window = await this.requireWindow(windowId);
    if (window.season.leagueId !== leagueId) throw this.error('NOMINATION_WINDOW_NOT_FOUND', '提名期不存在', 404);
    await this.authorization.requireLeagueManager(adminId, leagueId);
    const rows = await this.prisma.playerNomination.findMany({
      where: { windowId, withdrawnAt: null },
      include: { footballPlayer: true, leagueTeam: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const grouped = new Map<string, NominationCandidate>();
    for (const row of rows) {
      let candidate = grouped.get(row.footballPlayerId);
      if (!candidate) {
        candidate = { playerId: row.footballPlayerId, playerName: row.footballPlayer.nameZh ?? row.footballPlayer.nameEn ?? '未知球员', nominatorCount: 0, nominators: [], eligible: row.footballPlayer.publishedAt !== null };
        grouped.set(row.footballPlayerId, candidate);
      }
      candidate.nominatorCount += 1;
      candidate.nominators.push({ leagueTeamId: row.leagueTeam.id, teamNumber: row.leagueTeam.teamNumber, teamName: row.leagueTeam.name, ownerAlias: row.leagueTeam.ownerAlias });
    }
    if (grouped.size) {
      const owned = await this.prisma.leaguePlayerOwnership.findMany({
        where: { leagueId, footballPlayerId: { in: [...grouped.keys()] }, status: 'ACTIVE' },
        select: { footballPlayerId: true }
      });
      for (const row of owned) grouped.get(row.footballPlayerId)!.eligible = false;
    }
    return { items: [...grouped.values()].sort((a, b) => b.nominatorCount - a.nominatorCount || a.playerName.localeCompare(b.playerName) || a.playerId.localeCompare(b.playerId)) };
  }

  private async requireWindow(windowId: string): Promise<Window> {
    const window = await this.prisma.nominationWindow.findUnique({ where: { id: windowId }, include: { season: true } });
    if (!window) throw this.error('NOMINATION_WINDOW_NOT_FOUND', '提名期不存在', 404);
    return window;
  }

  private assertOpen(window: Pick<NominationWindow, 'startsAt' | 'endsAt'>, at: Date) {
    if (at < window.startsAt || at >= window.endsAt) throw this.error('NOMINATION_WINDOW_CLOSED', '当前不在提名期内', 409);
  }

  private presentWindow(window: Window) {
    return { id: window.id, leagueId: window.season.leagueId, seasonId: window.seasonId, startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString(), perTeamLimit: window.perTeamLimit, version: window.version };
  }

  private present(nomination: DbNomination, playerName: string): PlayerNomination {
    return { id: nomination.id, windowId: nomination.windowId, leagueTeamId: nomination.leagueTeamId, playerId: nomination.footballPlayerId, playerName, createdAt: nomination.createdAt.toISOString(), withdrawnAt: nomination.withdrawnAt?.toISOString() ?? null };
  }

  private error(code: string, message: string, status: number) { return new LeagueError(code, message, status); }
}

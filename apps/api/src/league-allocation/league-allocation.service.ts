import { Inject, Injectable } from '@nestjs/common';
import type {
  ConfirmSeasonAllocationRequest,
  GenerateSeasonAllocationRequest,
  SeasonTransitionRequest
} from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import {
  buildFirstSeasonAllocation,
  buildRegularSeasonAllocation,
  type PreviousSeasonStanding
} from './domain/allocation.js';
import { LeagueAllocationError } from './league-allocation.errors.js';

const ALGORITHM_VERSION = 'tiered-v1';
const SEASON_INCLUDE = {
  entries: {
    where: { status: 'APPROVED' as const },
    select: {
      id: true,
      teamNameSnapshot: true,
      previousSeasonEntryId: true,
      status: true
    }
  }
} satisfies Prisma.LeagueSeasonInclude;
const PROPOSAL_INCLUDE = {
  rows: { orderBy: [{ suggestedStageCode: 'asc' as const }, { id: 'asc' as const }] }
} satisfies Prisma.SeasonAllocationProposalInclude;

type ProposalRecord = Prisma.SeasonAllocationProposalGetPayload<{ include: typeof PROPOSAL_INCLUDE }>;

@Injectable()
export class LeagueAllocationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async generate(
    actorAdminId: string,
    leagueId: string,
    seasonId: string,
    input: GenerateSeasonAllocationRequest,
    key: string
  ) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.league-allocation.generate:${seasonId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`;
        const season = await transaction.leagueSeason.findUnique({
          where: { id: seasonId },
          include: SEASON_INCLUDE
        });
        if (!season || season.leagueId !== leagueId) {
          throw new LeagueAllocationError('SEASON_NOT_IN_LEAGUE', '赛季不属于当前联赛', 404);
        }
        if (season.status !== 'ALLOCATION_REVIEW') {
          throw new LeagueAllocationError(
            'SEASON_NOT_IN_ALLOCATION_REVIEW',
            '只有进入分组确认阶段的赛季才能生成分组建议',
            409
          );
        }
        if (season.version !== input.expectedSeasonVersion) {
          throw new LeagueAllocationError('VERSION_CONFLICT', '赛季已被其他管理员修改，请刷新后重试', 409);
        }

        const entries = season.entries.map((entry) => ({
          seasonEntryId: entry.id,
          teamName: entry.teamNameSnapshot
        }));
        const suggestions = season.isFirstSeason
          ? buildFirstSeasonAllocation({
            entries,
            championCapacity: season.championCapacity,
            randomSeed: input.randomSeed
          })
          : buildRegularSeasonAllocation({
            entries,
            previousStandings: await this.previousStandings(transaction, season.previousSeasonId, season.entries),
            superCapacity: season.superCapacity,
            championCapacity: season.championCapacity,
            promotionCount: season.promotionCount,
            randomSeed: input.randomSeed
          });

        const previous = await transaction.seasonAllocationProposal.findFirst({
          where: { seasonId },
          orderBy: { version: 'desc' },
          select: { version: true }
        });
        await transaction.seasonAllocationProposal.updateMany({
          where: { seasonId, status: 'DRAFT' },
          data: { status: 'SUPERSEDED' }
        });
        const proposal = await transaction.seasonAllocationProposal.create({
          data: {
            seasonId,
            version: (previous?.version ?? 0) + 1,
            algorithmVersion: ALGORITHM_VERSION,
            randomSeed: input.randomSeed,
            createdByAdminId: actorAdminId,
            inputSummary: {
              approvedEntryIds: season.entries.map((entry) => entry.id),
              isFirstSeason: season.isFirstSeason,
              superCapacity: season.superCapacity,
              championCapacity: season.championCapacity,
              promotionCount: season.promotionCount
            },
            rows: {
              create: suggestions.map((suggestion) => ({
                seasonEntryId: suggestion.seasonEntryId,
                teamName: suggestion.teamName,
                suggestedStageCode: suggestion.stageCode,
                source: suggestion.source,
                previousRank: suggestion.previousRank,
                pointsPerMatch: suggestion.pointsPerMatch,
                goalDifferencePerMatch: suggestion.goalDifferencePerMatch,
                goalsForPerMatch: suggestion.goalsForPerMatch,
                tiePending: suggestion.tiePending,
                reason: suggestion.reason
              }))
            }
          },
          include: PROPOSAL_INCLUDE
        });
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.league-allocation.generate',
          resourceType: 'SeasonAllocationProposal',
          resourceId: proposal.id,
          metadata: {
            seasonId,
            proposalVersion: proposal.version,
            randomSeed: proposal.randomSeed,
            approvedEntryCount: season.entries.length
          }
        });
        return this.response(proposal);
      },
      input
    );
  }

  async latest(actorAdminId: string, leagueId: string, seasonId: string) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    const season = await this.prisma.leagueSeason.findUnique({
      where: { id: seasonId },
      select: { leagueId: true, version: true, status: true }
    });
    if (!season || season.leagueId !== leagueId) {
      throw new LeagueAllocationError('SEASON_NOT_IN_LEAGUE', '赛季不属于当前联赛', 404);
    }
    const proposal = await this.prisma.seasonAllocationProposal.findFirst({
      where: { seasonId },
      include: PROPOSAL_INCLUDE,
      orderBy: { version: 'desc' }
    });
    if (!proposal) {
      throw new LeagueAllocationError('ALLOCATION_PROPOSAL_NOT_FOUND', '当前赛季尚未生成分组建议', 404);
    }
    if (proposal.status !== 'CONFIRMED') return this.response(proposal);
    const [competition, decisions] = await Promise.all([
      this.prisma.competition.findFirst({
        where: { seasonId, competitionType: 'DIVISION_LEAGUE' },
        include: {
          stages: {
            where: { stageCode: { not: null } },
            include: { _count: { select: { participants: true, matches: true } } },
            orderBy: [{ sequence: 'asc' }, { id: 'asc' }]
          }
        }
      }),
      this.prisma.seasonAllocationDecision.findMany({ where: { proposalId: proposal.id } })
    ]);
    return {
      ...this.response(proposal),
      confirmedAllocation: competition ? {
        competitionId: competition.id,
        seasonVersion: season.version,
        seasonStatus: season.status,
        stages: competition.stages.map((stage) => ({
          id: stage.id,
          stageCode: stage.stageCode!,
          displayName: stage.displayName!,
          participantCount: stage._count.participants,
          matchCount: stage._count.matches,
          status: stage.status,
          version: stage.version
        })),
        decisions: decisions.map((decision) => ({
          seasonEntryId: decision.seasonEntryId,
          finalStageCode: decision.finalStageCode,
          reason: decision.reason
        }))
      } : null
    };
  }

  async confirm(
    actorAdminId: string,
    leagueId: string,
    seasonId: string,
    input: ConfirmSeasonAllocationRequest,
    key: string
  ) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.league-allocation.confirm:${seasonId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`;
        const season = await transaction.leagueSeason.findUnique({
          where: { id: seasonId },
          include: SEASON_INCLUDE
        });
        if (!season || season.leagueId !== leagueId) {
          throw new LeagueAllocationError('SEASON_NOT_IN_LEAGUE', '赛季不属于当前联赛', 404);
        }
        if (season.status !== 'ALLOCATION_REVIEW') {
          throw new LeagueAllocationError(
            'SEASON_NOT_IN_ALLOCATION_REVIEW',
            '赛季已不在分组确认阶段，请刷新后重试',
            409
          );
        }
        if (season.version !== input.expectedSeasonVersion) {
          throw new LeagueAllocationError('VERSION_CONFLICT', '赛季已被其他管理员修改，请刷新后重试', 409);
        }

        const [proposal, latest, league, existingCompetition] = await Promise.all([
          transaction.seasonAllocationProposal.findUnique({
            where: { id: input.proposalId },
            include: { rows: true }
          }),
          transaction.seasonAllocationProposal.findFirst({
            where: { seasonId },
            orderBy: { version: 'desc' },
            select: { id: true, version: true }
          }),
          transaction.league.findUnique({ where: { id: leagueId } }),
          transaction.competition.findFirst({
            where: { seasonId, competitionType: 'DIVISION_LEAGUE' },
            select: { id: true }
          })
        ]);
        if (!proposal || proposal.seasonId !== seasonId || proposal.status !== 'DRAFT') {
          throw new LeagueAllocationError('ALLOCATION_PROPOSAL_INVALID', '分组建议不存在或已失效', 409);
        }
        if (latest?.id !== proposal.id) {
          throw new LeagueAllocationError('ALLOCATION_PROPOSAL_STALE', '这不是最新分组建议，请刷新后重试', 409);
        }
        if (!league) throw new LeagueAllocationError('LEAGUE_NOT_FOUND', '联赛不存在', 404);
        if (existingCompetition) {
          throw new LeagueAllocationError('ALLOCATION_ALREADY_CONFIRMED', '当前赛季已经确认过正式分组', 409);
        }

        const approvedIds = new Set(season.entries.map((entry) => entry.id));
        const proposalIds = new Set(proposal.rows.map((row) => row.seasonEntryId));
        if (proposalIds.size !== proposal.rows.length
          || proposalIds.size !== approvedIds.size
          || [...proposalIds].some((id) => !approvedIds.has(id))) {
          throw new LeagueAllocationError(
            'ALLOCATION_PARTICIPANTS_INVALID',
            '分组建议必须完整且只能包含当前赛季已批准球队',
            409
          );
        }
        const overrideByEntryId = new Map<string, ConfirmSeasonAllocationRequest['overrides'][number]>();
        for (const override of input.overrides) {
          if (overrideByEntryId.has(override.seasonEntryId) || !approvedIds.has(override.seasonEntryId)) {
            throw new LeagueAllocationError('ALLOCATION_OVERRIDE_INVALID', '分组调整包含重复或无效球队', 400);
          }
          const suggested = proposal.rows.find((row) => row.seasonEntryId === override.seasonEntryId)!;
          if (override.targetStageCode !== suggested.suggestedStageCode && !override.reason.trim()) {
            throw new LeagueAllocationError('OVERRIDE_REASON_REQUIRED', '调整球队组别时必须填写原因', 400);
          }
          overrideByEntryId.set(override.seasonEntryId, override);
        }

        const finalRows = proposal.rows.map((row) => {
          const override = overrideByEntryId.get(row.seasonEntryId);
          const finalStageCode = override?.targetStageCode ?? row.suggestedStageCode;
          const overridden = finalStageCode !== row.suggestedStageCode;
          return {
            ...row,
            finalStageCode,
            overridden,
            overrideReason: overridden ? override!.reason.trim() : null
          };
        });
        const stageCounts = new Map<string, number>();
        for (const row of finalRows) {
          stageCounts.set(row.finalStageCode, (stageCounts.get(row.finalStageCode) ?? 0) + 1);
        }
        for (const [stageCode, count] of stageCounts) {
          const capacity = stageCode === 'SUPER' ? season.superCapacity : season.championCapacity;
          if (count > capacity) {
            throw new LeagueAllocationError('ALLOCATION_CAPACITY_EXCEEDED', `${this.stageName(stageCode)}超过容量`, 409);
          }
        }

        const advanced = await transaction.leagueSeason.updateMany({
          where: { id: seasonId, version: input.expectedSeasonVersion, status: 'ALLOCATION_REVIEW' },
          data: { status: 'READY', version: { increment: 1 } }
        });
        if (advanced.count !== 1) {
          throw new LeagueAllocationError('VERSION_CONFLICT', '赛季已被其他管理员修改，请刷新后重试', 409);
        }
        const competition = await transaction.competition.create({
          data: {
            seasonId,
            competitionType: 'DIVISION_LEAGUE',
            name: `${league.name} ${season.displayName} 分级联赛`,
            description: `${season.displayName} 超级组与冠军组正式联赛`,
            platform: league.defaultPlatform,
            serverRegion: league.defaultServerRegion,
            participantType: 'TEAM',
            format: 'ROUND_ROBIN',
            status: 'DRAFT',
            registrationOpensAt: season.registrationOpensAt,
            registrationClosesAt: season.registrationClosesAt,
            startsAt: season.startsAt,
            endsAt: season.endsAt,
            participantLimit: Math.max(2, season.entries.length),
            createdByAdminId: actorAdminId
          }
        });

        const orderedStageCodes = [...stageCounts.keys()].sort((left, right) => {
          if (left === 'SUPER') return -1;
          if (right === 'SUPER') return 1;
          return left.localeCompare(right);
        });
        const stageByCode = new Map<string, { id: string }>();
        for (const [index, stageCode] of orderedStageCodes.entries()) {
          const stage = await transaction.competitionStage.create({
            data: {
              competitionId: competition.id,
              stageCode,
              displayName: this.stageName(stageCode),
              sequence: index + 1,
              capacity: stageCode === 'SUPER' ? season.superCapacity : season.championCapacity,
              format: 'ROUND_ROBIN'
            }
          });
          stageByCode.set(stageCode, stage);
        }

        const entryById = new Map(season.entries.map((entry) => [entry.id, entry]));
        const participantByEntryId = new Map<string, { id: string }>();
        for (const [index, row] of finalRows.entries()) {
          const entry = entryById.get(row.seasonEntryId)!;
          const participant = await transaction.competitionParticipant.create({
            data: {
              competitionId: competition.id,
              participantType: 'TEAM',
              seasonEntryId: entry.id,
              admissionSequence: index + 1,
              displayNameSnapshot: entry.teamNameSnapshot
            }
          });
          participantByEntryId.set(entry.id, participant);
        }
        const seeds = new Map<string, number>();
        await transaction.stageParticipant.createMany({
          data: finalRows.map((row) => {
            const seed = (seeds.get(row.finalStageCode) ?? 0) + 1;
            seeds.set(row.finalStageCode, seed);
            return {
              stageId: stageByCode.get(row.finalStageCode)!.id,
              participantId: participantByEntryId.get(row.seasonEntryId)!.id,
              seed
            };
          })
        });
        await transaction.seasonAllocationDecision.createMany({
          data: finalRows.map((row) => ({
            proposalId: proposal.id,
            seasonEntryId: row.seasonEntryId,
            finalStageCode: row.finalStageCode,
            overridden: row.overridden,
            reason: row.overrideReason,
            decidedByAdminId: actorAdminId
          }))
        });
        await transaction.seasonAllocationProposal.updateMany({
          where: { id: proposal.id, status: 'DRAFT' },
          data: { status: 'CONFIRMED' }
        });
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.league-allocation.confirm',
          resourceType: 'LeagueSeason',
          resourceId: seasonId,
          metadata: {
            proposalId: proposal.id,
            competitionId: competition.id,
            stageCodes: orderedStageCodes,
            participantCount: finalRows.length,
            overrideCount: finalRows.filter((row) => row.overridden).length
          }
        });
        return {
          seasonId,
          competitionId: competition.id,
          stageCount: orderedStageCodes.length,
          participantCount: finalRows.length,
          stages: orderedStageCodes.map((stageCode) => ({
            id: stageByCode.get(stageCode)!.id,
            stageCode,
            displayName: this.stageName(stageCode),
            participantCount: stageCounts.get(stageCode)!
          })),
          status: 'READY',
          version: input.expectedSeasonVersion + 1
        };
      },
      input
    );
  }

  async reopen(
    actorAdminId: string,
    leagueId: string,
    seasonId: string,
    input: SeasonTransitionRequest,
    key: string
  ) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.league-allocation.reopen:${seasonId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`;
        const season = await transaction.leagueSeason.findUnique({ where: { id: seasonId } });
        if (!season || season.leagueId !== leagueId) {
          throw new LeagueAllocationError('SEASON_NOT_IN_LEAGUE', '赛季不属于当前联赛', 404);
        }
        if (season.status !== 'READY') {
          throw new LeagueAllocationError('ALLOCATION_REOPEN_INVALID', '只有待发布赛程的赛季可以重新分组', 409);
        }
        if (season.version !== input.expectedVersion) {
          throw new LeagueAllocationError('VERSION_CONFLICT', '赛季已被其他管理员修改，请刷新后重试', 409);
        }
        const competition = await transaction.competition.findFirst({
          where: { seasonId, competitionType: 'DIVISION_LEAGUE' },
          include: { stages: { select: { id: true, status: true } } }
        });
        if (!competition) {
          throw new LeagueAllocationError('DIVISION_COMPETITION_NOT_FOUND', '未找到当前赛季正式分组', 409);
        }
        if (competition.stages.some((stage) => stage.status === 'PUBLISHED')) {
          throw new LeagueAllocationError('ALLOCATION_REOPEN_FORBIDDEN', '已有分组赛程发布，不能重新分组', 409);
        }
        const stageIds = competition.stages.map((stage) => stage.id);
        await transaction.competitionMatch.deleteMany({ where: { stageId: { in: stageIds } } });
        await transaction.stageParticipant.deleteMany({ where: { stageId: { in: stageIds } } });
        await transaction.competitionParticipant.deleteMany({ where: { competitionId: competition.id } });
        await transaction.competitionStage.deleteMany({ where: { competitionId: competition.id } });
        await transaction.competition.delete({ where: { id: competition.id } });
        await transaction.seasonAllocationProposal.updateMany({
          where: { seasonId, status: 'CONFIRMED' },
          data: { status: 'SUPERSEDED' }
        });
        const reopened = await transaction.leagueSeason.updateMany({
          where: { id: seasonId, version: input.expectedVersion, status: 'READY' },
          data: { status: 'ALLOCATION_REVIEW', version: { increment: 1 } }
        });
        if (reopened.count !== 1) {
          throw new LeagueAllocationError('VERSION_CONFLICT', '赛季已被其他管理员修改，请刷新后重试', 409);
        }
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.league-allocation.reopen',
          resourceType: 'LeagueSeason',
          resourceId: seasonId,
          metadata: { removedCompetitionId: competition.id }
        });
        return { seasonId, status: 'ALLOCATION_REVIEW', version: input.expectedVersion + 1 };
      },
      input
    );
  }

  private async previousStandings(
    transaction: Prisma.TransactionClient,
    previousSeasonId: string | null,
    entries: Array<{ id: string; teamNameSnapshot: string; previousSeasonEntryId: string | null }>
  ): Promise<PreviousSeasonStanding[]> {
    if (!previousSeasonId) throw this.previousStandingsUnavailable();
    const competition = await transaction.competition.findFirst({
      where: {
        seasonId: previousSeasonId,
        competitionType: 'DIVISION_LEAGUE',
        status: 'COMPLETED'
      },
      include: {
        stages: {
          where: { stageCode: { not: null } },
          include: {
            participants: {
              include: {
                participant: { select: { id: true, seasonEntryId: true } }
              }
            },
            standingsSnapshots: {
              orderBy: { version: 'desc' },
              take: 1,
              include: { rows: true }
            }
          }
        }
      }
    });
    if (!competition || competition.stages.length === 0) throw this.previousStandingsUnavailable();

    const currentByPreviousId = new Map(
      entries
        .filter((entry) => entry.previousSeasonEntryId !== null)
        .map((entry) => [entry.previousSeasonEntryId!, entry])
    );
    const result: PreviousSeasonStanding[] = [];
    for (const stage of competition.stages) {
      const snapshot = stage.standingsSnapshots[0];
      if (!stage.stageCode || !snapshot) throw this.previousStandingsUnavailable();
      const rowByParticipant = new Map(snapshot.rows.map((row) => [row.participantId, row]));
      for (const membership of stage.participants) {
        const previousEntryId = membership.participant.seasonEntryId;
        if (!previousEntryId) continue;
        const currentEntry = currentByPreviousId.get(previousEntryId);
        if (!currentEntry) continue;
        const row = rowByParticipant.get(membership.participant.id);
        if (!row) throw this.previousStandingsUnavailable();
        result.push({
          seasonEntryId: currentEntry.id,
          teamName: currentEntry.teamNameSnapshot,
          stageCode: stage.stageCode,
          rank: row.rank,
          played: row.played,
          totalPoints: row.totalPoints,
          goalDifference: row.goalDifference,
          goalsFor: row.goalsFor
        });
      }
    }
    return result;
  }

  private response(proposal: ProposalRecord) {
    return {
      id: proposal.id,
      seasonId: proposal.seasonId,
      version: proposal.version,
      status: proposal.status,
      algorithmVersion: proposal.algorithmVersion,
      randomSeed: proposal.randomSeed,
      rows: proposal.rows.map((row) => ({
        id: row.id,
        proposalId: row.proposalId,
        seasonEntryId: row.seasonEntryId,
        teamName: row.teamName,
        suggestedStageCode: row.suggestedStageCode,
        source: row.source,
        previousRank: row.previousRank,
        pointsPerMatch: row.pointsPerMatch,
        goalDifferencePerMatch: row.goalDifferencePerMatch,
        goalsForPerMatch: row.goalsForPerMatch,
        tiePending: row.tiePending,
        reason: row.reason
      })),
      createdAt: proposal.createdAt.toISOString()
    };
  }

  private previousStandingsUnavailable() {
    return new LeagueAllocationError(
      'PREVIOUS_STANDINGS_UNAVAILABLE',
      '上一赛季最终积分榜尚不可用，无法生成常规赛季分组建议',
      409
    );
  }

  private stageName(stageCode: string): string {
    if (stageCode === 'SUPER') return '超级组';
    if (stageCode.startsWith('CHAMPION_')) return `冠军 ${stageCode.slice('CHAMPION_'.length)} 组`;
    return stageCode;
  }
}

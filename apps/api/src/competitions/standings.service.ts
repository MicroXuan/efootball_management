import { Inject, Injectable } from '@nestjs/common';
import type {
  CompetitionTieBreaker,
  DivisionStandingsResponse,
  StandingsSnapshotResponse
} from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CompetitionTransaction } from './competition.types.js';
import { CompetitionError } from './competition.errors.js';
import { calculateStandings } from './domain/standings.js';

const STAGE_INCLUDE = {
  participants: {
    include: { participant: true },
    orderBy: [{ seed: 'asc' as const }, { id: 'asc' as const }]
  },
  standingsSnapshots: {
    orderBy: { version: 'desc' as const },
    take: 1,
    include: {
      rows: {
        include: { participant: true },
        orderBy: [{ rank: 'asc' as const }, { participantId: 'asc' as const }]
      }
    }
  }
} satisfies Prisma.CompetitionStageInclude;
type StageRecord = Prisma.CompetitionStageGetPayload<{ include: typeof STAGE_INCLUDE }>;

@Injectable()
export class StandingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recalculate(
    transaction: CompetitionTransaction,
    competitionId: string,
    triggerResultVersionId: string,
    stageId?: string
  ): Promise<StandingsSnapshotResponse> {
    const competition = await transaction.competition.findUniqueOrThrow({ where: { id: competitionId } });
    const ruleVersion = competition.boundRuleVersion || competition.activeRuleVersion;
    const storedRules = await transaction.competitionRuleVersion.findUnique({
      where: { competitionId_version: { competitionId, version: ruleVersion } }
    });
    if (!storedRules && competition.competitionType !== 'DIVISION_LEAGUE') {
      throw new CompetitionError('COMPETITION_RULES_NOT_FOUND', '未找到赛事积分规则', 409);
    }
    const rules = storedRules ?? {
      winPoints: 3,
      drawPoints: 1,
      lossPoints: 0,
      tieBreakers: ['TOTAL_POINTS', 'TOTAL_GOAL_DIFFERENCE', 'TOTAL_GOALS']
    };
    const participants = stageId
      ? (await transaction.stageParticipant.findMany({
        where: { stageId }, include: { participant: true }, orderBy: [{ seed: 'asc' }, { id: 'asc' }]
      })).map((membership) => membership.participant)
      : await transaction.competitionParticipant.findMany({
        where: { competitionId }, orderBy: [{ admissionSequence: 'asc' }, { id: 'asc' }]
      });
    const officialMatches = await transaction.competitionMatch.findMany({
      where: stageId
        ? { stageId, stage: { status: 'PUBLISHED' }, officialResultVersionId: { not: null } }
        : { stage: { competitionId, status: 'PUBLISHED' }, officialResultVersionId: { not: null } },
      include: { officialResultVersion: true }
    });
    const rows = calculateStandings(
      participants.map((participant) => ({
        id: participant.id,
        admissionSequence: participant.admissionSequence,
        displayName: participant.displayNameSnapshot
      })),
      officialMatches.flatMap((match) => match.officialResultVersion ? [{
        homeParticipantId: match.homeParticipantId,
        awayParticipantId: match.awayParticipantId,
        homeScore: match.officialResultVersion.homeScore,
        awayScore: match.officialResultVersion.awayScore
      }] : []),
      {
        winPoints: rules.winPoints,
        drawPoints: rules.drawPoints,
        lossPoints: rules.lossPoints,
        tieBreakers: rules.tieBreakers as CompetitionTieBreaker[]
      }
    );
    const latest = await transaction.standingsSnapshot.aggregate({
      where: { competitionId, stageId: stageId ?? null }, _max: { version: true }
    });
    const snapshot = await transaction.standingsSnapshot.create({
      data: {
        competitionId,
        stageId: stageId ?? null,
        version: (latest._max.version ?? 0) + 1,
        triggeringResultVersionId: triggerResultVersionId,
        ruleVersion
      }
    });
    if (rows.length > 0) {
      await transaction.standingsRow.createMany({
        data: rows.map((row) => ({
          snapshotId: snapshot.id,
          participantId: row.participantId,
          played: row.played,
          wins: row.wins,
          draws: row.draws,
          losses: row.losses,
          goalsFor: row.goalsFor,
          goalsAgainst: row.goalsAgainst,
          goalDifference: row.goalDifference,
          basePoints: row.basePoints,
          adjustmentPoints: row.adjustmentPoints,
          totalPoints: row.totalPoints,
          rank: row.rank,
          tiePending: row.tiePending,
          tieBreakValues: row.tieBreakValues
        }))
      });
    }
    return {
      competitionId,
      stageId: stageId ?? null,
      version: snapshot.version,
      ruleVersion,
      triggeringResultVersionId: triggerResultVersionId,
      generatedAt: snapshot.generatedAt.toISOString(),
      rows
    };
  }

  async getLatestPublic(competitionId: string): Promise<StandingsSnapshotResponse> {
    const snapshot = await this.prisma.standingsSnapshot.findFirst({
      where: { competitionId, stageId: null },
      include: { rows: { include: { participant: true }, orderBy: [{ rank: 'asc' }, { participantId: 'asc' }] } },
      orderBy: { version: 'desc' }
    });
    if (!snapshot) {
      const competition = await this.prisma.competition.findUnique({
        where: { id: competitionId }, select: { boundRuleVersion: true, activeRuleVersion: true }
      });
      return {
        competitionId,
        version: 0,
        ruleVersion: competition?.boundRuleVersion || competition?.activeRuleVersion || 1,
        triggeringResultVersionId: null,
        generatedAt: null,
        rows: []
      };
    }
    return {
      competitionId,
      version: snapshot.version,
      ruleVersion: snapshot.ruleVersion,
      triggeringResultVersionId: snapshot.triggeringResultVersionId,
      generatedAt: snapshot.generatedAt.toISOString(),
      rows: snapshot.rows.map((row) => this.rowResponse(row))
    };
  }

  async getDivisionStandings(userId: string, leagueId: string, seasonId: string): Promise<DivisionStandingsResponse> {
    const entry = await this.prisma.seasonEntry.findFirst({
      where: { seasonId, ownerUserId: userId, status: 'APPROVED', season: { leagueId } },
      select: { id: true }
    });
    if (!entry) {
      throw new CompetitionError('DIVISION_STANDINGS_FORBIDDEN', '只有当前赛季正式参赛球队可以查看分组积分榜', 403);
    }
    const competition = await this.prisma.competition.findFirst({
      where: { seasonId, competitionType: 'DIVISION_LEAGUE', season: { leagueId } },
      include: {
        stages: {
          where: { stageCode: { not: null } },
          include: STAGE_INCLUDE,
          orderBy: [{ sequence: 'asc' }, { id: 'asc' }]
        }
      }
    });
    if (!competition) {
      throw new CompetitionError('DIVISION_COMPETITION_NOT_FOUND', '当前赛季尚未确认正式分组', 404);
    }
    const myStage = competition.stages.find((stage) => stage.participants.some(
      (membership) => membership.participant.seasonEntryId === entry.id
    ));
    return {
      seasonId,
      competitionId: competition.id,
      myStageId: myStage?.id ?? null,
      groups: competition.stages.map((stage) => ({
        stage: {
          id: stage.id,
          competitionId: competition.id,
          stageCode: stage.stageCode!,
          displayName: stage.displayName!,
          sequence: stage.sequence,
          capacity: stage.capacity!,
          format: stage.format,
          status: stage.status,
          participantCount: stage.participants.length,
          version: stage.version
        },
        standings: this.stageSnapshot(competition.id, stage)
      }))
    };
  }

  private stageSnapshot(competitionId: string, stage: StageRecord): StandingsSnapshotResponse {
    const snapshot = stage.standingsSnapshots[0];
    if (!snapshot) {
      return {
        competitionId,
        stageId: stage.id,
        version: 0,
        ruleVersion: 1,
        triggeringResultVersionId: null,
        generatedAt: null,
        rows: stage.participants.map((membership, index) => ({
          participantId: membership.participant.id,
          displayName: membership.participant.displayNameSnapshot,
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          basePoints: 0,
          adjustmentPoints: 0,
          totalPoints: 0,
          rank: index + 1,
          tiePending: false,
          tieBreakValues: {}
        }))
      };
    }
    return {
      competitionId,
      stageId: stage.id,
      version: snapshot.version,
      ruleVersion: snapshot.ruleVersion,
      triggeringResultVersionId: snapshot.triggeringResultVersionId,
      generatedAt: snapshot.generatedAt.toISOString(),
      rows: snapshot.rows.map((row) => this.rowResponse(row))
    };
  }

  private rowResponse(row: {
    participantId: string;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    basePoints: number;
    adjustmentPoints: number;
    totalPoints: number;
    rank: number;
    tiePending: boolean;
    tieBreakValues: unknown;
    participant: { displayNameSnapshot: string };
  }) {
    return {
      participantId: row.participantId,
      displayName: row.participant.displayNameSnapshot,
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      goalDifference: row.goalDifference,
      basePoints: row.basePoints,
      adjustmentPoints: row.adjustmentPoints,
      totalPoints: row.totalPoints,
      rank: row.rank,
      tiePending: row.tiePending,
      tieBreakValues: row.tieBreakValues as Record<string, number>
    };
  }
}

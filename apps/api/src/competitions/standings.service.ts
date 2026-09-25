import { Inject, Injectable } from '@nestjs/common';
import type { CompetitionTieBreaker, StandingsSnapshotResponse } from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CompetitionTransaction } from './competition.types.js';
import { calculateStandings } from './domain/standings.js';

@Injectable()
export class StandingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recalculate(
    transaction: CompetitionTransaction,
    competitionId: string,
    triggerResultVersionId: string
  ): Promise<StandingsSnapshotResponse> {
    const competition = await transaction.competition.findUniqueOrThrow({ where: { id: competitionId } });
    const ruleVersion = competition.boundRuleVersion || competition.activeRuleVersion;
    const rules = await transaction.competitionRuleVersion.findUniqueOrThrow({
      where: { competitionId_version: { competitionId, version: ruleVersion } }
    });
    const participants = await transaction.competitionParticipant.findMany({
      where: { competitionId }, orderBy: [{ admissionSequence: 'asc' }, { id: 'asc' }]
    });
    const officialMatches = await transaction.competitionMatch.findMany({
      where: { stage: { competitionId, status: 'PUBLISHED' }, officialResultVersionId: { not: null } },
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
      where: { competitionId }, _max: { version: true }
    });
    const snapshot = await transaction.standingsSnapshot.create({
      data: {
        competitionId,
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
      version: snapshot.version,
      ruleVersion,
      triggeringResultVersionId: triggerResultVersionId,
      generatedAt: snapshot.generatedAt.toISOString(),
      rows
    };
  }

  async getLatestPublic(competitionId: string): Promise<StandingsSnapshotResponse> {
    const snapshot = await this.prisma.standingsSnapshot.findFirst({
      where: { competitionId },
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
      rows: snapshot.rows.map((row) => ({
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
      }))
    };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import type {
  CompetitionMatchResponse,
  CompetitionRegistrationResponse,
  CompetitionSummary,
  CupRegistrationResponse,
  MatchResultVersionResponse,
  MyCompetitionListQuery,
  MyCompetitionListResponse,
  MyMatchListQuery,
  MyMatchListResponse
} from '@efm/contracts';
import type { Competition, CompetitionRegistration, MatchResultVersion, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

type MatchRecord = Prisma.CompetitionMatchGetPayload<{
  include: {
    stage: { include: { competition: { include: { _count: { select: { participants: true } } } } } };
    homeParticipant: { include: { seasonEntry: { select: { ownerUserId: true } } } };
    awayParticipant: { include: { seasonEntry: { select: { ownerUserId: true } } } };
    officialResultVersion: true;
    resultVersions: true;
  };
}>;

type MyMatchAction = 'SUBMIT' | 'CONFIRM' | 'WAIT' | 'DONE';

@Injectable()
export class MyCompetitionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listCompetitions(userId: string, query: MyCompetitionListQuery): Promise<MyCompetitionListResponse> {
    const registrations = await this.prisma.competitionRegistration.findMany({
      where: {
        applicantId: userId,
        competition: { OR: [{ seasonId: null }, { season: { league: { isDeleted: false } } }] },
        OR: [
          { seasonEntryId: null },
          { seasonEntry: { leagueTeam: { status: 'ACTIVE' } } }
        ]
      },
      include: {
        competition: { include: { _count: { select: { participants: true } } } },
        seasonEntry: { select: { teamNameSnapshot: true } }
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }]
    });
    const { items, nextCursor } = this.page(registrations, query.cursor, query.limit);
    return {
      items: await Promise.all(items.map(async (registration) => {
        const participant = await this.prisma.competitionParticipant.findUnique({
          where: { registrationId: registration.id }
        });
        const matches = participant ? await this.matchesForParticipant(participant.id) : [];
        const next = matches.find((match) => !this.done(match));
        return {
          competition: this.summary(registration.competition, registration.competition._count.participants),
          registration: this.registration(registration),
          nextMatch: next ? this.match(next, userId, null) : null
        };
      })),
      nextCursor
    };
  }

  async listMatches(userId: string, query: MyMatchListQuery): Promise<MyMatchListResponse> {
    const records = await this.prisma.competitionMatch.findMany({
      where: {
        stage: {
          status: 'PUBLISHED',
          competition: {
            status: { not: 'CANCELLED' },
            OR: [{ seasonId: null }, { season: { league: { isDeleted: false } } }]
          }
        },
        OR: [
          { homeParticipant: { individualUserId: userId } },
          { awayParticipant: { individualUserId: userId } },
          { homeParticipant: { seasonEntry: { ownerUserId: userId, leagueTeam: { status: 'ACTIVE' } } } },
          { awayParticipant: { seasonEntry: { ownerUserId: userId, leagueTeam: { status: 'ACTIVE' } } } }
        ]
      },
      include: {
        stage: { include: { competition: { include: { _count: { select: { participants: true } } } } } },
        homeParticipant: { include: { seasonEntry: { select: { ownerUserId: true } } } },
        awayParticipant: { include: { seasonEntry: { select: { ownerUserId: true } } } },
        officialResultVersion: true,
        resultVersions: { where: { status: 'PROPOSED' }, orderBy: { version: 'desc' } }
      }
    });
    records.sort((left, right) => this.compareMatches(left, right));
    const { items, nextCursor } = this.page(records, query.cursor, query.limit);
    return {
      items: items.map((record) => {
        const myParticipantId = record.homeParticipant.individualUserId === userId
          || record.homeParticipant.seasonEntry?.ownerUserId === userId
          ? record.homeParticipantId
          : record.awayParticipantId;
        const opponentProposal = record.resultVersions.find(({ submittedById }) => submittedById !== userId) ?? null;
        const ownProposal = record.resultVersions.find(({ submittedById }) => submittedById === userId) ?? null;
        const action: MyMatchAction = this.done(record)
          ? 'DONE'
          : record.stage.competition.status !== 'IN_PROGRESS'
            ? 'WAIT'
            : opponentProposal
            ? 'CONFIRM'
            : ownProposal
              ? 'WAIT'
              : 'SUBMIT';
        const actionable = action === 'CONFIRM' ? this.result(opponentProposal!, userId) : null;
        return {
          match: this.match(record, userId, actionable),
          competition: this.summary(record.stage.competition, record.stage.competition._count.participants),
          myParticipantId,
          action,
          actionableResultVersion: actionable
        };
      }),
      nextCursor
    };
  }

  private async matchesForParticipant(participantId: string): Promise<MatchRecord[]> {
    const records = await this.prisma.competitionMatch.findMany({
      where: {
        stage: {
          status: 'PUBLISHED',
          competition: { OR: [{ seasonId: null }, { season: { league: { isDeleted: false } } }] }
        },
        OR: [{ homeParticipantId: participantId }, { awayParticipantId: participantId }]
      },
      include: {
        stage: { include: { competition: { include: { _count: { select: { participants: true } } } } } },
        homeParticipant: { include: { seasonEntry: { select: { ownerUserId: true } } } },
        awayParticipant: { include: { seasonEntry: { select: { ownerUserId: true } } } },
        officialResultVersion: true,
        resultVersions: { where: { status: 'PROPOSED' }, orderBy: { version: 'desc' } }
      }
    });
    return records.sort((left, right) => this.compareMatches(left, right));
  }

  private compareMatches(left: MatchRecord, right: MatchRecord): number {
    const leftDone = this.done(left) ? 1 : 0;
    const rightDone = this.done(right) ? 1 : 0;
    if (leftDone !== rightDone) return leftDone - rightDone;
    const leftUnplanned = left.plannedAt ? 0 : 1;
    const rightUnplanned = right.plannedAt ? 0 : 1;
    if (leftUnplanned !== rightUnplanned) return leftUnplanned - rightUnplanned;
    const time = (left.plannedAt?.getTime() ?? 0) - (right.plannedAt?.getTime() ?? 0);
    return time || left.matchNumber - right.matchNumber || left.id.localeCompare(right.id);
  }

  private done(match: MatchRecord): boolean {
    return Boolean(match.officialResultVersionId) || ['CONFIRMED', 'ADMIN_DECIDED'].includes(match.status);
  }

  private match(record: MatchRecord, userId: string, actionable: MatchResultVersionResponse | null): CompetitionMatchResponse {
    return {
      id: record.id,
      competitionId: record.stage.competitionId,
      stageId: record.stageId,
      roundNumber: record.roundNumber,
      matchNumber: record.matchNumber,
      homeParticipant: {
        id: record.homeParticipant.id,
        displayName: record.homeParticipant.displayNameSnapshot,
        participantType: record.homeParticipant.participantType,
        teamLifecycleStatus: null
      },
      awayParticipant: {
        id: record.awayParticipant.id,
        displayName: record.awayParticipant.displayNameSnapshot,
        participantType: record.awayParticipant.participantType,
        teamLifecycleStatus: null
      },
      plannedAt: record.plannedAt?.toISOString() ?? null,
      status: record.status,
      version: record.version,
      officialResult: record.officialResultVersion ? {
        resultVersionId: record.officialResultVersion.id,
        version: record.officialResultVersion.version,
        homeScore: record.officialResultVersion.homeScore,
        awayScore: record.officialResultVersion.awayScore,
        status: record.officialResultVersion.status === 'SUPERSEDED' ? 'SUPERSEDED' : 'OFFICIAL'
      } : null,
      resultVersions: actionable ? [actionable] : [],
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    };
  }

  private result(result: MatchResultVersion, userId: string): MatchResultVersionResponse {
    return {
      id: result.id,
      matchId: result.matchId,
      version: result.version,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      status: result.status,
      submissionSide: result.submissionSide,
      submittedByMe: result.submittedById === userId,
      reason: result.reason,
      createdAt: result.createdAt.toISOString()
    };
  }

  private registration(
    value: CompetitionRegistration & { seasonEntry?: { teamNameSnapshot: string } | null }
  ): CompetitionRegistrationResponse | CupRegistrationResponse {
    if (value.seasonEntryId) {
      if (!value.seasonEntry) throw new Error('Cup registration has no season entry');
      return {
        id: value.id,
        competitionId: value.competitionId,
        seasonEntryId: value.seasonEntryId,
        applicantId: value.applicantId,
        teamName: value.seasonEntry.teamNameSnapshot,
        status: value.status,
        withdrawnAt: value.withdrawnAt?.toISOString() ?? null,
        version: value.version,
        createdAt: value.createdAt.toISOString(),
        updatedAt: value.updatedAt.toISOString()
      };
    }
    if (!value.gameAccountId) throw new Error('Individual competition registration has no game account');
    return {
      id: value.id,
      competitionId: value.competitionId,
      applicantId: value.applicantId,
      gameAccountId: value.gameAccountId,
      acceptedRuleVersion: value.acceptedRuleVersion,
      status: value.status,
      reviewReason: value.reviewReason,
      reviewedAt: value.reviewedAt?.toISOString() ?? null,
      withdrawnAt: value.withdrawnAt?.toISOString() ?? null,
      version: value.version,
      createdAt: value.createdAt.toISOString(),
      updatedAt: value.updatedAt.toISOString()
    };
  }

  private summary(value: Competition, participantCount: number): CompetitionSummary {
    return {
      id: value.id,
      seasonId: value.seasonId,
      competitionType: value.competitionType,
      name: value.name,
      description: value.description,
      platform: value.platform,
      serverRegion: value.serverRegion,
      participantType: value.participantType,
      format: value.format,
      status: value.status,
      registrationOpensAt: value.registrationOpensAt.toISOString(),
      registrationClosesAt: value.registrationClosesAt.toISOString(),
      startsAt: value.startsAt.toISOString(),
      endsAt: value.endsAt.toISOString(),
      participantLimit: value.participantLimit,
      participantCount,
      version: value.version,
      activeRuleVersion: value.activeRuleVersion,
      createdAt: value.createdAt.toISOString(),
      updatedAt: value.updatedAt.toISOString()
    };
  }

  private page<T>(items: T[], cursor: string | undefined, limit: number) {
    const offset = cursor ? this.decodeCursor(cursor) : 0;
    const page = items.slice(offset, offset + limit);
    return {
      items: page,
      nextCursor: offset + limit < items.length ? this.encodeCursor(offset + limit) : null
    };
  }

  private encodeCursor(offset: number): string {
    return Buffer.from(JSON.stringify({ offset })).toString('base64url');
  }

  private decodeCursor(cursor: string): number {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown };
      if (!Number.isInteger(parsed.offset) || (parsed.offset as number) < 0) throw new Error('invalid');
      return parsed.offset as number;
    } catch {
      return 0;
    }
  }
}

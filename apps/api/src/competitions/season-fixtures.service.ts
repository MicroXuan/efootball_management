import { Inject, Injectable } from '@nestjs/common';
import type {
  CompetitionMatchResponse,
  CompetitionParticipantSummary,
  CompetitionSummary,
  SeasonFixtureListQuery,
  SeasonFixtureListResponse
} from '@efm/contracts';
import type { Competition, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError } from './competition.errors.js';

const FIXTURE_INCLUDE = {
  stage: { include: { competition: { include: { _count: { select: { participants: true } } } } } },
  homeParticipant: { include: { seasonEntry: { select: {
    leagueTeamId: true, teamNameSnapshot: true, teamShortNameSnapshot: true, teamNumberSnapshot: true, teamLogoUrlSnapshot: true,
    leagueTeam: { select: { status: true, ownerAlias: true, teamNumber: true, name: true, shortName: true, logoUrl: true } }
  } } } },
  awayParticipant: { include: { seasonEntry: { select: {
    leagueTeamId: true, teamNameSnapshot: true, teamShortNameSnapshot: true, teamNumberSnapshot: true, teamLogoUrlSnapshot: true,
    leagueTeam: { select: { status: true, ownerAlias: true, teamNumber: true, name: true, shortName: true, logoUrl: true } }
  } } } },
  officialResultVersion: true
} satisfies Prisma.CompetitionMatchInclude;

type FixtureRecord = Prisma.CompetitionMatchGetPayload<{ include: typeof FIXTURE_INCLUDE }>;
type FixtureParticipant = FixtureRecord['homeParticipant'];
type Cursor = {
  v: 2;
  status: SeasonFixtureListQuery['status'];
  team: string;
  scope: 'ALL' | 'MINE';
  leagueTeamId: string | null;
  phase: 0 | 1;
  roundNumber: number;
  matchNumber: number;
  id: string;
};

@Injectable()
export class SeasonFixturesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string, leagueId: string, seasonId: string, query: SeasonFixtureListQuery): Promise<SeasonFixtureListResponse> {
    const scope = query.scope ?? 'ALL';
    const leagueTeamId = scope === 'MINE' ? query.leagueTeamId ?? null : null;
    if (scope === 'MINE' && !leagueTeamId) {
      throw new CompetitionError('SEASON_FIXTURE_TEAM_REQUIRED', 'Select one owned team for my fixtures', 400);
    }
    const entry = await this.prisma.seasonEntry.findFirst({
      where: {
        ownerUserId: userId,
        ...(leagueTeamId ? { leagueTeamId } : {}),
        seasonId,
        status: 'APPROVED',
        leagueTeam: { leagueId, status: 'ACTIVE' },
        season: { leagueId, league: { isDeleted: false } }
      },
      select: { id: true }
    });
    if (!entry) throw new CompetitionError('SEASON_FIXTURE_ACCESS_DENIED', 'An active approved season entry is required', 403);

    const records = await this.prisma.competitionMatch.findMany({
      where: {
        stage: {
          status: 'PUBLISHED',
          competition: { seasonId, season: { leagueId, league: { isDeleted: false } } }
        }
      },
      include: FIXTURE_INCLUDE
    });
    const team = this.normalize(query.team ?? '');
    const cursor = query.cursor ? this.decodeCursor(query.cursor, query.status, team, scope, leagueTeamId) : null;
    const filtered = records
      .filter((record) => !leagueTeamId || record.homeParticipant.seasonEntry?.leagueTeamId === leagueTeamId
        || record.awayParticipant.seasonEntry?.leagueTeamId === leagueTeamId)
      .filter((record) => query.status === 'ALL'
        || (query.status === 'FINISHED') === Boolean(record.officialResultVersionId))
      .filter((record) => !team || this.matchesTeam(record.homeParticipant, team) || this.matchesTeam(record.awayParticipant, team))
      .sort((left, right) => this.compare(left, right))
      .filter((record) => !cursor || this.compareKey(this.key(record), cursor) > 0);
    const page = filtered.slice(0, query.limit + 1);
    const hasMore = page.length > query.limit;
    const selected = page.slice(0, query.limit);
    return {
      items: selected.map((record) => ({
        competition: this.competition(record.stage.competition, record.stage.competition._count.participants),
        match: this.match(record)
      })),
      nextCursor: hasMore && selected.length
        ? this.encodeCursor({ ...this.key(selected[selected.length - 1]!), v: 2, status: query.status, team, scope, leagueTeamId })
        : null
    };
  }

  private normalize(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
  }

  private matchesTeam(participant: FixtureParticipant, keyword: string): boolean {
    const entry = participant.seasonEntry;
    const current = entry?.leagueTeam;
    const numbers = [entry?.teamNumberSnapshot, current?.teamNumber]
      .flatMap((value) => value === null || value === undefined ? [] : [String(value), String(value).padStart(2, '0')]);
    return [participant.displayNameSnapshot, entry?.teamNameSnapshot, entry?.teamShortNameSnapshot,
      current?.name, current?.shortName, ...numbers]
      .some((value) => typeof value === 'string' && this.normalize(value).includes(keyword));
  }

  private key(record: FixtureRecord): Pick<Cursor, 'phase' | 'roundNumber' | 'matchNumber' | 'id'> {
    return {
      phase: record.officialResultVersionId ? 1 : 0,
      roundNumber: record.roundNumber,
      matchNumber: record.matchNumber,
      id: record.id
    };
  }

  private compare(left: FixtureRecord, right: FixtureRecord): number {
    return this.compareKey(this.key(left), this.key(right));
  }

  private compareKey(left: Pick<Cursor, 'phase' | 'roundNumber' | 'matchNumber' | 'id'>,
    right: Pick<Cursor, 'phase' | 'roundNumber' | 'matchNumber' | 'id'>): number {
    return left.phase - right.phase || left.roundNumber - right.roundNumber
      || left.matchNumber - right.matchNumber || left.id.localeCompare(right.id);
  }

  private encodeCursor(cursor: Cursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
  }

  private decodeCursor(value: string, status: SeasonFixtureListQuery['status'], team: string, scope: 'ALL' | 'MINE', leagueTeamId: string | null): Cursor {
    try {
      const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
      if (cursor.v !== 2 || cursor.status !== status || cursor.team !== team || cursor.scope !== scope || cursor.leagueTeamId !== leagueTeamId
        || (cursor.phase !== 0 && cursor.phase !== 1)
        || !Number.isInteger(cursor.roundNumber) || Number(cursor.roundNumber) < 1
        || !Number.isInteger(cursor.matchNumber) || Number(cursor.matchNumber) < 1
        || typeof cursor.id !== 'string' || !cursor.id) throw new Error('invalid');
      return cursor as Cursor;
    } catch {
      throw new CompetitionError('INVALID_FIXTURE_CURSOR', 'Fixture cursor is invalid or stale', 400);
    }
  }

  private participant(value: FixtureParticipant): CompetitionParticipantSummary {
    const entry = value.seasonEntry;
    const current = entry?.leagueTeam;
    const status = current?.status === 'ACTIVE' || current?.status === 'ARCHIVED' ? current.status : null;
    return {
      id: value.id,
      displayName: value.displayNameSnapshot,
      participantType: value.participantType,
      teamLifecycleStatus: status,
      teamNumber: entry?.teamNumberSnapshot ?? current?.teamNumber ?? null,
      teamName: entry?.teamNameSnapshot ?? current?.name ?? null,
      teamLogoUrl: entry?.teamLogoUrlSnapshot ?? current?.logoUrl ?? null,
      ownerDisplayName: current?.ownerAlias ?? null
    };
  }

  private match(record: FixtureRecord): CompetitionMatchResponse {
    return {
      id: record.id,
      competitionId: record.stage.competitionId,
      stageId: record.stageId,
      stageCode: record.stage.stageCode,
      stageDisplayName: record.stage.displayName,
      roundNumber: record.roundNumber,
      matchNumber: record.matchNumber,
      homeParticipant: this.participant(record.homeParticipant),
      awayParticipant: this.participant(record.awayParticipant),
      plannedAt: record.plannedAt?.toISOString() ?? null,
      status: record.status,
      resultConfirmationDeadlineAt: record.resultConfirmationDeadlineAt?.toISOString() ?? null,
      version: record.version,
      officialResult: record.officialResultVersion ? {
        resultVersionId: record.officialResultVersion.id,
        version: record.officialResultVersion.version,
        homeScore: record.officialResultVersion.homeScore,
        awayScore: record.officialResultVersion.awayScore,
        status: record.officialResultVersion.status === 'SUPERSEDED' ? 'SUPERSEDED' : 'OFFICIAL'
      } : null,
      resultVersions: [],
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    };
  }

  private competition(value: Competition, participantCount: number): CompetitionSummary {
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
}

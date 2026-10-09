import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  CompetitionMatchResponse,
  GenerateStageScheduleRequest,
  PublishStageScheduleRequest
} from '@efm/contracts';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import type { CompetitionStage, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError, assertExpectedVersion } from './competition.errors.js';
import type { CompetitionTransaction } from './competition.types.js';
import type { generateRoundRobin } from './domain/round-robin.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

export type PublishScheduleInput = {
  expectedCompetitionVersion: number;
  expectedStageVersion: number;
};

export type ScheduleGenerator = typeof generateRoundRobin;
export const SCHEDULE_GENERATOR = Symbol('SCHEDULE_GENERATOR');

type MatchRecord = Prisma.CompetitionMatchGetPayload<{
  include: {
    homeParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } };
    awayParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } };
    officialResultVersion: true;
  };
}>;

export type ScheduleMatch = CompetitionMatchResponse & { pairingKey: string };

export type SchedulePreview = {
  id: string;
  competitionId: string;
  status: CompetitionStage['status'];
  version: number;
  roundCount: number;
  matchCount: number;
  matches: ScheduleMatch[];
};

@Injectable()
export class SchedulesService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService,
    @Inject(SCHEDULE_GENERATOR) private readonly generator: ScheduleGenerator,
    @Optional() @Inject(AdminMutationReceiptService) private readonly adminReceipts?: AdminMutationReceiptService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async generateStage(
    actorAdminId: string,
    leagueId: string,
    stageId: string,
    input: GenerateStageScheduleRequest,
    key: string
  ): Promise<SchedulePreview> {
    const stageLeagueId = await this.visibility.requireVisible({ type: 'STAGE', id: stageId });
    if (stageLeagueId !== leagueId) throw this.visibility.notFound();
    const receipts = this.requireAdminReceipts();
    return receipts.execute(actorAdminId, `competition-stage.schedule.generate:${stageId}`, key, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM competition_stages WHERE id = ${stageId} FOR UPDATE`;
      const stage = await transaction.competitionStage.findUnique({
        where: { id: stageId },
        include: {
          competition: { include: { season: true } },
          participants: {
            orderBy: [{ seed: 'asc' }, { id: 'asc' }],
            include: { participant: true }
          }
        }
      });
      this.assertManagedStage(stage, leagueId);
      if (stage.status !== 'DRAFT') {
        throw new CompetitionError('SCHEDULE_ALREADY_PUBLISHED', '赛程已发布，不能重新生成', 409);
      }
      assertExpectedVersion(stage.version, input.expectedStageVersion, 'Stage');
      const participantIds = stage.participants.map((membership) => membership.participant.id);
      const pairings = this.generator(participantIds);
      await transaction.competitionMatch.deleteMany({ where: { stageId } });
      if (pairings.length > 0) {
        await transaction.competitionMatch.createMany({
          data: pairings.map((pairing) => ({ stageId, ...pairing }))
        });
      }
      const updated = await transaction.competitionStage.updateMany({
        where: { id: stageId, status: 'DRAFT', version: input.expectedStageVersion },
        data: { version: { increment: 1 } }
      });
      if (updated.count !== 1) {
        throw new CompetitionError('VERSION_CONFLICT', '组别已被其他管理员修改，请刷新后重试', 409);
      }
      const preview = await this.readStagePreview(transaction, stageId);
      return { ...preview, version: input.expectedStageVersion + 1 };
    }, input);
  }

  async publishStage(
    actorAdminId: string,
    leagueId: string,
    stageId: string,
    input: PublishStageScheduleRequest,
    key: string
  ): Promise<SchedulePreview> {
    const stageLeagueId = await this.visibility.requireVisible({ type: 'STAGE', id: stageId });
    if (stageLeagueId !== leagueId) throw this.visibility.notFound();
    const receipts = this.requireAdminReceipts();
    return receipts.execute(actorAdminId, `competition-stage.schedule.publish:${stageId}`, key, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM competition_stages WHERE id = ${stageId} FOR UPDATE`;
      const stage = await transaction.competitionStage.findUnique({
        where: { id: stageId },
        include: { competition: { include: { season: true } } }
      });
      this.assertManagedStage(stage, leagueId);
      if (stage.status !== 'DRAFT') {
        throw new CompetitionError('SCHEDULE_ALREADY_PUBLISHED', '赛程已经发布', 409);
      }
      assertExpectedVersion(stage.version, input.expectedStageVersion, 'Stage');
      const season = stage.competition.season!;
      if (season.version !== input.expectedSeasonVersion) {
        throw new CompetitionError('VERSION_CONFLICT', '赛季已被其他管理员修改，请刷新后重试', 409);
      }
      if (season.status !== 'READY' && season.status !== 'IN_PROGRESS') {
        throw new CompetitionError('SCHEDULE_PUBLISH_NOT_ALLOWED', '当前赛季状态不能发布赛程', 409);
      }
      if (season.status === 'READY') {
        const sibling = await transaction.leagueSeason.findFirst({
          where: { leagueId, status: 'IN_PROGRESS', id: { not: season.id } },
          select: { id: true }
        });
        if (sibling) {
          throw new CompetitionError('LEAGUE_SEASON_ALREADY_IN_PROGRESS', '该联赛已有进行中的赛季', 409);
        }
      }
      const stageUpdate = await transaction.competitionStage.updateMany({
        where: { id: stageId, status: 'DRAFT', version: input.expectedStageVersion },
        data: { status: 'PUBLISHED', publishedAt: new Date(), version: { increment: 1 } }
      });
      if (stageUpdate.count !== 1) {
        throw new CompetitionError('VERSION_CONFLICT', '组别已被其他管理员修改，请刷新后重试', 409);
      }
      await transaction.competition.updateMany({
        where: { id: stage.competitionId },
        data: { status: 'IN_PROGRESS', version: { increment: 1 } }
      });
      if (season.status === 'READY') {
        const seasonUpdate = await transaction.leagueSeason.updateMany({
          where: { id: season.id, status: 'READY', version: input.expectedSeasonVersion },
          data: { status: 'IN_PROGRESS', version: { increment: 1 } }
        });
        if (seasonUpdate.count !== 1) {
          throw new CompetitionError('VERSION_CONFLICT', '赛季已被其他管理员修改，请刷新后重试', 409);
        }
      }
      if (this.audit) {
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.competition-stage.schedule.publish',
          resourceType: 'CompetitionStage',
          resourceId: stageId,
          metadata: { competitionId: stage.competitionId, seasonId: season.id }
        });
      }
      const preview = await this.readStagePreview(transaction, stageId);
      return { ...preview, status: 'PUBLISHED', version: input.expectedStageVersion + 1 };
    }, input);
  }

  async previewStage(stageId: string): Promise<SchedulePreview> {
    await this.visibility.requireVisible({ type: 'STAGE', id: stageId });
    return this.readStagePreview(this.prisma, stageId);
  }

  async generate(actorId: string, competitionId: string, key: string): Promise<SchedulePreview> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    return this.receipts.execute(actorId, `competition.schedule.generate:${competitionId}`, key, async (transaction) => {
      await this.lockCompetition(transaction, competitionId);
      const competition = await transaction.competition.findUnique({ where: { id: competitionId } });
      if (!competition) throw this.notFound();
      const published = await transaction.competitionStage.findFirst({
        where: { competitionId, status: 'PUBLISHED' }
      });
      if (published) {
        throw new CompetitionError('SCHEDULE_ALREADY_PUBLISHED', 'Published schedule cannot be replaced', 409);
      }
      if (competition.status !== 'REGISTRATION_CLOSED') {
        throw new CompetitionError(
          'SCHEDULE_GENERATION_NOT_ALLOWED',
          'Schedule generation requires closed registration',
          409
        );
      }
      const participants = await transaction.competitionParticipant.findMany({
        where: { competitionId },
        orderBy: [{ admissionSequence: 'asc' }, { id: 'asc' }]
      });
      if (participants.length < 2) {
        throw new CompetitionError(
          'SCHEDULE_PARTICIPANTS_INSUFFICIENT',
          'At least two approved participants are required',
          409
        );
      }
      const pairings = this.generator(participants.map(({ id }) => id));
      const drafts = await transaction.competitionStage.findMany({
        where: { competitionId, status: 'DRAFT' }, select: { id: true }
      });
      const draftIds = drafts.map(({ id }) => id);
      if (draftIds.length > 0) {
        await transaction.competitionMatch.deleteMany({ where: { stageId: { in: draftIds } } });
        await transaction.competitionStage.deleteMany({ where: { id: { in: draftIds } } });
      }
      const stage = await transaction.competitionStage.create({
        data: { competitionId, sequence: 1, format: competition.format }
      });
      await transaction.competitionMatch.createMany({
        data: pairings.map((pairing) => ({ stageId: stage.id, ...pairing }))
      });
      return this.readPreview(transaction, competitionId, 'DRAFT');
    });
  }

  async preview(competitionId: string): Promise<SchedulePreview> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    return this.readPreview(this.prisma, competitionId);
  }

  async publish(
    actorId: string,
    competitionId: string,
    input: PublishScheduleInput,
    key: string
  ): Promise<SchedulePreview> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    return this.receipts.execute(actorId, `competition.schedule.publish:${competitionId}`, key, async (transaction) => {
      await this.lockCompetition(transaction, competitionId);
      const competition = await transaction.competition.findUnique({ where: { id: competitionId } });
      if (!competition) throw this.notFound();
      assertExpectedVersion(competition.version, input.expectedCompetitionVersion, 'Competition');
      if (competition.status !== 'REGISTRATION_CLOSED') {
        throw new CompetitionError('SCHEDULE_PUBLISH_NOT_ALLOWED', 'Schedule cannot be published now', 409);
      }
      const stage = await transaction.competitionStage.findFirst({ where: { competitionId, status: 'DRAFT' } });
      if (!stage) throw new CompetitionError('SCHEDULE_DRAFT_NOT_FOUND', 'Draft schedule was not found', 404);
      assertExpectedVersion(stage.version, input.expectedStageVersion, 'Schedule');

      const stageUpdate = await transaction.competitionStage.updateMany({
        where: { id: stage.id, status: 'DRAFT', version: input.expectedStageVersion },
        data: { status: 'PUBLISHED', publishedAt: new Date(), version: { increment: 1 } }
      });
      const competitionUpdate = await transaction.competition.updateMany({
        where: { id: competitionId, status: 'REGISTRATION_CLOSED', version: input.expectedCompetitionVersion },
        data: { status: 'SCHEDULED', version: { increment: 1 } }
      });
      if (stageUpdate.count !== 1 || competitionUpdate.count !== 1) {
        throw new CompetitionError('VERSION_CONFLICT', 'Schedule or competition has changed', 409);
      }
      return this.readPreview(transaction, competitionId, 'PUBLISHED');
    });
  }

  async listPublic(competitionId: string): Promise<ScheduleMatch[]> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    const stage = await this.prisma.competitionStage.findFirst({
      where: { competitionId, status: 'PUBLISHED' }, select: { id: true }
    });
    if (!stage) return [];
    const matches = await this.matches(this.prisma, stage.id);
    return matches.map((match) => this.matchResponse(match));
  }

  async listStagePublic(stageId: string): Promise<ScheduleMatch[]> {
    await this.visibility.requireVisible({ type: 'STAGE', id: stageId });
    const stage = await this.prisma.competitionStage.findUnique({
      where: { id: stageId },
      select: { id: true, status: true }
    });
    if (!stage || stage.status !== 'PUBLISHED') return [];
    const matches = await this.matches(this.prisma, stageId);
    return matches.map((match) => this.matchResponse(match));
  }

  private async readStagePreview(
    client: CompetitionTransaction | PrismaService,
    stageId: string
  ): Promise<SchedulePreview> {
    const stage = await client.competitionStage.findUnique({ where: { id: stageId } });
    if (!stage) throw new CompetitionError('SCHEDULE_NOT_FOUND', '未找到组别赛程', 404);
    const matches = await this.matches(client, stageId);
    return {
      id: stage.id,
      competitionId: stage.competitionId,
      status: stage.status,
      version: stage.version,
      roundCount: Math.max(0, ...matches.map((match) => match.roundNumber)),
      matchCount: matches.length,
      matches: matches.map((match) => this.matchResponse(match))
    };
  }

  private async readPreview(
    client: CompetitionTransaction | PrismaService,
    competitionId: string,
    status?: CompetitionStage['status']
  ): Promise<SchedulePreview> {
    const stage = await client.competitionStage.findFirst({
      where: { competitionId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' }
    });
    if (!stage) throw new CompetitionError('SCHEDULE_NOT_FOUND', 'Schedule was not found', 404);
    const matches = await this.matches(client, stage.id);
    const responses = matches.map((match) => this.matchResponse(match));
    return {
      id: stage.id,
      competitionId,
      status: stage.status,
      version: stage.version,
      roundCount: Math.max(0, ...matches.map(({ roundNumber }) => roundNumber)),
      matchCount: matches.length,
      matches: responses
    };
  }

  private matches(client: CompetitionTransaction | PrismaService, stageId: string): Promise<MatchRecord[]> {
    return client.competitionMatch.findMany({
      where: { stageId },
      include: {
        homeParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } },
        awayParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } },
        officialResultVersion: true
      },
      orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }]
    });
  }

  private matchResponse(match: MatchRecord): ScheduleMatch {
    return {
      id: match.id,
      competitionId: match.homeParticipant.competitionId,
      stageId: match.stageId,
      roundNumber: match.roundNumber,
      pairingKey: match.pairingKey,
      matchNumber: match.matchNumber,
      homeParticipant: this.participant(match.homeParticipant),
      awayParticipant: this.participant(match.awayParticipant),
      plannedAt: match.plannedAt?.toISOString() ?? null,
      status: match.status,
      version: match.version,
      officialResult: match.officialResultVersion ? {
        resultVersionId: match.officialResultVersion.id,
        version: match.officialResultVersion.version,
        homeScore: match.officialResultVersion.homeScore,
        awayScore: match.officialResultVersion.awayScore,
        status: match.officialResultVersion.status === 'SUPERSEDED' ? 'SUPERSEDED' : 'OFFICIAL'
      } : null,
      resultVersions: [],
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString()
    };
  }

  private participant(participant: MatchRecord['homeParticipant']) {
    const status = participant.seasonEntry?.leagueTeam.status;
    return {
      id: participant.id,
      displayName: participant.displayNameSnapshot,
      participantType: participant.participantType,
      teamLifecycleStatus: status === 'ACTIVE' || status === 'ARCHIVED' ? status : null,
      teamLogoUrl: participant.seasonEntry?.teamLogoUrlSnapshot ?? null
    };
  }

  private lockCompetition(transaction: CompetitionTransaction, competitionId: string): Promise<unknown> {
    return transaction.$queryRaw`SELECT id FROM competitions WHERE id = ${competitionId} FOR UPDATE`;
  }

  private notFound(): CompetitionError {
    return new CompetitionError('COMPETITION_NOT_FOUND', 'Competition was not found', 404);
  }

  private requireAdminReceipts(): AdminMutationReceiptService {
    if (!this.adminReceipts) throw new Error('Admin schedule receipts are not configured');
    return this.adminReceipts;
  }

  private assertManagedStage(
    stage: null | {
      status: CompetitionStage['status'];
      version: number;
      competitionId: string;
      competition: {
        competitionType: string;
        season: null | { id: string; leagueId: string; status: string; version: number };
      };
    },
    leagueId: string
  ): asserts stage is NonNullable<typeof stage> {
    if (!stage) throw new CompetitionError('COMPETITION_STAGE_NOT_FOUND', '未找到联赛组别', 404);
    if (stage.competition.competitionType !== 'DIVISION_LEAGUE'
      || !stage.competition.season
      || stage.competition.season.leagueId !== leagueId) {
      throw new CompetitionError('COMPETITION_STAGE_NOT_IN_LEAGUE', '组别不属于当前联赛', 404);
    }
  }
}

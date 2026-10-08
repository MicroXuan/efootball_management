import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  CupRegistrationResponse,
  ParsedCreateSeasonCupRequest,
  RegisterSeasonCupRequest,
  SeasonCupListResponse,
  SeasonCupSummary,
  WithdrawSeasonCupRequest
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import type { Competition, CompetitionRegistration, CupCompetitionConfig } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError, assertExpectedVersion } from './competition.errors.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { COMPETITION_CLOCK, type CompetitionClock } from './registrations.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

const DEFAULT_TIE_BREAKERS = [
  'TOTAL_POINTS',
  'HEAD_TO_HEAD_POINTS',
  'HEAD_TO_HEAD_GOAL_DIFFERENCE',
  'TOTAL_GOAL_DIFFERENCE',
  'TOTAL_GOALS',
  'WINS'
] as const;

type CupRecord = Competition & { cupConfig: CupCompetitionConfig | null };

@Injectable()
export class CupCompetitionsService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly adminReceipts: AdminMutationReceiptService,
    @Inject(MutationReceiptService) private readonly userReceipts: MutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(COMPETITION_CLOCK) private readonly clock: CompetitionClock,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async listAdmin(
    actorAdminId: string,
    leagueId: string,
    seasonId: string
  ): Promise<SeasonCupListResponse> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const seasonLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    if (seasonLeagueId !== leagueId) throw this.visibility.notFound();
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    const competitions = await this.prisma.competition.findMany({
      where: {
        seasonId,
        season: { leagueId },
        competitionType: { in: ['GROUP_KNOCKOUT_CUP', 'KNOCKOUT_CUP'] }
      },
      include: { cupConfig: true, _count: { select: { participants: true } } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }]
    });
    return {
      items: competitions.map((competition) => this.summary(
        competition,
        competition._count.participants
      ))
    };
  }

  async create(
    actorAdminId: string,
    leagueId: string,
    seasonId: string,
    input: ParsedCreateSeasonCupRequest,
    key: string
  ) {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const seasonLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    if (seasonLeagueId !== leagueId) throw this.visibility.notFound();
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.adminReceipts.execute(actorAdminId, `admin.cup.create:${seasonId}`, key, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`;
      const season = await transaction.leagueSeason.findUnique({ where: { id: seasonId } });
      if (!season || season.leagueId !== leagueId || input.seasonId !== seasonId) {
        throw new CompetitionError('CUP_SEASON_NOT_FOUND', '赛季不属于当前联赛', 404);
      }
      if (season.status === 'COMPLETED' || season.status === 'CANCELLED') {
        throw new CompetitionError('CUP_SEASON_CLOSED', '已结束的赛季不能创建杯赛', 409);
      }

      const competition = await transaction.competition.create({
        data: {
          seasonId,
          competitionType: input.competitionType,
          name: input.name,
          description: input.description,
          platform: input.platform,
          serverRegion: input.serverRegion,
          participantType: 'TEAM',
          format: input.format,
          registrationOpensAt: new Date(input.registrationOpensAt),
          registrationClosesAt: new Date(input.registrationClosesAt),
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          participantLimit: input.participantLimit,
          createdByAdminId: actorAdminId,
          cupConfig: {
            create: {
              targetGroupSize: input.targetGroupSize,
              qualifiersPerGroup: input.qualifiersPerGroup
            }
          }
        }
      });
      await transaction.competitionRuleVersion.create({
        data: {
          competitionId: competition.id,
          version: 1,
          winPoints: 3,
          drawPoints: 1,
          lossPoints: 0,
          tieBreakers: [...DEFAULT_TIE_BREAKERS],
          createdByAdminId: actorAdminId
        }
      });
      await this.audit.record(transaction, {
        actorAdminId,
        leagueId,
        action: 'admin.cup.create',
        resourceType: 'Competition',
        resourceId: competition.id,
        metadata: { seasonId, name: input.name, competitionType: input.competitionType }
      });
      return this.summary({
        ...competition,
        cupConfig: {
          id: '', competitionId: competition.id,
          targetGroupSize: input.targetGroupSize,
          qualifiersPerGroup: input.qualifiersPerGroup,
          version: 1, createdAt: competition.createdAt, updatedAt: competition.updatedAt
        }
      });
    }, input);
  }

  async register(
    userId: string,
    competitionId: string,
    input: RegisterSeasonCupRequest,
    key: string
  ): Promise<CupRegistrationResponse> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    return this.userReceipts.execute(userId, `cup.register:${competitionId}`, key, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM competitions WHERE id = ${competitionId} FOR UPDATE`;
      const competition = await transaction.competition.findUnique({
        where: { id: competitionId },
        include: { cupConfig: true }
      });
      if (!competition || !competition.cupConfig || !this.isCup(competition.competitionType)) {
        throw new CompetitionError('CUP_NOT_FOUND', '杯赛不存在', 404);
      }
      this.assertRegistrationOpen(competition);
      if (input.acceptedRuleVersion !== competition.boundRuleVersion) {
        throw new CompetitionError('COMPETITION_RULE_VERSION_CHANGED', '杯赛规则已更新，请重新确认', 409);
      }

      const entry = await transaction.seasonEntry.findUnique({ where: { id: input.seasonEntryId } });
      if (!entry || entry.seasonId !== competition.seasonId || entry.status !== 'APPROVED') {
        throw new CompetitionError('CUP_SEASON_ENTRY_INELIGIBLE', '只有本赛季正式参赛球队可以报名杯赛', 409);
      }
      if (entry.ownerUserId !== userId) {
        throw new CompetitionError('CUP_SEASON_ENTRY_NOT_OWNED', '只能为自己拥有的球队报名', 403);
      }

      const existing = await transaction.competitionRegistration.findUnique({
        where: { competitionId_seasonEntryId: { competitionId, seasonEntryId: entry.id } }
      });
      if (existing?.status === 'APPROVED') return this.registration(existing, entry.teamNameSnapshot);

      const activeCount = await transaction.competitionRegistration.count({
        where: { competitionId, status: 'APPROVED' }
      });
      if (activeCount >= competition.participantLimit) {
        throw new CompetitionError('REGISTRATION_FULL', '杯赛报名人数已满', 409);
      }
      if (existing && existing.status !== 'WITHDRAWN') {
        throw new CompetitionError('CUP_REGISTRATION_STATE_INVALID', '当前报名记录不能重新报名', 409);
      }

      const registration = existing
        ? await transaction.competitionRegistration.update({
          where: { id: existing.id },
          data: {
            acceptedRuleVersion: input.acceptedRuleVersion,
            status: 'APPROVED',
            withdrawnAt: null,
            reviewedAt: this.clock.now(),
            version: { increment: 1 }
          }
        })
        : await transaction.competitionRegistration.create({
          data: {
            competitionId,
            applicantId: userId,
            gameAccountId: null,
            seasonEntryId: entry.id,
            acceptedRuleVersion: input.acceptedRuleVersion,
            status: 'APPROVED',
            reviewedAt: this.clock.now()
          }
        });
      const latest = await transaction.competitionParticipant.aggregate({
        where: { competitionId }, _max: { admissionSequence: true }
      });
      await transaction.competitionParticipant.create({
        data: {
          competitionId,
          participantType: 'TEAM',
          registrationId: registration.id,
          seasonEntryId: entry.id,
          admissionSequence: (latest._max.admissionSequence ?? 0) + 1,
          displayNameSnapshot: entry.teamNameSnapshot
        }
      });
      await this.audit.record(transaction, {
        actorUserId: userId,
        leagueId: null,
        action: 'cup.registration.create',
        resourceType: 'CompetitionRegistration',
        resourceId: registration.id,
        metadata: { competitionId, seasonEntryId: entry.id }
      });
      return this.registration(registration, entry.teamNameSnapshot);
    });
  }

  async getMine(userId: string, competitionId: string): Promise<CupRegistrationResponse | null> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    const registration = await this.prisma.competitionRegistration.findFirst({
      where: {
        competitionId,
        applicantId: userId,
        competition: { competitionType: { in: ['GROUP_KNOCKOUT_CUP', 'KNOCKOUT_CUP'] } }
      },
      include: { seasonEntry: { select: { teamNameSnapshot: true } } }
    });
    if (!registration) return null;
    if (!registration.seasonEntry) throw new Error('Cup registration has no season entry');
    return this.registration(registration, registration.seasonEntry.teamNameSnapshot);
  }

  async withdraw(
    userId: string,
    competitionId: string,
    input: WithdrawSeasonCupRequest,
    key: string
  ): Promise<CupRegistrationResponse> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    return this.userReceipts.execute(userId, `cup.withdraw:${competitionId}`, key, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM competitions WHERE id = ${competitionId} FOR UPDATE`;
      const competition = await transaction.competition.findUnique({
        where: { id: competitionId },
        include: { cupConfig: true }
      });
      if (!competition || !competition.cupConfig || !this.isCup(competition.competitionType)) {
        throw new CompetitionError('CUP_NOT_FOUND', '杯赛不存在', 404);
      }
      this.assertRegistrationOpen(competition);
      const registration = await transaction.competitionRegistration.findFirst({
        where: { competitionId, applicantId: userId },
        include: { seasonEntry: { select: { teamNameSnapshot: true } } }
      });
      if (!registration || !registration.seasonEntry) {
        throw new CompetitionError('CUP_REGISTRATION_NOT_FOUND', '未找到杯赛报名记录', 404);
      }
      assertExpectedVersion(registration.version, input.expectedVersion, 'Cup registration');
      if (registration.status !== 'APPROVED') {
        throw new CompetitionError('CUP_REGISTRATION_STATE_INVALID', '当前杯赛报名不能撤回', 409);
      }
      await transaction.competitionParticipant.deleteMany({ where: { registrationId: registration.id } });
      const updated = await transaction.competitionRegistration.update({
        where: { id: registration.id },
        data: { status: 'WITHDRAWN', withdrawnAt: this.clock.now(), version: { increment: 1 } }
      });
      await this.audit.record(transaction, {
        actorUserId: userId,
        leagueId: null,
        action: 'cup.registration.withdraw',
        resourceType: 'CompetitionRegistration',
        resourceId: registration.id,
        metadata: { competitionId, seasonEntryId: registration.seasonEntryId }
      });
      return this.registration(updated, registration.seasonEntry.teamNameSnapshot);
    });
  }

  private assertRegistrationOpen(competition: CupRecord): void {
    const now = this.clock.now().getTime();
    if (competition.status !== 'REGISTRATION_OPEN'
      || now < competition.registrationOpensAt.getTime()
      || now >= competition.registrationClosesAt.getTime()) {
      throw new CompetitionError('REGISTRATION_CLOSED', '杯赛当前不在报名时间内', 409);
    }
  }

  private isCup(type: string): boolean {
    return type === 'GROUP_KNOCKOUT_CUP' || type === 'KNOCKOUT_CUP';
  }

  private registration(value: CompetitionRegistration, teamName: string): CupRegistrationResponse {
    if (!value.seasonEntryId) throw new Error('Cup registration has no season entry');
    return {
      id: value.id,
      competitionId: value.competitionId,
      seasonEntryId: value.seasonEntryId,
      applicantId: value.applicantId,
      teamName,
      status: value.status,
      withdrawnAt: value.withdrawnAt?.toISOString() ?? null,
      version: value.version,
      createdAt: value.createdAt.toISOString(),
      updatedAt: value.updatedAt.toISOString()
    };
  }

  private summary(value: CupRecord, participantCount = 0): SeasonCupSummary {
    if (!value.cupConfig || !value.seasonId) throw new Error('Cup competition is missing its season configuration');
    return {
      id: value.id,
      seasonId: value.seasonId,
      name: value.name,
      description: value.description,
      competitionType: value.competitionType as SeasonCupSummary['competitionType'],
      format: value.format as SeasonCupSummary['format'],
      status: value.status,
      registrationOpensAt: value.registrationOpensAt.toISOString(),
      registrationClosesAt: value.registrationClosesAt.toISOString(),
      startsAt: value.startsAt.toISOString(),
      endsAt: value.endsAt.toISOString(),
      participantLimit: value.participantLimit,
      participantCount,
      targetGroupSize: value.cupConfig.targetGroupSize,
      qualifiersPerGroup: value.cupConfig.qualifiersPerGroup,
      version: value.version
    };
  }
}

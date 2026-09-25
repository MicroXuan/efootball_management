import { Inject, Injectable } from '@nestjs/common';
import {
  CreateCompetitionRequestSchema,
  type CompetitionDetail,
  type CompetitionListQuery,
  type CompetitionListResponse,
  type CompetitionRules,
  type CompetitionStatus,
  type ParsedCreateCompetitionRequest,
  type UpdateCompetitionRequest,
  type UpdateCompetitionRulesRequest,
  type VersionedMutationRequest
} from '@efm/contracts';
import type { Competition, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError, assertExpectedVersion } from './competition.errors.js';
import type { CompetitionTransaction } from './competition.types.js';
import { assertCompetitionTransition } from './domain/competition-state.js';
import { MutationReceiptService } from './mutation-receipt.service.js';

const DEFAULT_RULES: CompetitionRules = {
  winPoints: 3,
  drawPoints: 1,
  lossPoints: 0,
  tieBreakers: [
    'TOTAL_POINTS',
    'HEAD_TO_HEAD_POINTS',
    'HEAD_TO_HEAD_GOAL_DIFFERENCE',
    'TOTAL_GOAL_DIFFERENCE',
    'TOTAL_GOALS',
    'WINS'
  ]
};

type DetailRecord = Prisma.CompetitionGetPayload<{
  include: {
    _count: { select: { participants: true } };
    ruleVersions: { orderBy: { version: 'desc' }; take: 1 };
    stages: {
      where: { status: 'PUBLISHED' };
      include: { _count: { select: { matches: true } } };
      take: 1;
    };
  };
}>;

type TransitionInput = VersionedMutationRequest & { reason?: string | undefined };

@Injectable()
export class CompetitionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService
  ) {}

  create(actorId: string, input: ParsedCreateCompetitionRequest, key: string): Promise<CompetitionDetail> {
    return this.receipts.execute(actorId, 'competition.create', key, async (transaction) => {
      const managerRole = await transaction.role.findUnique({ where: { code: 'EVENT_MANAGER' } });
      if (!managerRole) throw new CompetitionError('COMPETITION_ROLE_MISSING', 'Event manager role is missing', 500);
      const competition = await transaction.competition.create({
        data: {
          name: input.name,
          description: input.description,
          platform: input.platform,
          serverRegion: input.serverRegion,
          participantType: input.participantType,
          format: input.format,
          registrationOpensAt: new Date(input.registrationOpensAt),
          registrationClosesAt: new Date(input.registrationClosesAt),
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          participantLimit: input.participantLimit,
          createdById: actorId
        }
      });
      await transaction.competitionRuleVersion.create({
        data: {
          competitionId: competition.id,
          version: 1,
          ...DEFAULT_RULES,
          tieBreakers: [...DEFAULT_RULES.tieBreakers],
          createdById: actorId
        }
      });
      await transaction.userRoleBinding.create({
        data: {
          userId: actorId,
          roleId: managerRole.id,
          scopeType: 'COMPETITION',
          scopeId: competition.id,
          grantedById: actorId
        }
      });
      return this.getDetailRecord(transaction, competition.id).then((record) => this.detail(record, true));
    });
  }

  update(
    actorId: string,
    competitionId: string,
    input: UpdateCompetitionRequest,
    key: string
  ): Promise<CompetitionDetail> {
    return this.receipts.execute(actorId, `competition.update:${competitionId}`, key, async (transaction) => {
      const existing = await this.findCompetition(transaction, competitionId);
      assertExpectedVersion(existing.version, input.expectedVersion, 'Competition');
      if (existing.status !== 'DRAFT' && (
        input.platform !== undefined
        || input.serverRegion !== undefined
        || input.participantType !== undefined
        || input.format !== undefined
      )) {
        throw new CompetitionError(
          'COMPETITION_CORE_FIELDS_LOCKED',
          'Core competition fields are locked after registration opens',
          409
        );
      }
      const merged = CreateCompetitionRequestSchema.safeParse({
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        platform: input.platform ?? existing.platform,
        serverRegion: input.serverRegion ?? existing.serverRegion,
        participantType: input.participantType ?? existing.participantType,
        format: input.format ?? existing.format,
        registrationOpensAt: input.registrationOpensAt ?? existing.registrationOpensAt.toISOString(),
        registrationClosesAt: input.registrationClosesAt ?? existing.registrationClosesAt.toISOString(),
        startsAt: input.startsAt ?? existing.startsAt.toISOString(),
        endsAt: input.endsAt ?? existing.endsAt.toISOString(),
        participantLimit: input.participantLimit ?? existing.participantLimit
      });
      if (!merged.success) {
        throw new CompetitionError('VALIDATION_FAILED', 'Competition timeline is invalid', 400);
      }
      const updated = await transaction.competition.updateMany({
        where: { id: competitionId, version: input.expectedVersion },
        data: {
          name: merged.data.name,
          description: merged.data.description,
          platform: merged.data.platform,
          serverRegion: merged.data.serverRegion,
          participantType: merged.data.participantType,
          format: merged.data.format,
          registrationOpensAt: new Date(merged.data.registrationOpensAt),
          registrationClosesAt: new Date(merged.data.registrationClosesAt),
          startsAt: new Date(merged.data.startsAt),
          endsAt: new Date(merged.data.endsAt),
          participantLimit: merged.data.participantLimit,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      return this.getDetailRecord(transaction, competitionId).then((record) => this.detail(record, true));
    });
  }

  updateRules(
    actorId: string,
    competitionId: string,
    input: UpdateCompetitionRulesRequest,
    key: string
  ): Promise<CompetitionDetail> {
    return this.receipts.execute(actorId, `competition.rules:${competitionId}`, key, async (transaction) => {
      const existing = await this.findCompetition(transaction, competitionId);
      assertExpectedVersion(existing.version, input.expectedVersion, 'Competition');
      if (['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(existing.status)) {
        throw new CompetitionError('COMPETITION_RULES_LOCKED', 'Competition rules are locked', 409);
      }
      const nextRuleVersion = existing.activeRuleVersion + 1;
      const updated = await transaction.competition.updateMany({
        where: { id: competitionId, version: input.expectedVersion },
        data: { activeRuleVersion: nextRuleVersion, version: { increment: 1 } }
      });
      if (updated.count !== 1) throw this.versionConflict();
      await transaction.competitionRuleVersion.create({
        data: {
          competitionId,
          version: nextRuleVersion,
          winPoints: input.winPoints,
          drawPoints: input.drawPoints,
          lossPoints: input.lossPoints,
          tieBreakers: [...input.tieBreakers],
          createdById: actorId
        }
      });
      return this.getDetailRecord(transaction, competitionId).then((record) => this.detail(record, true));
    });
  }

  transition(
    actorId: string,
    competitionId: string,
    target: CompetitionStatus,
    input: TransitionInput,
    key: string
  ): Promise<CompetitionDetail> {
    return this.receipts.execute(actorId, `competition.transition:${competitionId}:${target}`, key, async (transaction) => {
      await this.lockCompetition(transaction, competitionId);
      const existing = await this.findCompetition(transaction, competitionId);
      assertExpectedVersion(existing.version, input.expectedVersion, 'Competition');
      assertCompetitionTransition(existing.status, target);
      const data: Prisma.CompetitionUpdateManyMutationInput = {
        status: target,
        version: { increment: 1 }
      };
      if (target === 'REGISTRATION_OPEN') data.boundRuleVersion = existing.activeRuleVersion;
      if (target === 'CANCELLED') {
        if (!input.reason?.trim()) {
          throw new CompetitionError('CANCELLATION_REASON_REQUIRED', 'Cancellation reason is required', 400);
        }
        data.cancellationReason = input.reason.trim();
      }
      if (target === 'IN_PROGRESS') {
        const stage = await transaction.competitionStage.findFirst({
          where: { competitionId, status: 'PUBLISHED' }
        });
        if (!stage) throw new CompetitionError('SCHEDULE_NOT_PUBLISHED', 'A published schedule is required', 409);
        await transaction.competitionMatch.updateMany({
          where: { stageId: stage.id, status: 'SCHEDULED' },
          data: { status: 'AWAITING_RESULT', version: { increment: 1 } }
        });
      }
      if (target === 'COMPLETED') {
        const matches = await transaction.competitionMatch.findMany({
          where: { stage: { competitionId, status: 'PUBLISHED' } },
          select: { officialResultVersionId: true }
        });
        if (matches.length === 0 || matches.some(({ officialResultVersionId }) => !officialResultVersionId)) {
          throw new CompetitionError('COMPETITION_RESULTS_INCOMPLETE', 'Every match requires an official result', 409);
        }
      }
      const updated = await transaction.competition.updateMany({
        where: { id: competitionId, version: input.expectedVersion },
        data
      });
      if (updated.count !== 1) throw this.versionConflict();
      return this.getDetailRecord(transaction, competitionId).then((record) => this.detail(record, true));
    });
  }

  async listPublic(query: CompetitionListQuery): Promise<CompetitionListResponse> {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const records = await this.prisma.competition.findMany({
      where: {
        status: query.status && query.status !== 'DRAFT' ? query.status : { not: 'DRAFT' },
        ...(cursor ? {
          OR: [
            { registrationOpensAt: { lt: cursor.registrationOpensAt } },
            { registrationOpensAt: cursor.registrationOpensAt, id: { gt: cursor.id } }
          ]
        } : {})
      },
      include: { _count: { select: { participants: true } } },
      orderBy: [{ registrationOpensAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1
    });
    const page = records.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((record) => this.summary(record, record._count.participants)),
      nextCursor: records.length > query.limit && last
        ? this.encodeCursor(last.registrationOpensAt, last.id)
        : null
    };
  }

  async getPublic(competitionId: string): Promise<CompetitionDetail> {
    const record = await this.getDetailRecord(this.prisma, competitionId);
    if (record.status === 'DRAFT') throw this.notFound();
    return this.detail(record, false);
  }

  private async findCompetition(transaction: CompetitionTransaction, id: string): Promise<Competition> {
    const competition = await transaction.competition.findUnique({ where: { id } });
    if (!competition) throw this.notFound();
    return competition;
  }

  private lockCompetition(transaction: CompetitionTransaction, competitionId: string): Promise<unknown> {
    return transaction.$queryRaw`SELECT id FROM competitions WHERE id = ${competitionId} FOR UPDATE`;
  }

  private async getDetailRecord(
    client: CompetitionTransaction | PrismaService,
    id: string
  ): Promise<DetailRecord> {
    const record = await client.competition.findUnique({
      where: { id },
      include: {
        _count: { select: { participants: true } },
        ruleVersions: { orderBy: { version: 'desc' }, take: 1 },
        stages: {
          where: { status: 'PUBLISHED' },
          include: { _count: { select: { matches: true } } },
          take: 1
        }
      }
    });
    if (!record) throw this.notFound();
    return record;
  }

  private detail(record: DetailRecord, canManage: boolean): CompetitionDetail {
    const rules = record.ruleVersions[0];
    if (!rules) throw new CompetitionError('COMPETITION_RULES_MISSING', 'Competition rules are missing', 500);
    const stage = record.stages[0];
    return {
      ...this.summary(record, record._count.participants),
      currentRegistration: null,
      rules: {
        winPoints: rules.winPoints,
        drawPoints: rules.drawPoints,
        lossPoints: rules.lossPoints,
        tieBreakers: rules.tieBreakers as CompetitionRules['tieBreakers']
      },
      schedule: {
        published: Boolean(stage),
        matchCount: stage?._count.matches ?? 0,
        roundCount: 0
      },
      capabilities: {
        canRegister: record.status === 'REGISTRATION_OPEN',
        canWithdraw: false,
        canManage,
        canReviewRegistrations: canManage,
        canManageSchedule: canManage,
        canManageResults: canManage
      }
    };
  }

  private summary(record: Competition, participantCount: number) {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      platform: record.platform,
      serverRegion: record.serverRegion,
      participantType: record.participantType,
      format: record.format,
      status: record.status,
      registrationOpensAt: record.registrationOpensAt.toISOString(),
      registrationClosesAt: record.registrationClosesAt.toISOString(),
      startsAt: record.startsAt.toISOString(),
      endsAt: record.endsAt.toISOString(),
      participantLimit: record.participantLimit,
      participantCount,
      version: record.version,
      activeRuleVersion: record.activeRuleVersion,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    };
  }

  private encodeCursor(registrationOpensAt: Date, id: string): string {
    return Buffer.from(JSON.stringify({ registrationOpensAt: registrationOpensAt.toISOString(), id }))
      .toString('base64url');
  }

  private decodeCursor(value: string): { registrationOpensAt: Date; id: string } {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
        registrationOpensAt?: unknown;
        id?: unknown;
      };
      if (typeof parsed.registrationOpensAt !== 'string' || typeof parsed.id !== 'string') throw new Error();
      const registrationOpensAt = new Date(parsed.registrationOpensAt);
      if (Number.isNaN(registrationOpensAt.getTime())) throw new Error();
      return { registrationOpensAt, id: parsed.id };
    } catch {
      throw new CompetitionError('INVALID_CURSOR', 'Competition cursor is invalid', 400);
    }
  }

  private notFound(): CompetitionError {
    return new CompetitionError('COMPETITION_NOT_FOUND', 'Competition was not found', 404);
  }

  private versionConflict(): CompetitionError {
    return new CompetitionError('VERSION_CONFLICT', 'Competition has changed', 409);
  }
}

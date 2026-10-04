import { Inject, Injectable } from '@nestjs/common';
import type {
  ConfirmCupGroupProposalRequest,
  CupGroupProposal,
  CupGroupView,
  GenerateCupGroupProposalRequest
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError } from './competition.errors.js';
import { buildBalancedCupGroups } from './domain/cup-draw.js';

const ALGORITHM_VERSION = 'cup-groups-v1';
const PROPOSAL_INCLUDE = {
  rows: { orderBy: [{ suggestedGroupCode: 'asc' as const }, { id: 'asc' as const }] }
} satisfies Prisma.CupGroupProposalInclude;

type ProposalRecord = Prisma.CupGroupProposalGetPayload<{ include: typeof PROPOSAL_INCLUDE }>;

@Injectable()
export class CupGroupsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async getAdmin(actorAdminId: string, leagueId: string, competitionId: string): Promise<CupGroupView> {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      include: {
        season: { select: { leagueId: true } },
        cupGroupProposals: {
          orderBy: { version: 'desc' },
          take: 1,
          include: PROPOSAL_INCLUDE
        },
        stages: {
          where: { stageCode: { startsWith: 'GROUP_' } },
          orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
          include: { _count: { select: { participants: true, matches: true } } }
        }
      }
    });
    if (!competition || competition.season?.leagueId !== leagueId
      || competition.competitionType !== 'GROUP_KNOCKOUT_CUP') {
      throw new CompetitionError('CUP_NOT_FOUND', '小组淘汰杯不存在', 404);
    }
    return {
      competitionId: competition.id,
      competitionVersion: competition.version,
      proposal: competition.cupGroupProposals[0]
        ? this.response(competition.cupGroupProposals[0])
        : null,
      stages: competition.stages.map((stage) => ({
        id: stage.id,
        stageCode: stage.stageCode!,
        displayName: stage.displayName!,
        participantCount: stage._count.participants,
        matchCount: stage._count.matches,
        status: stage.status,
        version: stage.version
      }))
    };
  }

  async generate(
    actorAdminId: string,
    leagueId: string,
    competitionId: string,
    input: GenerateCupGroupProposalRequest,
    key: string
  ): Promise<CupGroupProposal> {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.cup-groups.generate:${competitionId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM competitions WHERE id = ${competitionId} FOR UPDATE`;
        const competition = await transaction.competition.findUnique({
          where: { id: competitionId },
          include: {
            season: { select: { id: true, leagueId: true } },
            cupConfig: true,
            participants: {
              orderBy: [{ admissionSequence: 'asc' }, { id: 'asc' }],
              select: { id: true, displayNameSnapshot: true }
            }
          }
        });
        if (!competition || competition.season?.leagueId !== leagueId
          || competition.competitionType !== 'GROUP_KNOCKOUT_CUP'
          || !competition.cupConfig?.targetGroupSize) {
          throw new CompetitionError('CUP_NOT_FOUND', '小组淘汰杯不存在', 404);
        }
        if (competition.status !== 'REGISTRATION_CLOSED') {
          throw new CompetitionError(
            'CUP_GROUP_GENERATION_NOT_ALLOWED',
            '关闭报名后才能生成小组建议',
            409
          );
        }
        if (competition.version !== input.expectedCompetitionVersion) {
          throw new CompetitionError('VERSION_CONFLICT', '杯赛已被其他管理员修改，请刷新后重试', 409);
        }

        const assignments = buildBalancedCupGroups({
          participantIds: competition.participants.map(({ id }) => id),
          targetGroupSize: competition.cupConfig.targetGroupSize,
          randomSeed: input.randomSeed
        });
        const participantById = new Map(competition.participants.map((participant) => [participant.id, participant]));
        const previous = await transaction.cupGroupProposal.findFirst({
          where: { competitionId },
          orderBy: { version: 'desc' },
          select: { version: true }
        });
        await transaction.cupGroupProposal.updateMany({
          where: { competitionId, status: 'DRAFT' },
          data: { status: 'SUPERSEDED' }
        });
        const proposal = await transaction.cupGroupProposal.create({
          data: {
            competitionId,
            version: (previous?.version ?? 0) + 1,
            algorithmVersion: ALGORITHM_VERSION,
            randomSeed: input.randomSeed,
            inputSummary: {
              participantCount: competition.participants.length,
              targetGroupSize: competition.cupConfig.targetGroupSize
            },
            createdByAdminId: actorAdminId,
            rows: {
              create: assignments.map((assignment) => ({
                participantId: assignment.participantId,
                teamName: participantById.get(assignment.participantId)!.displayNameSnapshot,
                suggestedGroupCode: assignment.groupCode
              }))
            }
          },
          include: PROPOSAL_INCLUDE
        });
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.cup-group-proposal.generate',
          resourceType: 'CupGroupProposal',
          resourceId: proposal.id,
          metadata: {
            competitionId,
            version: proposal.version,
            randomSeed: proposal.randomSeed,
            participantCount: proposal.rows.length
          }
        });
        return this.response(proposal);
      },
      input
    );
  }

  async confirm(
    actorAdminId: string,
    leagueId: string,
    competitionId: string,
    input: ConfirmCupGroupProposalRequest,
    key: string
  ) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.cup-groups.confirm:${competitionId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM competitions WHERE id = ${competitionId} FOR UPDATE`;
        const competition = await transaction.competition.findUnique({
          where: { id: competitionId },
          include: {
            season: { select: { id: true, leagueId: true } },
            cupConfig: true,
            participants: { select: { id: true } }
          }
        });
        if (!competition || competition.season?.leagueId !== leagueId
          || competition.competitionType !== 'GROUP_KNOCKOUT_CUP') {
          throw new CompetitionError('CUP_NOT_FOUND', '小组淘汰杯不存在', 404);
        }
        if (competition.status !== 'REGISTRATION_CLOSED') {
          throw new CompetitionError('CUP_GROUP_CONFIRMATION_NOT_ALLOWED', '当前杯赛状态不能确认分组', 409);
        }
        if (competition.version !== input.expectedCompetitionVersion) {
          throw new CompetitionError('VERSION_CONFLICT', '杯赛已被其他管理员修改，请刷新后重试', 409);
        }
        const existingStage = await transaction.competitionStage.findFirst({ where: { competitionId } });
        if (existingStage) {
          throw new CompetitionError('CUP_GROUPS_ALREADY_CONFIRMED', '正式小组已经存在，不能重复确认', 409);
        }

        const proposal = await transaction.cupGroupProposal.findUnique({
          where: { id: input.proposalId },
          include: { rows: { orderBy: { id: 'asc' } } }
        });
        if (!proposal || proposal.competitionId !== competitionId || proposal.status !== 'DRAFT') {
          throw new CompetitionError('CUP_GROUP_PROPOSAL_NOT_FOUND', '未找到可确认的小组建议', 404);
        }
        const participantIds = new Set(competition.participants.map(({ id }) => id));
        if (proposal.rows.length !== participantIds.size
          || proposal.rows.some((row) => !participantIds.has(row.participantId))) {
          throw new CompetitionError('CUP_GROUP_PROPOSAL_STALE', '报名球队已经变化，请重新生成小组建议', 409);
        }

        const allowedGroupCodes = new Set(proposal.rows.map(({ suggestedGroupCode }) => suggestedGroupCode));
        const overrideByParticipant = new Map(input.overrides.map((override) => [override.participantId, override]));
        for (const override of input.overrides) {
          if (!participantIds.has(override.participantId) || !allowedGroupCodes.has(override.targetGroupCode)) {
            throw new CompetitionError('CUP_GROUP_OVERRIDE_INVALID', '小组调整包含无效球队或小组', 400);
          }
        }
        const finalRows = proposal.rows.map((row) => {
          const override = overrideByParticipant.get(row.participantId);
          return {
            ...row,
            finalGroupCode: override?.targetGroupCode ?? row.suggestedGroupCode,
            overridden: Boolean(override),
            reason: override?.reason ?? null
          };
        });
        const counts = finalRows.reduce<Map<string, number>>((result, row) => {
          result.set(row.finalGroupCode, (result.get(row.finalGroupCode) ?? 0) + 1);
          return result;
        }, new Map());
        const sizes = [...counts.values()];
        if (counts.size !== allowedGroupCodes.size || Math.max(...sizes) - Math.min(...sizes) > 1) {
          throw new CompetitionError('CUP_GROUPS_UNBALANCED', '各小组人数差不能超过 1', 409);
        }

        const stageByCode = new Map<string, { id: string }>();
        const groupCodes = [...counts.keys()].sort();
        for (const [index, groupCode] of groupCodes.entries()) {
          const stage = await transaction.competitionStage.create({
            data: {
              competitionId,
              stageCode: groupCode,
              displayName: `${groupCode.slice('GROUP_'.length)} 组`,
              capacity: counts.get(groupCode)!,
              sequence: index + 1,
              format: 'ROUND_ROBIN'
            }
          });
          stageByCode.set(groupCode, stage);
        }
        const seeds = new Map<string, number>();
        await transaction.stageParticipant.createMany({
          data: finalRows.map((row) => {
            const seed = (seeds.get(row.finalGroupCode) ?? 0) + 1;
            seeds.set(row.finalGroupCode, seed);
            return {
              stageId: stageByCode.get(row.finalGroupCode)!.id,
              participantId: row.participantId,
              seed
            };
          })
        });
        for (const row of finalRows) {
          await transaction.cupGroupProposalRow.update({
            where: { id: row.id },
            data: {
              finalGroupCode: row.finalGroupCode,
              overridden: row.overridden,
              reason: row.reason
            }
          });
        }
        const proposalUpdate = await transaction.cupGroupProposal.updateMany({
          where: { id: proposal.id, status: 'DRAFT' },
          data: { status: 'CONFIRMED' }
        });
        const competitionUpdate = await transaction.competition.updateMany({
          where: { id: competitionId, version: input.expectedCompetitionVersion },
          data: { version: { increment: 1 } }
        });
        if (proposalUpdate.count !== 1 || competitionUpdate.count !== 1) {
          throw new CompetitionError('VERSION_CONFLICT', '分组已被其他管理员修改，请刷新后重试', 409);
        }
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.cup-group-proposal.confirm',
          resourceType: 'CupGroupProposal',
          resourceId: proposal.id,
          metadata: {
            competitionId,
            groupCodes,
            overrideCount: input.overrides.length
          }
        });
        return {
          competitionId,
          proposalId: proposal.id,
          version: input.expectedCompetitionVersion + 1,
          stages: groupCodes.map((stageCode) => ({
            id: stageByCode.get(stageCode)!.id,
            stageCode,
            displayName: `${stageCode.slice('GROUP_'.length)} 组`,
            participantCount: counts.get(stageCode)!
          }))
        };
      },
      input
    );
  }

  private response(proposal: ProposalRecord): CupGroupProposal {
    return {
      id: proposal.id,
      competitionId: proposal.competitionId,
      version: proposal.version,
      status: proposal.status,
      algorithmVersion: proposal.algorithmVersion,
      randomSeed: proposal.randomSeed,
      rows: proposal.rows.map((row) => ({
        id: row.id,
        participantId: row.participantId,
        teamName: row.teamName,
        suggestedGroupCode: row.suggestedGroupCode,
        finalGroupCode: row.finalGroupCode,
        overridden: row.overridden,
        reason: row.reason
      })),
      createdAt: proposal.createdAt.toISOString()
    };
  }
}

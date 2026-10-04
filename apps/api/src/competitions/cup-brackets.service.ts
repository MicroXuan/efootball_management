import { Inject, Injectable } from '@nestjs/common';
import type {
  ConfirmCupBracketProposalRequest,
  CupBracketProposal,
  GenerateCupBracketProposalRequest
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { CompetitionError } from './competition.errors.js';
import { buildKnockoutDraw, type KnockoutQualifier } from './domain/cup-draw.js';

const ALGORITHM_VERSION = 'cup-bracket-v1';

const ROUND_NAMES = new Map<number, { stageCode: string; displayName: string }>([
  [128, { stageCode: 'ROUND_OF_128', displayName: '128 强' }],
  [2, { stageCode: 'FINAL', displayName: '决赛' }],
  [4, { stageCode: 'SEMI_FINAL', displayName: '半决赛' }],
  [8, { stageCode: 'QUARTER_FINAL', displayName: '四分之一决赛' }],
  [16, { stageCode: 'ROUND_OF_16', displayName: '16 强' }],
  [32, { stageCode: 'ROUND_OF_32', displayName: '32 强' }],
  [64, { stageCode: 'ROUND_OF_64', displayName: '64 强' }]
]);

interface StoredPairing {
  id: string;
  pairingNumber: number;
  homeParticipantId: string | null;
  awayParticipantId: string | null;
  homeSourcePairingId: string | null;
  awaySourcePairingId: string | null;
  byeParticipantId: string | null;
  matchId: string | null;
  winnerParticipantId: string | null;
}

@Injectable()
export class CupBracketsService {
  constructor(
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async generate(
    actorAdminId: string,
    leagueId: string,
    competitionId: string,
    input: GenerateCupBracketProposalRequest,
    key: string
  ): Promise<CupBracketProposal> {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.cup-bracket.generate:${competitionId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM competitions WHERE id = ${competitionId} FOR UPDATE`;
        const competition = await transaction.competition.findUnique({
          where: { id: competitionId },
          include: {
            season: { select: { leagueId: true } },
            cupConfig: true,
            participants: {
              orderBy: [{ admissionSequence: 'asc' }, { id: 'asc' }],
              select: { id: true }
            },
            stages: {
              where: { stageCode: { startsWith: 'GROUP_' } },
              orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
              include: {
                matches: { select: { id: true, officialResultVersionId: true } },
                standingsSnapshots: {
                  orderBy: { version: 'desc' },
                  take: 1,
                  include: {
                    rows: {
                      orderBy: [{ rank: 'asc' }, { participantId: 'asc' }],
                      select: { participantId: true, rank: true, tiePending: true }
                    }
                  }
                }
              }
            }
          }
        });
        if (!competition || competition.season?.leagueId !== leagueId
          || !['GROUP_KNOCKOUT_CUP', 'KNOCKOUT_CUP'].includes(competition.competitionType)) {
          throw new CompetitionError('CUP_NOT_FOUND', '杯赛不存在', 404);
        }
        if (competition.version !== input.expectedCompetitionVersion) {
          throw new CompetitionError('VERSION_CONFLICT', '杯赛已被其他管理员修改，请刷新后重试', 409);
        }

        const qualifiers = this.qualifiers(competition);
        const draw = buildKnockoutDraw({ qualifiers, randomSeed: input.randomSeed });
        const previous = await transaction.cupBracketProposal.findFirst({
          where: { competitionId },
          orderBy: { version: 'desc' },
          select: { version: true }
        });
        await transaction.cupBracketProposal.updateMany({
          where: { competitionId, status: 'DRAFT' },
          data: { status: 'SUPERSEDED' }
        });
        const proposal = await transaction.cupBracketProposal.create({
          data: {
            competitionId,
            version: (previous?.version ?? 0) + 1,
            algorithmVersion: ALGORITHM_VERSION,
            randomSeed: input.randomSeed,
            bracketSize: draw.bracketSize,
            inputSummary: {
              qualifierCount: qualifiers.length,
              byeCount: draw.byeCount,
              source: competition.competitionType === 'GROUP_KNOCKOUT_CUP' ? 'GROUP_STANDINGS' : 'REGISTRATION'
            },
            createdByAdminId: actorAdminId
          }
        });

        const responseRounds: CupBracketProposal['rounds'] = [];
        let priorPairings: StoredPairing[] = [];
        let remainingSize = draw.bracketSize;
        let roundNumber = 1;
        while (remainingSize >= 2) {
          const metadata = ROUND_NAMES.get(remainingSize);
          if (!metadata) {
            throw new CompetitionError('CUP_BRACKET_SIZE_UNSUPPORTED', '杯赛签表规模暂不支持', 409);
          }
          const round = await transaction.cupBracketRound.create({
            data: {
              proposalId: proposal.id,
              roundNumber,
              stageCode: metadata.stageCode,
              displayName: metadata.displayName
            }
          });
          const storedPairings: StoredPairing[] = [];
          const pairingCount = remainingSize / 2;
          for (let index = 0; index < pairingCount; index += 1) {
            const initial = roundNumber === 1 ? draw.pairings[index] : undefined;
            const homeParticipantId = initial?.home?.participantId ?? null;
            const awayParticipantId = initial?.away?.participantId ?? null;
            const byeParticipantId = initial && Boolean(initial.home) !== Boolean(initial.away)
              ? (homeParticipantId ?? awayParticipantId)
              : null;
            const stored = await transaction.cupBracketPairing.create({
              data: {
                roundId: round.id,
                pairingNumber: index + 1,
                homeParticipantId,
                awayParticipantId,
                homeSourcePairingId: roundNumber === 1 ? null : priorPairings[index * 2]!.id,
                awaySourcePairingId: roundNumber === 1 ? null : priorPairings[index * 2 + 1]!.id,
                byeParticipantId
              }
            });
            storedPairings.push(stored);
          }
          responseRounds.push({
            roundNumber,
            stageCode: metadata.stageCode,
            displayName: metadata.displayName,
            pairings: storedPairings.map((pairing) => this.pairingResponse(pairing))
          });
          priorPairings = storedPairings;
          remainingSize /= 2;
          roundNumber += 1;
        }
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.cup-bracket.generate',
          resourceType: 'CupBracketProposal',
          resourceId: proposal.id,
          metadata: {
            competitionId,
            version: proposal.version,
            bracketSize: draw.bracketSize,
            byeCount: draw.byeCount
          }
        });
        return {
          id: proposal.id,
          competitionId,
          version: proposal.version,
          status: proposal.status,
          algorithmVersion: proposal.algorithmVersion,
          randomSeed: proposal.randomSeed,
          bracketSize: proposal.bracketSize,
          rounds: responseRounds,
          createdAt: proposal.createdAt.toISOString()
        };
      },
      input
    );
  }

  async confirm(
    actorAdminId: string,
    leagueId: string,
    competitionId: string,
    input: ConfirmCupBracketProposalRequest,
    key: string
  ): Promise<CupBracketProposal> {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.cup-bracket.confirm:${competitionId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM competitions WHERE id = ${competitionId} FOR UPDATE`;
        const competition = await transaction.competition.findUnique({
          where: { id: competitionId },
          include: {
            season: { select: { leagueId: true } },
            participants: { select: { id: true } },
            stages: { select: { sequence: true, stageCode: true } }
          }
        });
        if (!competition || competition.season?.leagueId !== leagueId
          || !['GROUP_KNOCKOUT_CUP', 'KNOCKOUT_CUP'].includes(competition.competitionType)) {
          throw new CompetitionError('CUP_NOT_FOUND', '杯赛不存在', 404);
        }
        if (competition.version !== input.expectedCompetitionVersion) {
          throw new CompetitionError('VERSION_CONFLICT', '杯赛已被其他管理员修改，请刷新后重试', 409);
        }
        if (competition.stages.some(({ stageCode }) => stageCode && !stageCode.startsWith('GROUP_'))) {
          throw new CompetitionError('CUP_BRACKET_ALREADY_CONFIRMED', '正式淘汰签表已经存在', 409);
        }
        const proposal = await transaction.cupBracketProposal.findUnique({
          where: { id: input.proposalId },
          include: {
            rounds: {
              orderBy: { roundNumber: 'asc' },
              include: { pairings: { orderBy: { pairingNumber: 'asc' } } }
            }
          }
        });
        if (!proposal || proposal.competitionId !== competitionId || proposal.status !== 'DRAFT') {
          throw new CompetitionError('CUP_BRACKET_PROPOSAL_NOT_FOUND', '未找到可确认的淘汰签表', 404);
        }
        const participantIds = new Set(competition.participants.map(({ id }) => id));
        const firstRound = proposal.rounds[0];
        const seededIds = firstRound?.pairings.flatMap((pairing) => [
          pairing.homeParticipantId,
          pairing.awayParticipantId
        ].filter((id): id is string => Boolean(id))) ?? [];
        if (!firstRound || seededIds.length !== participantIds.size
          || seededIds.some((id) => !participantIds.has(id))) {
          throw new CompetitionError('CUP_BRACKET_PROPOSAL_STALE', '参赛队伍已经变化，请重新生成签表', 409);
        }

        const baseSequence = competition.stages.reduce((maximum, stage) => Math.max(maximum, stage.sequence), 0);
        const stageByRound = new Map<number, { id: string }>();
        for (const round of proposal.rounds) {
          const stage = await transaction.competitionStage.create({
            data: {
              competitionId,
              stageCode: round.stageCode,
              displayName: round.displayName,
              capacity: proposal.bracketSize / (2 ** (round.roundNumber - 1)),
              sequence: baseSequence + round.roundNumber,
              format: 'SINGLE_ELIMINATION',
              status: round.roundNumber === 1 ? 'PUBLISHED' : 'DRAFT',
              publishedAt: round.roundNumber === 1 ? new Date() : null
            }
          });
          stageByRound.set(round.roundNumber, stage);
        }
        await transaction.stageParticipant.createMany({
          data: seededIds.map((participantId, index) => ({
            stageId: stageByRound.get(1)!.id,
            participantId,
            seed: index + 1
          }))
        });

        const responseRounds: CupBracketProposal['rounds'] = [];
        for (const round of proposal.rounds) {
          const responsePairings: CupBracketProposal['rounds'][number]['pairings'] = [];
          for (const pairing of round.pairings) {
            let stored: StoredPairing = pairing;
            if (round.roundNumber === 1 && pairing.byeParticipantId) {
              stored = await transaction.cupBracketPairing.update({
                where: { id: pairing.id },
                data: { winnerParticipantId: pairing.byeParticipantId }
              });
            } else if (round.roundNumber === 1
              && pairing.homeParticipantId && pairing.awayParticipantId) {
              const match = await transaction.competitionMatch.create({
                data: {
                  stageId: stageByRound.get(1)!.id,
                  roundNumber: 1,
                  pairingKey: pairing.id,
                  matchNumber: pairing.pairingNumber,
                  homeParticipantId: pairing.homeParticipantId,
                  awayParticipantId: pairing.awayParticipantId,
                  status: 'AWAITING_RESULT'
                }
              });
              stored = await transaction.cupBracketPairing.update({
                where: { id: pairing.id },
                data: { matchId: match.id }
              });
            }
            responsePairings.push(this.pairingResponse(stored));
          }
          responseRounds.push({
            roundNumber: round.roundNumber,
            stageCode: round.stageCode,
            displayName: round.displayName,
            pairings: responsePairings
          });
        }
        const proposalUpdate = await transaction.cupBracketProposal.updateMany({
          where: { id: proposal.id, status: 'DRAFT' },
          data: { status: 'CONFIRMED' }
        });
        const competitionUpdate = await transaction.competition.updateMany({
          where: { id: competitionId, version: input.expectedCompetitionVersion },
          data: {
            status: competition.status === 'REGISTRATION_CLOSED' ? 'IN_PROGRESS' : competition.status,
            version: { increment: 1 }
          }
        });
        if (proposalUpdate.count !== 1 || competitionUpdate.count !== 1) {
          throw new CompetitionError('VERSION_CONFLICT', '淘汰签表已被其他管理员修改', 409);
        }
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.cup-bracket.confirm',
          resourceType: 'CupBracketProposal',
          resourceId: proposal.id,
          metadata: { competitionId, bracketSize: proposal.bracketSize }
        });
        return {
          id: proposal.id,
          competitionId,
          version: proposal.version,
          status: 'CONFIRMED',
          algorithmVersion: proposal.algorithmVersion,
          randomSeed: proposal.randomSeed,
          bracketSize: proposal.bracketSize,
          rounds: responseRounds,
          createdAt: proposal.createdAt.toISOString()
        };
      },
      input
    );
  }

  private qualifiers(competition: {
    competitionType: string;
    status: string;
    cupConfig: { qualifiersPerGroup: number | null } | null;
    participants: Array<{ id: string }>;
    stages: Array<{
      stageCode: string | null;
      status: string;
      matches: Array<{ officialResultVersionId: string | null }>;
      standingsSnapshots: Array<{
        rows: Array<{ participantId: string; rank: number; tiePending: boolean }>;
      }>;
    }>;
  }): KnockoutQualifier[] {
    if (competition.competitionType === 'KNOCKOUT_CUP') {
      if (competition.status !== 'REGISTRATION_CLOSED') {
        throw new CompetitionError('CUP_BRACKET_GENERATION_NOT_ALLOWED', '关闭报名后才能生成淘汰签表', 409);
      }
      return competition.participants.map(({ id }) => ({ participantId: id }));
    }

    if (competition.status !== 'IN_PROGRESS' || !competition.cupConfig?.qualifiersPerGroup
      || competition.stages.length < 1) {
      throw new CompetitionError('CUP_GROUP_STAGE_INCOMPLETE', '小组赛尚未完成，不能生成淘汰签表', 409);
    }
    const qualifiers: KnockoutQualifier[] = [];
    for (const stage of competition.stages) {
      const rows = stage.standingsSnapshots[0]?.rows;
      if (stage.status !== 'PUBLISHED' || stage.matches.length < 1
        || stage.matches.some(({ officialResultVersionId }) => !officialResultVersionId)
        || !rows || rows.some(({ tiePending }) => tiePending)) {
        throw new CompetitionError('CUP_GROUP_STAGE_INCOMPLETE', '小组赛尚未完成或存在未解决并列', 409);
      }
      const qualifiedRows = rows.filter(({ rank }) => rank <= competition.cupConfig!.qualifiersPerGroup!);
      if (qualifiedRows.length !== competition.cupConfig.qualifiersPerGroup) {
        throw new CompetitionError('CUP_GROUP_STANDINGS_INVALID', '小组积分榜缺少足够的出线队伍', 409);
      }
      qualifiers.push(...qualifiedRows.map((row) => ({
        participantId: row.participantId,
        groupCode: stage.stageCode!,
        groupRank: row.rank
      })));
    }
    return qualifiers;
  }

  private pairingResponse(pairing: StoredPairing): CupBracketProposal['rounds'][number]['pairings'][number] {
    return {
      id: pairing.id,
      pairingNumber: pairing.pairingNumber,
      homeParticipantId: pairing.homeParticipantId,
      awayParticipantId: pairing.awayParticipantId,
      homeSourcePairingId: pairing.homeSourcePairingId,
      awaySourcePairingId: pairing.awaySourcePairingId,
      byeParticipantId: pairing.byeParticipantId,
      matchId: pairing.matchId,
      winnerParticipantId: pairing.winnerParticipantId
    };
  }
}

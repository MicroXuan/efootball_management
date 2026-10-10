import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CompetitionTransaction } from './competition.types.js';
import { CompetitionError } from './competition.errors.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

@Injectable()
export class CupProgressionService {
  constructor(
    @Optional() @Inject(LeagueVisibilityService) private readonly visibility?: LeagueVisibilityService
  ) {}

  async recordWinner(
    transaction: CompetitionTransaction,
    matchId: string,
    homeScore: number,
    awayScore: number
  ): Promise<void> {
    await this.visibility?.requireVisible({ type: 'MATCH', id: matchId }, transaction);
    const pairing = await transaction.cupBracketPairing.findUnique({
      where: { matchId },
      include: { round: { include: { proposal: true } } }
    });
    if (!pairing) return;
    if (homeScore === awayScore) {
      throw new CompetitionError('KNOCKOUT_DRAW_NOT_ALLOWED', '淘汰赛比分不能为平局', 409);
    }
    const winnerParticipantId = homeScore > awayScore
      ? pairing.homeParticipantId
      : pairing.awayParticipantId;
    if (!winnerParticipantId) {
      throw new CompetitionError('CUP_BRACKET_PAIRING_INVALID', '淘汰赛对阵缺少参赛队伍', 409);
    }
    if (pairing.winnerParticipantId && pairing.winnerParticipantId !== winnerParticipantId) {
      throw new CompetitionError('CUP_RESULT_LOCKED', '下一轮签表已锁定，不能改变晋级队伍', 409);
    }
    if (pairing.winnerParticipantId === winnerParticipantId) return;
    await transaction.cupBracketPairing.update({
      where: { id: pairing.id },
      data: { winnerParticipantId }
    });
    const roundPairings = await transaction.cupBracketPairing.findMany({
      where: { roundId: pairing.roundId },
      orderBy: { pairingNumber: 'asc' },
      select: { id: true, winnerParticipantId: true }
    });
    const winnerByPairing = new Map(roundPairings.map((item) => [
      item.id,
      item.id === pairing.id ? winnerParticipantId : item.winnerParticipantId
    ]));
    if ([...winnerByPairing.values()].some((winner) => !winner)) return;

    const targets: Array<{
      id: string;
      pairingNumber: number;
      homeParticipantId: string | null;
      awayParticipantId: string | null;
      matchId: string | null;
      round: { id: string; roundNumber: number; stageCode: string };
    }> = [];
    for (let index = 0; index < roundPairings.length; index += 2) {
      const homeSource = roundPairings[index];
      const awaySource = roundPairings[index + 1];
      if (!homeSource || !awaySource) break;
      const target = await transaction.cupBracketPairing.findFirst({
        where: {
          homeSourcePairingId: homeSource.id,
          awaySourcePairingId: awaySource.id,
          round: { proposalId: pairing.round.proposalId }
        },
        include: { round: true }
      });
      if (target) targets.push(target);
    }
    if (targets.length === 0) {
      await transaction.competition.update({
        where: { id: pairing.round.proposal.competitionId },
        data: { status: 'COMPLETED', version: { increment: 1 } }
      });
      return;
    }

    const stage = await transaction.competitionStage.findUnique({
      where: {
        competitionId_stageCode: {
          competitionId: pairing.round.proposal.competitionId,
          stageCode: targets[0]!.round.stageCode
        }
      }
    });
    if (!stage || stage.status !== 'DRAFT') {
      throw new CompetitionError('CUP_NEXT_ROUND_INVALID', '下一轮赛事状态异常', 409);
    }
    const participants: string[] = [];
    for (const target of targets) {
      const homeParticipantId = winnerByPairing.get(
        roundPairings[(target.pairingNumber - 1) * 2]!.id
      )!;
      const awayParticipantId = winnerByPairing.get(
        roundPairings[(target.pairingNumber - 1) * 2 + 1]!.id
      )!;
      participants.push(homeParticipantId, awayParticipantId);
      const match = await transaction.competitionMatch.create({
        data: {
          stageId: stage.id,
          roundNumber: target.round.roundNumber,
          pairingKey: target.id,
          matchNumber: target.pairingNumber,
          homeParticipantId,
          awayParticipantId,
          status: 'AWAITING_RESULT'
        }
      });
      await transaction.cupBracketPairing.update({
        where: { id: target.id },
        data: { homeParticipantId, awayParticipantId, matchId: match.id }
      });
    }
    await transaction.stageParticipant.createMany({
      data: participants.map((participantId, index) => ({
        stageId: stage.id,
        participantId,
        seed: index + 1
      }))
    });
    await transaction.competitionStage.update({
      where: { id: stage.id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), version: { increment: 1 } }
    });
  }
}

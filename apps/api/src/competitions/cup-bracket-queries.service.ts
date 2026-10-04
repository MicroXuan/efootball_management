import { Inject, Injectable } from '@nestjs/common';
import type { CupBracketView } from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { CompetitionError } from './competition.errors.js';

const BRACKET_INCLUDE = {
  rounds: {
    orderBy: { roundNumber: 'asc' as const },
    include: {
      pairings: {
        orderBy: { pairingNumber: 'asc' as const },
        include: {
          homeParticipant: true,
          awayParticipant: true,
          winnerParticipant: true,
          match: { include: { officialResultVersion: true } }
        }
      }
    }
  }
} satisfies Prisma.CupBracketProposalInclude;

type BracketRecord = Prisma.CupBracketProposalGetPayload<{ include: typeof BRACKET_INCLUDE }>;

@Injectable()
export class CupBracketQueriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService
  ) {}

  async getPublished(competitionId: string): Promise<CupBracketView> {
    const proposal = await this.prisma.cupBracketProposal.findFirst({
      where: { competitionId, status: 'CONFIRMED' },
      orderBy: { version: 'desc' },
      include: BRACKET_INCLUDE
    });
    if (!proposal) throw this.notFound();
    return this.view(proposal);
  }

  async getAdmin(actorAdminId: string, leagueId: string, competitionId: string): Promise<CupBracketView> {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    const proposal = await this.prisma.cupBracketProposal.findFirst({
      where: { competitionId, competition: { season: { leagueId } } },
      orderBy: { version: 'desc' },
      include: BRACKET_INCLUDE
    });
    if (!proposal) throw this.notFound();
    return this.view(proposal);
  }

  private async view(proposal: BracketRecord): Promise<CupBracketView> {
    const stages = await this.prisma.competitionStage.findMany({
      where: {
        competitionId: proposal.competitionId,
        stageCode: { in: proposal.rounds.map(({ stageCode }) => stageCode) }
      },
      select: { id: true, stageCode: true, status: true }
    });
    const stageByCode = new Map(stages.map((stage) => [stage.stageCode, stage]));
    const rounds: CupBracketView['rounds'] = proposal.rounds.map((round) => {
      const stage = stageByCode.get(round.stageCode);
      return {
        stageId: stage?.id ?? null,
        roundNumber: round.roundNumber,
        stageCode: round.stageCode,
        displayName: round.displayName,
        status: stage?.status ?? 'DRAFT',
        pairings: round.pairings.map((pairing) => ({
          id: pairing.id,
          pairingNumber: pairing.pairingNumber,
          homeParticipant: this.participant(pairing.homeParticipant),
          awayParticipant: this.participant(pairing.awayParticipant),
          winnerParticipant: this.participant(pairing.winnerParticipant),
          isBye: Boolean(pairing.byeParticipantId),
          match: pairing.match ? {
            id: pairing.match.id,
            status: pairing.match.status,
            homeScore: pairing.match.officialResultVersion?.homeScore ?? null,
            awayScore: pairing.match.officialResultVersion?.awayScore ?? null
          } : null
        }))
      };
    });
    return {
      competitionId: proposal.competitionId,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      proposalStatus: proposal.status,
      bracketSize: proposal.bracketSize,
      currentRoundNumber: rounds.find((round) =>
        round.status === 'PUBLISHED'
        && round.pairings.some(({ winnerParticipant }) => !winnerParticipant)
      )?.roundNumber ?? null,
      rounds
    };
  }

  private participant(participant: { id: string; displayNameSnapshot: string } | null) {
    return participant ? { id: participant.id, displayName: participant.displayNameSnapshot } : null;
  }

  private notFound(): CompetitionError {
    return new CompetitionError('CUP_BRACKET_NOT_FOUND', '淘汰签表尚未生成', 404);
  }
}

import { describe, expect, it, jest } from '@jest/globals';
import { CupBracketQueriesService } from './cup-bracket-queries.service.js';

const proposal = {
  id: 'proposal-1', competitionId: 'cup-1', version: 2, status: 'CONFIRMED', bracketSize: 4,
  rounds: [{
    id: 'round-1', roundNumber: 1, stageCode: 'SEMI_FINAL', displayName: '半决赛',
    pairings: [{
      id: 'pairing-1', pairingNumber: 1, byeParticipantId: null,
      homeParticipant: { id: 'p1', displayNameSnapshot: '上海海港' },
      awayParticipant: { id: 'p2', displayNameSnapshot: '北京国安' },
      winnerParticipant: { id: 'p1', displayNameSnapshot: '上海海港' },
      match: {
        id: 'match-1', status: 'CONFIRMED',
        officialResultVersion: { homeScore: 2, awayScore: 1 }
      }
    }, {
      id: 'pairing-pending', pairingNumber: 2, byeParticipantId: null,
      homeParticipant: { id: 'p3', displayNameSnapshot: '广州队' },
      awayParticipant: { id: 'p4', displayNameSnapshot: '山东泰山' },
      winnerParticipant: null,
      match: { id: 'match-2', status: 'AWAITING_RESULT', officialResultVersion: null }
    }]
  }, {
    id: 'round-2', roundNumber: 2, stageCode: 'FINAL', displayName: '决赛',
    pairings: [{
      id: 'pairing-2', pairingNumber: 1, byeParticipantId: null,
      homeParticipant: null, awayParticipant: null, winnerParticipant: null, match: null
    }]
  }]
};

function harness(found: typeof proposal | null = proposal) {
  const prisma = {
    cupBracketProposal: { findFirst: jest.fn(async (input: unknown) => {
      void input;
      return found;
    }) },
    competitionStage: { findMany: jest.fn(async () => [{
      id: 'stage-semi', stageCode: 'SEMI_FINAL', status: 'PUBLISHED'
    }, { id: 'stage-final', stageCode: 'FINAL', status: 'DRAFT' }]) }
  };
  const authorization = { requireLeagueAccess: jest.fn(async (adminId: string, leagueId: string) => ({
    id: adminId,
    leagueId
  })) };
  return {
    service: new CupBracketQueriesService(
      prisma as never,
      authorization as never,
      { requireVisible: jest.fn(async () => 'league-1'), notFound: jest.fn() } as never
    ),
    prisma,
    authorization
  };
}

describe('CupBracketQueriesService', () => {
  it('returns the confirmed bracket with Chinese team names, official score, and current round', async () => {
    const { service, prisma } = harness();

    const result = await service.getPublished('cup-1');

    expect(prisma.cupBracketProposal.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { competitionId: 'cup-1', status: 'CONFIRMED' }
    }));
    expect(result.currentRoundNumber).toBe(1);
    expect(result.proposalStatus).toBe('CONFIRMED');
    expect(result.rounds[0]?.pairings[0]).toEqual(expect.objectContaining({
      homeParticipant: { id: 'p1', displayName: '上海海港' },
      match: { id: 'match-1', status: 'CONFIRMED', homeScore: 2, awayScore: 1 }
    }));
  });

  it('allows an authorized league administrator to inspect the latest draft', async () => {
    const draft = { ...proposal, status: 'DRAFT' };
    const { service, authorization, prisma } = harness(draft);

    await service.getAdmin('admin-1', 'league-1', 'cup-1');

    expect(authorization.requireLeagueAccess).toHaveBeenCalledWith('admin-1', 'league-1');
    expect(prisma.cupBracketProposal.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ competitionId: 'cup-1' })
    }));
  });

  it('returns a clear not-found error before a bracket is confirmed', async () => {
    const { service } = harness(null);
    await expect(service.getPublished('cup-1')).rejects.toMatchObject({ code: 'CUP_BRACKET_NOT_FOUND' });
  });
});

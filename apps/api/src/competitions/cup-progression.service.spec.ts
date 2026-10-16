import { describe, expect, it, jest } from '@jest/globals';
import { CupProgressionService } from './cup-progression.service.js';

const competitionLookup = () => ({ stage: { competitionId: 'cup-1' } });

describe('CupProgressionService', () => {
  it.each(['AWAITING_RESULT', 'PENDING_CONFIRMATION'])('repairs an unplayed successor but refuses a successor already reporting results: %s', async (status) => {
    const pairing = { id: 'semi-1', matchId: 'match-1', homeParticipantId: 'p1', awayParticipantId: 'p2', winnerParticipantId: 'p1',
      round: { id: 'round-1', proposalId: 'proposal', proposal: { competitionId: 'cup-1' } } };
    const next = { id: 'final', homeSourcePairingId: 'semi-1', awaySourcePairingId: 'semi-2', homeParticipantId: 'p1', awayParticipantId: 'p3', matchId: 'next', winnerParticipantId: null };
    const tx = {
      $queryRaw: jest.fn(async () => []),
      cupBracketPairing: { findUnique: jest.fn(async () => pairing), findMany: jest.fn(async () => [next]), update: jest.fn(async ({ data }: { data: object }) => Object.assign(pairing, data)) },
      competitionMatch: { findUnique: jest.fn(async () => competitionLookup()), findUniqueOrThrow: jest.fn(async () => ({ id: 'next', stageId: 'final-stage', status, officialResultVersionId: null })), update: jest.fn(async (_input: unknown) => ({})) },
      stageParticipant: { updateMany: jest.fn(async (_input: unknown) => ({ count: 1 })) }
    };
    const service = new CupProgressionService();
    if (status === 'PENDING_CONFIRMATION') {
      await expect(service.recordWinner(tx as never, 'match-1', 0, 2, true)).rejects.toMatchObject({ response: { code: 'CUP_RESULT_LOCKED' } });
      expect(pairing.winnerParticipantId).toBe('p1');
    } else {
      await service.recordWinner(tx as never, 'match-1', 0, 2, true);
      expect(pairing.winnerParticipantId).toBe('p2');
      expect(tx.competitionMatch.update).toHaveBeenCalledWith({ where: { id: 'next' }, data: { homeParticipantId: 'p2', version: { increment: 1 } } });
      expect(tx.stageParticipant.updateMany).toHaveBeenCalledWith({ where: { stageId: 'final-stage', participantId: 'p1' }, data: { participantId: 'p2' } });
    }
  });
  it('waits for every pairing in the current round before publishing and creating the next round', async () => {
    const currentPairing = {
      id: 'semi-2', matchId: 'match-2', homeParticipantId: 'p3', awayParticipantId: 'p4',
      winnerParticipantId: null,
      round: { id: 'round-1', roundNumber: 1, proposal: { competitionId: 'cup-1', status: 'CONFIRMED' } }
    };
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      cupBracketPairing: {
        findUnique: jest.fn(async () => currentPairing),
        update: jest.fn(async (input: unknown) => {
          void input;
          return { ...currentPairing, winnerParticipantId: 'p3' };
        }),
        findMany: jest.fn(async () => [
          { id: 'semi-1', winnerParticipantId: 'p1' },
          { id: 'semi-2', winnerParticipantId: 'p3' }
        ]),
        findFirst: jest.fn(async () => ({
          id: 'final-1', pairingNumber: 1, homeSourcePairingId: 'semi-1', awaySourcePairingId: 'semi-2',
          homeParticipantId: null, awayParticipantId: null, matchId: null,
          round: { id: 'round-2', roundNumber: 2, stageCode: 'FINAL' }
        }))
      },
      competitionStage: {
        findUnique: jest.fn(async () => ({ id: 'stage-final', status: 'DRAFT' })),
        update: jest.fn(async (input: unknown) => {
          void input;
          return { id: 'stage-final', status: 'PUBLISHED' };
        })
      },
      stageParticipant: { createMany: jest.fn(async () => ({ count: 2 })) },
      competitionMatch: { findUnique: jest.fn(async () => competitionLookup()), create: jest.fn(async () => ({ id: 'match-final' })) },
      competition: { update: jest.fn() }
    };
    const service = new CupProgressionService();

    await service.recordWinner(transaction as never, 'match-2', 2, 0);

    expect(transaction.cupBracketPairing.update).toHaveBeenCalledWith({
      where: { id: 'final-1' },
      data: { homeParticipantId: 'p1', awayParticipantId: 'p3', matchId: 'match-final' }
    });
    expect(transaction.competitionStage.update).toHaveBeenCalledWith({
      where: { id: 'stage-final' },
      data: { status: 'PUBLISHED', publishedAt: expect.any(Date), version: { increment: 1 } }
    });
  });

  it('does not create the next round until every current-round winner is known', async () => {
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competitionMatch: { findUnique: jest.fn(async () => competitionLookup()) },
      cupBracketPairing: {
        findUnique: jest.fn(async () => ({
          id: 'semi-1', matchId: 'match-1', homeParticipantId: 'p1', awayParticipantId: 'p2', winnerParticipantId: null,
          round: { id: 'round-1', roundNumber: 1, proposal: { competitionId: 'cup-1', status: 'CONFIRMED' } }
        })),
        update: jest.fn(async () => ({})),
        findMany: jest.fn(async () => [
          { id: 'semi-1', winnerParticipantId: 'p1' },
          { id: 'semi-2', winnerParticipantId: null }
        ]),
        findFirst: jest.fn()
      }
    };
    const service = new CupProgressionService();

    await service.recordWinner(transaction as never, 'match-1', 1, 0);

    expect(transaction.cupBracketPairing.findFirst).not.toHaveBeenCalled();
  });

  it('marks the cup complete when the final winner is official', async () => {
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competitionMatch: { findUnique: jest.fn(async () => competitionLookup()) },
      cupBracketPairing: {
        findUnique: jest.fn(async () => ({
          id: 'final-1', matchId: 'match-final', homeParticipantId: 'p1', awayParticipantId: 'p2', winnerParticipantId: null,
          round: { id: 'round-final', roundNumber: 3, proposal: { competitionId: 'cup-1', status: 'CONFIRMED' } }
        })),
        update: jest.fn(async () => ({})),
        findMany: jest.fn(async () => [{ id: 'final-1', winnerParticipantId: 'p2' }]),
        findFirst: jest.fn(async () => null)
      },
      competition: { update: jest.fn(async (input: unknown) => {
        void input;
        return {};
      }) }
    };
    const service = new CupProgressionService();

    await service.recordWinner(transaction as never, 'match-final', 0, 3);

    expect(transaction.competition.update).toHaveBeenCalledWith({
      where: { id: 'cup-1' },
      data: { status: 'COMPLETED', version: { increment: 1 } }
    });
  });

  it('allows a score correction that keeps the already-advanced winner unchanged', async () => {
    const transaction = {
      $queryRaw: jest.fn(async () => []),
      competitionMatch: { findUnique: jest.fn(async () => competitionLookup()) },
      cupBracketPairing: {
        findUnique: jest.fn(async () => ({
          id: 'semi-1', matchId: 'match-1', homeParticipantId: 'p1', awayParticipantId: 'p2',
          winnerParticipantId: 'p1',
          round: { id: 'round-1', roundNumber: 1, proposal: { competitionId: 'cup-1', status: 'CONFIRMED' } }
        })),
        update: jest.fn(),
        findMany: jest.fn()
      }
    };
    const service = new CupProgressionService();

    await service.recordWinner(transaction as never, 'match-1', 4, 2);

    expect(transaction.cupBracketPairing.update).not.toHaveBeenCalled();
    expect(transaction.cupBracketPairing.findMany).not.toHaveBeenCalled();
  });
});

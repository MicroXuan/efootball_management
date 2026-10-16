import { jest } from '@jest/globals';
import { disputeFixture } from '../../test/helpers/match-result-disputes.js';
import { MatchResultDeadlineWorker } from './match-result-deadline.worker.js';

describe('MatchResultDeadlineWorker', () => {
  const { prisma, disputes, fixture, rejected } = disputeFixture();

  it('ticks every five minutes and stops on shutdown', async () => {
    jest.useFakeTimers();
    try {
      const advanceDue = jest.fn(async () => undefined);
      const worker = new MatchResultDeadlineWorker({ advanceDue } as never);
      worker.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(299_999);
      expect(advanceDue).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(advanceDue).toHaveBeenCalledTimes(1);
      worker.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(300_000);
      expect(advanceDue).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it('concurrent repeated ticks advance every due dispute once and never auto-open a timed-out result', async () => {
    const pending = await fixture();
    const a = await rejected();
    const b = await rejected();
    // Keep the global due scan outside any real competition's date range.
    const deadline = new Date('1900-01-01T00:00:00Z');
    await prisma.competitionMatch.update({ where: { id: pending.match.id }, data: { resultConfirmationDeadlineAt: deadline } });
    await prisma.matchResultDispute.updateMany({ where: { matchId: { in: [a.match.id, b.match.id] } }, data: { evidenceDeadlineAt: deadline } });
    const worker = new MatchResultDeadlineWorker(disputes);
    await Promise.all([worker.tick(deadline), worker.tick(deadline)]);
    await worker.tick(deadline);
    expect(await prisma.matchResultDispute.count({ where: { matchId: pending.match.id } })).toBe(0);
    expect(await prisma.matchResultEvent.count({ where: { matchId: pending.match.id, type: 'CONFIRMATION_EXPIRED' } })).toBe(1);
    for (const item of [a, b]) {
      expect(await prisma.matchResultDispute.findUniqueOrThrow({ where: { activeKey: item.match.id } })).toMatchObject({ status: 'READY_FOR_REVIEW' });
      expect(await prisma.matchResultEvent.count({ where: { matchId: item.match.id, type: 'EVIDENCE_DEADLINE_EXPIRED' } })).toBe(1);
    }
  });
});

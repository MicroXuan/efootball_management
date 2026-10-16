import { MatchResultEventsService } from './match-result-events.service.js';

describe('MatchResultEventsService', () => {
  it('appends one audit event for a stable business key', async () => {
    const stored: Array<Record<string, unknown>> = [];
    const tx = {
      matchResultEvent: {
        createMany: async ({ data }: { data: Record<string, unknown> }) => {
          if (!stored.some((event) => event.eventKey === data.eventKey)) stored.push(data);
          return { count: 1 };
        }
      }
    };
    const service = new MatchResultEventsService();
    const event = {
      matchId: 'match-1', resultVersionId: 'result-1', type: 'RESULT_SUBMITTED' as const,
      eventKey: 'result:result-1:submitted', actorType: 'USER' as const, actorUserId: 'user-1',
      occurredAt: new Date('2026-10-15T12:00:00.000Z'), metadata: { homeScore: 2, awayScore: 1 }
    };

    await service.append(tx as never, event);
    await service.append(tx as never, event);

    expect(stored).toEqual([event]);
  });
});

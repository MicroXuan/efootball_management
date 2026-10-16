import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { jest } from '@jest/globals';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ResultsController } from './results.controller.js';

describe('ResultsController participant dispute boundary', () => {
  const response = {
    id: '11111111-1111-4111-8111-111111111111', matchId: '22222222-2222-4222-8222-222222222222',
    trigger: 'REJECTED', status: 'EVIDENCE_COLLECTION', evidenceDeadlineAt: '2026-10-16T00:00:00.000Z',
    matchVersion: 3, evidencePresence: { SUBMITTER: true, OPPONENT: false }
  };

  it('registers JWT-protected participant dispute routes', () => {
    for (const [method, path] of [
      ['openTimeout', 'matches/:id/result-disputes/timeout'],
      ['attachEvidence', 'matches/:id/result-dispute/evidence'],
      ['getDispute', 'matches/:id/result-dispute']
    ] as const) {
      expect(Reflect.getMetadata(PATH_METADATA, ResultsController.prototype[method])).toBe(path);
      expect(Reflect.getMetadata(GUARDS_METADATA, ResultsController.prototype[method])).toContain(JwtAuthGuard);
    }
  });

  it('validates every response and strips evidence metadata and administrator timeline', async () => {
    const unsafeResponse = { ...response, evidence: [{ objectKey: 'secret' }], timeline: [{ metadata: { url: 'secret' } }] };
    const disputes = {
      openFromTimeout: jest.fn(async () => unsafeResponse), attachEvidence: jest.fn(async () => unsafeResponse),
      getForParticipant: jest.fn(async () => unsafeResponse)
    };
    const controller = new ResultsController({} as never, {} as never, disputes as never);
    const user = { id: 'participant' } as never;
    const input = { expectedVersion: 2, evidenceUploadId: '33333333-3333-4333-8333-333333333333' };
    await expect(controller.openTimeout(user, response.matchId, 'request-key', input)).resolves.toEqual(response);
    await expect(controller.attachEvidence(user, response.matchId, 'request-key', input)).resolves.toEqual(response);
    await expect(controller.getDispute(user, response.matchId)).resolves.toEqual(response);
    expect(disputes.openFromTimeout).toHaveBeenCalledWith('participant', response.matchId, input, 'request-key');
    expect(disputes.attachEvidence).toHaveBeenCalledWith('participant', response.matchId, input, 'request-key');
    expect(disputes.getForParticipant).toHaveBeenCalledWith('participant', response.matchId);
    await expect(controller.openTimeout(user, response.matchId, undefined, input))
      .rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  });

  it('preserves a missing dispute as null', async () => {
    const controller = new ResultsController({} as never, {} as never, { getForParticipant: async () => null } as never);
    await expect(controller.getDispute({ id: 'participant' } as never, response.matchId)).resolves.toBeNull();
  });
});

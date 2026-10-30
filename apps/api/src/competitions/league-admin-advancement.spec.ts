/* eslint-disable @typescript-eslint/no-explicit-any -- focused service doubles */
import { jest } from '@jest/globals';
import { ResultsService } from './results.service.js';
import { ResultsController } from './results.controller.js';

function harness() {
  const tx = {};
  const calls: string[] = [];
  const visibility = { requireVisible: jest.fn(async () => 'league'), notFound: () => new Error('not found') };
  const authorization = { requireLeagueAccess: jest.fn(async () => { calls.push('authorize'); }) };
  const receipts = { execute: jest.fn(async (_admin, _operation, _key, work: any) => { calls.push('receipt'); return work(tx); }) };
  const service = new ResultsService({} as any, {} as any, {} as any, {} as any, visibility as any, receipts as any, authorization as any, {} as any);
  jest.spyOn(service, 'lockForOfficialResult').mockImplementation(async () => { calls.push('lock'); });
  jest.spyOn(service as any, 'managerMatch').mockImplementation(async () => { calls.push('match'); return { id: 'match' }; });
  jest.spyOn(service, 'applyAdministratorAdvancement').mockImplementation(async () => { calls.push('apply'); return { winnerParticipantId: 'home', winnerName: '主队' }; });
  return { service, visibility, authorization, receipts, calls, tx };
}
const input = { winnerParticipantId: 'home', expectedVersion: 3, reason: '对方弃权' };
it('authorizes, locks, and records advancement through an administrator receipt bound to the input', async () => {
  const { service, receipts, calls, tx } = harness();
  await expect(service.advanceByLeagueAdmin('admin', 'league', 'cup', 'match', input, 'key')).resolves.toEqual({ winnerParticipantId: 'home', winnerName: '主队' });
  expect(calls).toEqual(['authorize', 'receipt', 'lock', 'match', 'apply']);
  expect(receipts.execute).toHaveBeenCalledWith('admin', 'admin.competition-result.advance:match', 'key', expect.any(Function), input);
  expect(service.applyAdministratorAdvancement).toHaveBeenCalledWith(tx, 'match', input, { adminId: 'admin', leagueId: 'league' });
});
it('rejects cross-league IDs before executing a mutation', async () => {
  const { service, visibility, receipts } = harness();
  visibility.requireVisible.mockResolvedValueOnce('other');
  await expect(service.advanceByLeagueAdmin('admin', 'league', 'cup', 'match', input, 'key')).rejects.toThrow('not found');
  expect(receipts.execute).not.toHaveBeenCalled();
});
it('does not mutate when authorization is denied', async () => {
  const { service, authorization, receipts } = harness();
  authorization.requireLeagueAccess.mockRejectedValueOnce(new Error('forbidden'));
  await expect(service.advanceByLeagueAdmin('admin', 'league', 'cup', 'match', input, 'key')).rejects.toThrow('forbidden');
  expect(receipts.execute).not.toHaveBeenCalled();
});
it('requires an idempotency key at the HTTP boundary', () => {
  const controller = new ResultsController({ advanceByLeagueAdmin: jest.fn() } as any, {} as any);
  expect(() => controller.leagueAdminAdvancement({ id: 'admin' } as any, 'league', 'cup', 'match', undefined, input)).toThrow('Idempotency-Key');
});
it('propagates progression conflicts without reporting success', async () => {
  const { service } = harness();
  jest.mocked(service.applyAdministratorAdvancement).mockRejectedValueOnce(new Error('CUP_RESULT_LOCKED'));
  await expect(service.advanceByLeagueAdmin('admin', 'league', 'cup', 'match', input, 'key')).rejects.toThrow('CUP_RESULT_LOCKED');
});

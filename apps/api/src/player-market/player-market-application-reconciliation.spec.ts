import { jest } from '@jest/globals';
import { expireClosedPlayerApplications } from './player-market-application-reconciliation.js';

describe('transfer-window application expiry', () => {
  it('selects only normal purchases, leaving legacy and current forced bids reviewable', async () => {
    const findMany = jest.fn(async () => []);
    const tx = { playerAcquisitionApplication: { findMany } };
    await expect(expireClosedPlayerApplications(tx as never, {
      leagueId: 'league-1', seasonId: 'season-1', footballPlayerId: 'player-1', at: new Date('2026-10-20T00:00:00Z')
    })).resolves.toBe(0);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: 'NORMAL_PURCHASE', transferWindow: expect.anything() })
    }));
  });
});

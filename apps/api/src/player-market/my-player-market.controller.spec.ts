import { parsePlayerApplicationRequest } from './my-player-market.controller.js';

const normal = {
  seasonId: '11111111-1111-4111-8111-111111111111',
  transferWindowId: '22222222-2222-4222-8222-222222222222',
  footballPlayerId: '33333333-3333-4333-8333-333333333333',
  playerCardId: '44444444-4444-4444-8444-444444444444', type: 'NORMAL_PURCHASE', amountMinor: 500
};

describe('market request compatibility', () => {
  it('keeps legacy normal purchases valid', () => {
    expect(parsePlayerApplicationRequest(normal)).toMatchObject(normal);
  });

  it('returns a clear upgrade error for old forced-offer clients', () => {
    expect(() => parsePlayerApplicationRequest({
      ...normal, type: 'FORCED_TRANSFER', sourceLeagueTeamId: 'team-2',
      ownershipId: 'ownership-1', ownershipVersionSnapshot: 1
    })).toThrow(expect.objectContaining({ code: 'CLIENT_UPGRADE_REQUIRED' }));
  });
});

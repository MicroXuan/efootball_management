import { render, screen } from '@testing-library/react';
import type { AdminApi } from '../lib/api';
import { UpgradeCardDrawer } from './upgrade-card-drawer';

const entry = { id: '11111111-1111-4111-8111-111111111111', leagueId: '22222222-2222-4222-8222-222222222222', leagueTeamId: '33333333-3333-4333-8333-333333333333', playerId: '44444444-4444-4444-8444-444444444444', playerName: '博努奇', currentPlayerCardId: '55555555-5555-4555-8555-555555555555', cardName: '旧卡', maxOverall: 96, salaryRuleVersionId: '66666666-6666-4666-8666-666666666666', salaryMinor: 500, acquiredAt: '2026-09-29T00:00:00.000Z', status: 'ACTIVE' as const, version: 1 };

it('previews the salary impact of a card upgrade and blocks an over-cap result', async () => {
  const request = vi.fn().mockResolvedValue({ items: [{ playerId: entry.playerId, playerName: '博努奇', ownedByTeamId: entry.leagueTeamId, recommendedPlayerCardId: '77777777-7777-4777-8777-777777777777', cards: [{ id: entry.currentPlayerCardId, cardName: '旧卡', imageUrl: null, position: 'CB', overallRating: 87, maxOverall: 96, salaryMinor: 500, recommended: false }, { id: '77777777-7777-4777-8777-777777777777', cardName: '新卡', imageUrl: null, position: 'CB', overallRating: 90, maxOverall: 100, salaryMinor: 900, recommended: true }] }] });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<UpgradeCardDrawer open leagueId={entry.leagueId} seasonId="88888888-8888-4888-8888-888888888888" entry={entry} currentSalaryMinor={1800} salaryCapMinor={2000} api={api} onClose={vi.fn()} onCompleted={vi.fn()} />);
  expect(await screen.findByText('2200/2000')).toBeInTheDocument();
  expect(screen.queryByText(/DT/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认升级' })).toBeDisabled();
});

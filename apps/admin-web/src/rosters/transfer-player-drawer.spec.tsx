import { render, screen } from '@testing-library/react';
import type { AdminApi } from '../lib/api';
import { TransferPlayerDrawer } from './transfer-player-drawer';

it('excludes the current team from transfer targets', () => {
  const entry = { id: '11111111-1111-4111-8111-111111111111', leagueId: '22222222-2222-4222-8222-222222222222', leagueTeamId: '33333333-3333-4333-8333-333333333333', playerId: '44444444-4444-4444-8444-444444444444', playerName: '博努奇', currentPlayerCardId: '55555555-5555-4555-8555-555555555555', cardName: 'Epic', maxOverall: 99, salaryRuleVersionId: '66666666-6666-4666-8666-666666666666', salaryMinor: 700, acquiredAt: '2026-09-29T00:00:00.000Z', status: 'ACTIVE' as const, version: 1 };
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request: vi.fn() };
  render(<TransferPlayerDrawer open entry={entry} seasonId="77777777-7777-4777-8777-777777777777" teams={[{ id: entry.leagueTeamId, name: '原球队' }, { id: '88888888-8888-4888-8888-888888888888', name: '目标球队' }]} api={api} onClose={vi.fn()} onCompleted={vi.fn()} />);
  expect(screen.getByRole('combobox', { name: '目标球队' })).toBeInTheDocument();
  expect(screen.queryByText('原球队')).not.toBeInTheDocument();
});

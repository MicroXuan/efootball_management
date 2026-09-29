import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { RosterPage } from './roster-page';

it('disables operations that are not enabled by the active transfer window', async () => {
  const request = vi.fn().mockResolvedValue({ teamId: '22222222-2222-4222-8222-222222222222', teamName: '巴塞罗那', seasonId: '33333333-3333-4333-8333-333333333333', entries: [], summary: { rosterCount: 0, salaryMinor: 0, salaryCapMinor: 2000 }, operations: { BUY: true, SELL: false, TRANSFER: false, CARD_UPGRADE: true }, activeWindowName: '冬季窗口' });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={['/leagues/11111111-1111-4111-8111-111111111111/teams/22222222-2222-4222-8222-222222222222/roster?seasonId=33333333-3333-4333-8333-333333333333']}><Routes><Route path="/leagues/:leagueId/teams/:teamId/roster" element={<RosterPage api={api} />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('冬季窗口')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '购买球员' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '出售/解约' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '转会' })).toBeDisabled();
});

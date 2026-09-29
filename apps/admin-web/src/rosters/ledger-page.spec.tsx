import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { LedgerPage } from './ledger-page';

it('renders immutable transaction history without edit or delete actions', async () => {
  const request = vi.fn().mockResolvedValue({ items: [{ id: '22222222-2222-4222-8222-222222222222', leagueId: '11111111-1111-4111-8111-111111111111', leagueTeamId: '33333333-3333-4333-8333-333333333333', teamName: '巴塞罗那', rosterTransactionId: null, direction: 'DEBIT', type: 'PLAYER_PURCHASE', amountMinor: 800, note: '购买博努奇', createdAt: '2026-09-29T00:00:00.000Z' }], nextCursor: null });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={['/leagues/11111111-1111-4111-8111-111111111111/ledger']}><Routes><Route path="/leagues/:leagueId/ledger" element={<LedgerPage api={api} />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('购买博努奇')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑|删除/ })).not.toBeInTheDocument();
  expect(screen.getByText('流水记录写入后不可修改或删除')).toBeInTheDocument();
});

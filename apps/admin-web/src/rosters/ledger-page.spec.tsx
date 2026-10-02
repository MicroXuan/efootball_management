import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { LedgerPage } from './ledger-page';

it('renders immutable categorized real-time finance data and management entry points', async () => {
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/teams')) return { items: [], nextCursor: null };
    if (path.endsWith('/transaction-fee-rules')) return { items: [] };
    return { items: [{ id: '22222222-2222-4222-8222-222222222222', leagueId: '11111111-1111-4111-8111-111111111111', leagueTeamId: '33333333-3333-4333-8333-333333333333', teamName: '巴塞罗那', seasonId: null, rosterTransactionId: null, direction: 'DEBIT', type: 'LUXURY_TAX', amountMinor: 800, note: '购买博努奇', createdAt: '2026-09-29T00:00:00.000Z' }], nextCursor: null };
  }) as unknown as AdminApi['request'];
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={['/leagues/11111111-1111-4111-8111-111111111111/ledger']}><Routes><Route path="/leagues/:leagueId/ledger" element={<LedgerPage api={api} />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('购买博努奇')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑|删除/ })).not.toBeInTheDocument();
  expect(screen.getByText('实时数据，非最终结算')).toBeInTheDocument();
  expect(screen.getByText('奢侈税')).toBeInTheDocument();
  expect(screen.getAllByText('历史未归档').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '新增财务项目' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '配置手续费规则' })).toBeInTheDocument();
});

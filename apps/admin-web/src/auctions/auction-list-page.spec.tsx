import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { AuctionListPage } from './auction-list-page';

const leagueId = '11111111-1111-4111-8111-111111111111';

it('shows an actionable empty state and create link', async () => {
  const api = { request: vi.fn().mockResolvedValue({ items: [] }) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions`]}><Routes><Route path="/leagues/:leagueId/auctions" element={<AuctionListPage api={api} />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('还没有球员拍卖')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: '创建拍卖批次' })[0]).toHaveAttribute('href', `/leagues/${leagueId}/auctions/new`);
});

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { AuctionDetailPage } from './auction-detail-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';

it('shows computed result, bid audit, and the non-financial review boundary', async () => {
  const detail = { id: batchId, leagueId, groupBindingId: 'group-1', name: '秋季拍卖', status: 'ACTIVE', currentLotId: 'lot-1', version: 2, startedAt: '2026-10-09T00:00:00.000Z', completedAt: null, cancelledAt: null, createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z', lots: [{ id: 'lot-1', displayOrder: 1, playerId: 'player-1', playerCardId: 'card-1', playerName: '车范根', playerSnapshot: {}, startingPrice: 50, minimumIncrement: 10, status: 'PENDING_REVIEW', currentPrice: 120, currentHighestBidId: 'bid-1', deadlineAt: null, deadlineEpoch: 2, pausedRemainingMs: null, version: 3, bids: [{ id: 'bid-1', leagueTeamId: 'team-1', teamName: '申花', userId: 'user-1', amount: 120, result: 'VALID', rejectionReason: null, wechatMessageId: 'm-1', wechatSortKey: '001', wechatSentAt: '2026-10-09T00:00:01.000Z', receivedAt: '2026-10-09T00:00:01.100Z' }], review: null, startedAt: '2026-10-09T00:00:00.000Z', closedAt: '2026-10-09T00:00:30.000Z', reviewedAt: null }] };
  const api = { request: vi.fn().mockResolvedValue(detail) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/${batchId}`]}><Routes><Route path="/leagues/:leagueId/auctions/:batchId" element={<AuctionDetailPage api={api} />} /></Routes></MemoryRouter>);
  expect((await screen.findAllByText('车范根')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('⭐120⭐').length).toBeGreaterThan(0);
  expect(screen.getByText(/审核只记录结果，不会自动修改资金或阵容/)).toBeInTheDocument();
});

it('reviews pending and no-bid outcomes while the next lot advances automatically', async () => {
  const lotBase = {
    playerSnapshot: {}, startingPrice: 50, minimumIncrement: 10, currentPrice: null,
    currentHighestBidId: null, deadlineAt: null, deadlineEpoch: 1, pausedRemainingMs: null,
    version: 2, bids: [], review: null, startedAt: '2026-10-09T00:00:00.000Z',
    closedAt: '2026-10-09T00:00:30.000Z', reviewedAt: null
  };
  const detail = {
    id: batchId, leagueId, groupBindingId: 'group-1', name: '连续拍卖', status: 'ACTIVE',
    currentLotId: 'lot-3', version: 4, startedAt: '2026-10-09T00:00:00.000Z',
    completedAt: null, cancelledAt: null, createdAt: '2026-10-09T00:00:00.000Z',
    updatedAt: '2026-10-09T00:01:00.000Z',
    lots: [
      {
        ...lotBase, id: 'lot-1', displayOrder: 1, playerId: 'player-1', playerCardId: 'card-1',
        playerName: '车范根', status: 'PENDING_REVIEW', currentPrice: 120,
        currentHighestBidId: 'bid-1', bids: [{
          id: 'bid-1', leagueTeamId: 'team-1', teamName: '申花', userId: 'user-1', amount: 120,
          result: 'VALID', rejectionReason: null, wechatMessageId: 'm-1', wechatSortKey: '001',
          wechatSentAt: '2026-10-09T00:00:01.000Z', receivedAt: '2026-10-09T00:00:01.100Z'
        }]
      },
      {
        ...lotBase, id: 'lot-2', displayOrder: 2, playerId: 'player-2', playerCardId: 'card-2',
        playerName: '唐伯虎', status: 'NO_BID'
      },
      {
        ...lotBase, id: 'lot-3', displayOrder: 3, playerId: 'player-3', playerCardId: 'card-3',
        playerName: '马赛洛', status: 'ACTIVE', deadlineAt: '2026-10-09T00:01:30.000Z', closedAt: null
      }
    ]
  };
  const api = { request: vi.fn().mockResolvedValue(detail) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/${batchId}`]}><Routes><Route path="/leagues/:leagueId/auctions/:batchId" element={<AuctionDetailPage api={api} />} /></Routes></MemoryRouter>);

  expect(await screen.findByText(/当前有 2 位球员等待人工审核/)).toBeInTheDocument();
  expect(screen.getByText(/系统会自动进入下一位或结束批次/)).toBeInTheDocument();
  expect(screen.queryByText(/下一位.*发送/)).not.toBeInTheDocument();
  const noBidReview = screen.getByRole('region', { name: '唐伯虎审核' });
  expect(within(noBidReview).getByRole('radio', { name: '确认流拍' })).toBeInTheDocument();
  expect(within(noBidReview).getByRole('radio', { name: '作废' })).toBeInTheDocument();
  expect(within(noBidReview).queryByRole('radio', { name: '调整结果' })).not.toBeInTheDocument();
  expect(document.getElementById('lot-lot-3')).toHaveClass('is-current');
});

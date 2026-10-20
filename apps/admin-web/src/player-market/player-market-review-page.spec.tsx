import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { PlayerMarketReviewPage } from './player-market-review-page';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const base = {
  id: id(1), leagueId: id(2), seasonId: id(3), transferWindowId: id(4), type: 'NORMAL_PURCHASE',
  applicantTeam: { teamId: id(5), teamNumber: 5, name: '海港竞技', logoUrl: null, ownerAlias: '小宣' },
  playerId: id(6), playerName: '迪格雷戈里奥', playerCard: { playerCardId: id(7), cardName: '意大利精选', imageUrl: null, position: 'GK', maxOverall: 96, salaryMinor: 500 },
  sourceTeam: null, ownershipId: null, ownershipVersionSnapshot: null, amountMinor: 1200, valuationMinorSnapshot: 1000,
  valuationVersionSnapshot: 1, status: 'PENDING', queuePosition: null, firstValidSubmittedAt: '2026-10-14T12:00:00.000Z',
  lastSubmittedAt: '2026-10-14T12:00:00.000Z', reviewedAt: null, reviewReason: null, version: 3,
  events: [{ id: id(8), type: 'AMOUNT_CHANGED', fromStatus: 'PENDING', toStatus: 'PENDING', fromAmountMinor: 1000, toAmountMinor: 1200, actorType: 'USER', actorDisplayName: '小宣', reason: null, createdAt: '2026-10-14T12:02:00.000Z' }]
} as const;

it('shows the normal purchase queue and submits a versioned review', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce({ items: [base], nextCursor: null })
    .mockResolvedValueOnce({ applicationId: base.id, status: 'APPROVED', transactionId: id(30), transactionType: 'BUY', ownershipId: id(31) })
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${id(2)}/player-market?seasonId=${id(3)}`]}><Routes><Route path="/leagues/:leagueId/player-market" element={<PlayerMarketReviewPage api={api} />} /></Routes></MemoryRouter>);

  expect(await screen.findByText('迪格雷戈里奥')).toBeInTheDocument();
  expect(screen.getByText(/1,000.*1,200/)).toBeInTheDocument();
  expect(screen.getByText('普通购买')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '通过申请' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('button', { name: '确认通过' })).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText('审核原因'), '资料完整');
  await userEvent.click(within(dialog).getByRole('button', { name: '确认通过' }));

  expect(request).toHaveBeenNthCalledWith(2, `/v1/admin/player-market-applications/${base.id}/approve`, expect.objectContaining({
    method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }), body: { expectedVersion: 3, reason: '资料完整' }
  }));
  expect(request).toHaveBeenCalledTimes(3);
  expect(request).toHaveBeenNthCalledWith(1, expect.stringContaining('type=NORMAL_PURCHASE'), expect.anything());
});

it('disables review actions behind the forced-transfer queue head', async () => {
  const queued = { ...base, id: id(20), type: 'FORCED_TRANSFER', queuePosition: 2, firstValidSubmittedAt: '2026-10-14T12:01:00.000Z', sourceTeam: { teamId: id(21), teamNumber: 8, name: '成都蓉城', logoUrl: null, ownerAlias: 'Jeremy' }, ownershipId: id(22), ownershipVersionSnapshot: 2 };
  const head = { ...queued, id: id(19), queuePosition: 1, firstValidSubmittedAt: '2026-10-14T12:00:00.000Z' };
  const request = vi.fn().mockResolvedValue({ items: [queued, head], nextCursor: null });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${id(2)}/forced-player-market?seasonId=${id(3)}`]}><Routes><Route path="/leagues/:leagueId/forced-player-market" element={<PlayerMarketReviewPage api={api} />} /></Routes></MemoryRouter>);
  expect(await screen.findAllByText(/强报自 成都蓉城/)).toHaveLength(2);
  expect(request).toHaveBeenCalledWith(expect.stringContaining('type=FORCED_TRANSFER'), expect.anything());
  const buttons = screen.getAllByRole('button', { name: '通过申请' });
  expect(buttons[0]).toBeEnabled();
  expect(buttons[1]).toBeDisabled();
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { ValuationReviewsPage } from './valuation-reviews-page';

it('filters and reviews whole submissions without per-player editing', async () => {
  const item = { id: '22222222-2222-4222-8222-222222222222', windowId: '33333333-3333-4333-8333-333333333333', leagueTeamId: '44444444-4444-4444-8444-444444444444', ruleVersionId: '55555555-5555-4555-8555-555555555555', attemptNumber: 1, status: 'PENDING_REVIEW', submittedAt: '2026-10-02T00:00:00.000Z', reviewedAt: null, reviewReason: null, version: 1, teamName: '海港竞技', windowName: '季前申报', submittedByDisplayName: '小宣', reviewedByDisplayName: null, items: [{ snapshotId: '66666666-6666-4666-8666-666666666666', playerId: '77777777-7777-4777-8777-777777777777', playerName: '测试球员', baseValueMinor: 1000, proposedValueMinor: 1500, minimumAllowedMinor: 800, maximumAllowedMinor: 1200, exceedsRange: true }] };
  const request = vi.fn().mockResolvedValue({ items: [item], nextCursor: null });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={['/leagues/11111111-1111-4111-8111-111111111111/valuation-reviews']}><Routes><Route path="/leagues/:leagueId/valuation-reviews" element={<ValuationReviewsPage api={api} />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('海港竞技')).toBeInTheDocument();
  expect(screen.getByText('待审核')).toBeInTheDocument();
  expect(screen.getByLabelText('审核状态')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑球员|修改球员/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '整批驳回' }));
  expect(screen.getByRole('button', { name: '确认提交' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('审核原因'), '超出规则范围');
  expect(screen.getByRole('button', { name: '确认提交' })).toBeEnabled();
});

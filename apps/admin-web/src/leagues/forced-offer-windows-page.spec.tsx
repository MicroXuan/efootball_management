import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { ForcedOfferWindowsPage } from './forced-offer-windows-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const seasonId = '22222222-2222-4222-8222-222222222222';
const season = { id: seasonId, leagueId, seasonNumber: 1, displayName: 'S1', previousSeasonId: null, isFirstSeason: true, registrationOpensAt: '2026-09-01T00:00:00.000Z', registrationClosesAt: '2026-09-02T00:00:00.000Z', startsAt: '2026-09-03T00:00:00.000Z', endsAt: '2026-10-03T00:00:00.000Z', superCapacity: 23, championCapacity: 18, promotionCount: 4, status: 'IN_PROGRESS', entryCount: 0, approvedEntryCount: 0, version: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
const windowRow = { id: '33333333-3333-4333-8333-333333333333', seasonId, name: '首轮强报', startsAt: '2027-01-01T00:00:00.000Z', endsAt: '2027-01-02T00:00:00.000Z', status: 'UPCOMING', createdByAdminId: leagueId, version: 1, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' };

function renderPage(request: AdminApi['request']) {
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/forced-offer-windows`]}><Routes>
    <Route path="/leagues/:leagueId/forced-offer-windows" element={<ForcedOfferWindowsPage api={api} />} />
  </Routes></MemoryRouter>);
  return api;
}

it('loads a selected season and shows Beijing-time statuses', async () => {
  const request = vi.fn().mockResolvedValueOnce([season]).mockResolvedValueOnce({ items: [windowRow] });
  renderPage(request);
  expect(await screen.findByText('首轮强报')).toBeInTheDocument();
  expect(screen.getByText('未开始')).toBeInTheDocument();
  expect(screen.getAllByText(/北京时间/).length).toBeGreaterThan(0);
  expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/seasons/${seasonId}/forced-offer-windows`, expect.any(Object));
});

it('blocks inverted dates and submits a valid new period with Beijing-time conversion', async () => {
  const request = vi.fn().mockResolvedValueOnce([season]).mockResolvedValueOnce({ items: [] })
    .mockResolvedValueOnce(windowRow).mockResolvedValueOnce({ items: [windowRow] });
  renderPage(request);
  await screen.findByText('暂无强报期');
  await userEvent.type(screen.getByLabelText('强报期名称'), '首轮强报');
  await userEvent.type(screen.getByLabelText('开始时间'), '2027-01-01T08:00');
  await userEvent.type(screen.getByLabelText('结束时间'), '2027-01-01T07:00');
  expect(screen.getByRole('button', { name: '创建强报期' })).toBeDisabled();
  await userEvent.clear(screen.getByLabelText('结束时间'));
  await userEvent.type(screen.getByLabelText('结束时间'), '2027-01-02T08:00');
  await userEvent.click(screen.getByRole('button', { name: '创建强报期' }));
  expect(request).toHaveBeenCalledWith(expect.stringContaining('/forced-offer-windows'), expect.objectContaining({
    method: 'POST', body: expect.objectContaining({ startsAt: '2027-01-01T00:00:00.000Z', endsAt: '2027-01-02T00:00:00.000Z' }),
  }));
});

it('shows a load error and a retry action', async () => {
  const request = vi.fn().mockResolvedValueOnce([season]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [] });
  renderPage(request);
  expect(await screen.findByText('强报期加载失败')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  expect(await screen.findByText('暂无强报期')).toBeInTheDocument();
});

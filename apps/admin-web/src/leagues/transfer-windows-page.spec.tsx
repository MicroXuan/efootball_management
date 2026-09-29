import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { TransferWindowsPage } from './transfer-windows-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const seasonId = '22222222-2222-4222-8222-222222222222';
const season = { id: seasonId, leagueId, seasonNumber: 1, displayName: 'S1', previousSeasonId: null, isFirstSeason: true, registrationOpensAt: '2026-09-01T00:00:00.000Z', registrationClosesAt: '2026-09-02T00:00:00.000Z', startsAt: '2026-09-03T00:00:00.000Z', endsAt: '2026-10-03T00:00:00.000Z', superCapacity: 23, championCapacity: 18, promotionCount: 4, status: 'IN_PROGRESS', entryCount: 0, approvedEntryCount: 0, version: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
const window = { id: '33333333-3333-4333-8333-333333333333', seasonId, name: '首轮窗口', startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-09-20T00:00:00.000Z', allowBuy: true, allowSell: true, allowTransfer: true, allowCardUpgrade: true, createdByAdminId: '44444444-4444-4444-8444-444444444444', version: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };

it('blocks a locally overlapping transfer window before submission', async () => {
  const request = vi.fn().mockResolvedValueOnce([season]).mockResolvedValueOnce({ items: [window] });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/transfer-windows`]}><Routes><Route path="/leagues/:leagueId/transfer-windows" element={<TransferWindowsPage api={api} />} /></Routes></MemoryRouter>);
  await screen.findByText('首轮窗口');
  await userEvent.type(screen.getByLabelText('开始时间'), '2026-09-15T00:00');
  await userEvent.type(screen.getByLabelText('结束时间'), '2026-09-25T00:00');
  expect(await screen.findByText('该时间段与已有转会窗口重叠')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '创建窗口' })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(2);
});

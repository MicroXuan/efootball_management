import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { NominationWindowsPage } from './nomination-windows-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const seasonId = '22222222-2222-4222-8222-222222222222';
const season = { id: seasonId, leagueId, seasonNumber: 1, displayName: 'S1', previousSeasonId: null, isFirstSeason: true, registrationOpensAt: '2026-09-01T00:00:00.000Z', registrationClosesAt: '2026-09-02T00:00:00.000Z', startsAt: '2026-09-03T00:00:00.000Z', endsAt: '2026-10-30T00:00:00.000Z', superCapacity: 23, championCapacity: 18, promotionCount: 4, status: 'IN_PROGRESS', entryCount: 0, approvedEntryCount: 0, version: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };

it('requires a positive per-team limit and valid dates before creating a nomination window', async () => {
  const request = vi.fn().mockResolvedValueOnce([season]).mockResolvedValueOnce({ items: [] });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/nomination-windows`]}><Routes><Route path="/leagues/:leagueId/nomination-windows" element={<NominationWindowsPage api={api} />} /></Routes></MemoryRouter>);
  const create = await screen.findByRole('button', { name: '创建提名期' });
  expect(create).toBeDisabled();
  await userEvent.type(screen.getByLabelText('开始时间'), '2026-10-20T10:00');
  await userEvent.type(screen.getByLabelText('结束时间'), '2026-10-21T10:00');
  expect(create).toBeDisabled();
  await userEvent.type(screen.getByLabelText('每队提名名额'), '3');
  expect(create).toBeEnabled();
  expect(request).toHaveBeenCalledTimes(2);
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { SeasonsPage } from './seasons-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const firstId = '22222222-2222-4222-8222-222222222222';
const secondId = '33333333-3333-4333-8333-333333333333';
const now = '2026-09-01T00:00:00.000Z';
const season = (id: string, number: number, displayName: string) => ({
  id, leagueId, seasonNumber: number, displayName, previousSeasonId: null, isFirstSeason: number === 1,
  registrationOpensAt: now, registrationClosesAt: '2026-09-02T00:00:00.000Z',
  startsAt: '2026-09-03T00:00:00.000Z', endsAt: '2026-10-03T00:00:00.000Z',
  superCapacity: 23, championCapacity: 18, promotionCount: 4, status: 'DRAFT' as const,
  entryCount: 0, approvedEntryCount: 0, version: 1, createdAt: now, updatedAt: now
});
const league = {
  id: leagueId, name: 'CELL 联赛', shortName: 'CELL', description: '', logoUrl: null,
  status: 'ACTIVE' as const, edition: 'INTERNATIONAL' as const,
  defaultSuperCapacity: 23, defaultChampionCapacity: 18, defaultPromotionCount: 4,
  currentSeason: { id: firstId, displayName: 'S1', status: 'DRAFT' as const, approvedEntryCount: 0 },
  capabilities: { canManage: true, canCreateSeason: true }, version: 5, createdAt: now, updatedAt: now
};
const team = {
  id: '44444444-4444-4444-8444-444444444444', leagueId,
  ownerUserId: '55555555-5555-4555-8555-555555555555', ownerPublicUserNo: '000123', teamNumber: 1,
  name: '上海申花', shortName: '申花', logoUrl: null, status: 'ACTIVE' as const,
  activePlayerCount: 0, salaryTotalMinor: 0, salaryCapMinor: 0, rosterStatus: 'COMPLIANT' as const,
  version: 1, createdAt: now, updatedAt: now
};

it('marks the current season and switches it with the league version', async () => {
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path === `/v1/admin/leagues/${leagueId}/workspace`) return league;
    if (path === `/v1/admin/leagues/${leagueId}/seasons` && !options?.method) return { items: [season(firstId, 1, 'S1'), season(secondId, 2, 'S2')], nextCursor: null };
    if (path === `/v1/admin/leagues/${leagueId}/teams`) return { items: [team], nextCursor: null };
    if (path.endsWith(`/${secondId}/set-current`)) return { leagueId, currentSeasonId: secondId, version: 6 };
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/seasons`]}><Routes>
    <Route path="/leagues/:leagueId/seasons" element={<SeasonsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  expect(await screen.findByText('当前赛季')).toBeInTheDocument();
  const s2Row = screen.getByText('S2').closest('tr') as HTMLElement;
  await userEvent.click(within(s2Row).getByRole('button', { name: '设为当前赛季' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/seasons/${secondId}/set-current`,
    expect.objectContaining({ method: 'POST', body: { expectedVersion: 5 } })
  ));
});

it('does not preselect every existing team when enrolling teams', async () => {
  const request = vi.fn(async (path: string) => {
    if (path === `/v1/admin/leagues/${leagueId}/workspace`) return league;
    if (path === `/v1/admin/leagues/${leagueId}/seasons`) return { items: [season(firstId, 1, 'S1')], nextCursor: null };
    if (path === `/v1/admin/leagues/${leagueId}/teams`) return { items: [team], nextCursor: null };
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/seasons`]}><Routes>
    <Route path="/leagues/:leagueId/seasons" element={<SeasonsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  const checkbox = await screen.findByRole('checkbox', { name: /上海申花/ });
  expect(checkbox).not.toBeChecked();
  expect(screen.getByRole('button', { name: '加入当前赛季' })).toBeDisabled();
});

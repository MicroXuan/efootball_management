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
  entryCount: 0, approvedEntryCount: 0, enrolledLeagueTeamIds: [] as string[], version: 1, createdAt: now, updatedAt: now
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
    if (path === `/v1/leagues/${leagueId}`) return league;
    if (path === `/v1/admin/leagues/${leagueId}/seasons` && !options?.method) return { items: [season(firstId, 1, 'S1'), season(secondId, 2, 'S2')], nextCursor: null };
    if (path === `/v1/admin/leagues/${leagueId}/teams`) return { items: [team], nextCursor: null };
    if (path.endsWith(`/${secondId}/set-current`)) return { leagueId, currentSeasonId: secondId, version: 6 };
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/seasons`]}><Routes>
    <Route path="/leagues/:leagueId/seasons" element={<SeasonsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  expect((await screen.findAllByText('当前赛季')).length).toBeGreaterThan(0);
  expect(request).toHaveBeenCalledWith(
    `/v1/leagues/${leagueId}`,
    expect.objectContaining({ skipAuth: true })
  );
  const s2Row = screen.getByText('S2').closest('tr') as HTMLElement;
  await userEvent.click(within(s2Row).getByRole('button', { name: '设为当前赛季' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/seasons/${secondId}/set-current`,
    expect.objectContaining({ method: 'POST', body: { expectedVersion: 5 } })
  ));
});

it('renames a current non-draft season without exposing locked timeline fields', async () => {
  const opened = { ...season(firstId, 1, '经营验收赛季'), status: 'IN_PROGRESS' as const };
  const openedLeague = {
    ...league,
    currentSeason: { ...league.currentSeason, displayName: opened.displayName, status: 'IN_PROGRESS' as const },
  };
  const request = vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (path === `/v1/leagues/${leagueId}`) return openedLeague;
    if (path === `/v1/admin/leagues/${leagueId}/seasons` && !options?.method) {
      return { items: [opened], nextCursor: null };
    }
    if (path === `/v1/admin/leagues/${leagueId}/teams`) return { items: [team], nextCursor: null };
    if (path === `/v1/admin/leagues/${leagueId}/seasons/${firstId}` && options?.method === 'PATCH') {
      return { ...opened, displayName: '经营正式赛季', version: 2 };
    }
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/seasons`]}><Routes>
    <Route path="/leagues/:leagueId/seasons" element={<SeasonsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  const row = (await screen.findByRole('cell', { name: '经营验收赛季' })).closest('tr') as HTMLElement;
  await userEvent.click(within(row).getByRole('button', { name: '修改名称' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('修改赛季名称')).toBeInTheDocument();
  const input = within(dialog).getByLabelText('新赛季名称');
  await userEvent.clear(input);
  await userEvent.type(input, '经营正式赛季');
  expect(within(dialog).queryByLabelText('赛季开始')).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: '保存名称' }));

  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/seasons/${firstId}`,
    expect.objectContaining({
      method: 'PATCH',
      body: { displayName: '经营正式赛季', expectedVersion: 1 },
    }),
  ));
});

it('keeps the season form hidden until the top-level create action is used', async () => {
  const request = vi.fn(async (path: string) => {
    if (path === `/v1/leagues/${leagueId}`) return league;
    if (path === `/v1/admin/leagues/${leagueId}/seasons`) return { items: [season(firstId, 1, 'S1')], nextCursor: null };
    if (path === `/v1/admin/leagues/${leagueId}/teams`) return { items: [team], nextCursor: null };
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/seasons`]}><Routes>
    <Route path="/leagues/:leagueId/seasons" element={<SeasonsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  await screen.findByRole('heading', { name: 'S1' });
  expect(screen.queryByLabelText('赛季名称')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '新建赛季' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('新建赛季')).toBeInTheDocument();
  expect(screen.getByLabelText('赛季名称')).toBeInTheDocument();
});

it('makes the current season transition the primary action', async () => {
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path === `/v1/leagues/${leagueId}`) return league;
    if (path === `/v1/admin/leagues/${leagueId}/seasons` && !options?.method) return { items: [season(firstId, 1, 'S1')], nextCursor: null };
    if (path === `/v1/admin/leagues/${leagueId}/teams`) return { items: [team], nextCursor: null };
    if (path.endsWith(`/${firstId}/open-registration`)) return { ...season(firstId, 1, 'S1'), status: 'REGISTRATION_OPEN', version: 2 };
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/seasons`]}><Routes>
    <Route path="/leagues/:leagueId/seasons" element={<SeasonsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  expect(await screen.findByRole('heading', { name: 'S1' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '开放报名' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/seasons/${firstId}/open-registration`,
    expect.objectContaining({ method: 'POST', body: { expectedVersion: 1 } })
  ));
  expect(screen.getByRole('list', { name: '赛季进程' })).toBeInTheDocument();
});

it('shows only teams not yet enrolled inside the add-team dialog', async () => {
  const secondTeam = { ...team, id: '66666666-6666-4666-8666-666666666666', name: '北京国安', shortName: '国安', teamNumber: 2 };
  const current = { ...season(firstId, 1, 'S1'), approvedEntryCount: 1, enrolledLeagueTeamIds: [team.id] };
  const request = vi.fn(async (path: string) => {
    if (path === `/v1/leagues/${leagueId}`) return { ...league, currentSeason: { ...league.currentSeason, approvedEntryCount: 1 } };
    if (path === `/v1/admin/leagues/${leagueId}/seasons`) return { items: [current], nextCursor: null };
    if (path === `/v1/admin/leagues/${leagueId}/teams`) return { items: [team, secondTeam], nextCursor: null };
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/seasons`]}><Routes>
    <Route path="/leagues/:leagueId/seasons" element={<SeasonsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  await userEvent.click(await screen.findByRole('button', { name: '添加球队' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('添加球队')).toBeInTheDocument();
  expect(within(dialog).queryByText(/上海申花/)).not.toBeInTheDocument();
  expect(within(dialog).getByRole('checkbox', { name: /北京国安/ })).not.toBeChecked();
});

it('does not offer more team enrollment after the roster is confirmed', async () => {
  const confirmed = { ...season(firstId, 1, 'S1'), status: 'ALLOCATION_REVIEW' as const };
  const request = vi.fn(async (path: string) => {
    if (path === `/v1/leagues/${leagueId}`) return { ...league, currentSeason: { ...league.currentSeason, status: 'ALLOCATION_REVIEW' as const } };
    if (path === `/v1/admin/leagues/${leagueId}/seasons`) return { items: [confirmed], nextCursor: null };
    if (path === `/v1/admin/leagues/${leagueId}/teams`) return { items: [team], nextCursor: null };
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/seasons`]}><Routes>
    <Route path="/leagues/:leagueId/seasons" element={<SeasonsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  expect(await screen.findByText('名单已确认，不能继续添加球队')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '添加球队' })).not.toBeInTheDocument();
});

it('offers a clear next action when no current season exists', async () => {
  const request = vi.fn(async (path: string) => {
    if (path === `/v1/leagues/${leagueId}`) return { ...league, currentSeason: null };
    if (path === `/v1/admin/leagues/${leagueId}/seasons`) return { items: [], nextCursor: null };
    if (path === `/v1/admin/leagues/${leagueId}/teams`) return { items: [], nextCursor: null };
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/seasons`]}><Routes>
    <Route path="/leagues/:leagueId/seasons" element={<SeasonsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  await userEvent.click(await screen.findByRole('button', { name: '创建首个赛季' }));
  expect(screen.getByRole('dialog', { name: '新建赛季' })).toBeInTheDocument();
});

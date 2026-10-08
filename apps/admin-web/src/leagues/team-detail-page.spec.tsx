import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { ApiError } from '../lib/api';
import { TeamDetailPage } from './team-detail-page';

const leagueId = '22222222-2222-4222-8222-222222222222';
const teamId = '33333333-3333-4333-8333-333333333333';
const detail = (name: string, version: number) => ({
  id: teamId, leagueId, ownerUserId: '44444444-4444-4444-8444-444444444444', ownerPublicUserNo: '000123',
  ownerDisplayName: '小宣', ownerAlias: 'tidus', catalogTeamId: '55555555-5555-4555-8555-555555555555',
  teamNumber: 0, name, shortName: '巴萨', logoUrl: null, status: 'ACTIVE' as const,
  rosterStatus: 'COMPLIANT' as const, activePlayerCount: 0, salaryTotalMinor: 0, salaryCapMinor: 0,
  shellValueMinor: 25000,
  defaultGameAccountId: null, participatingSeasonCount: 0, version,
  createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z'
});

function renderPage(request: ReturnType<typeof vi.fn>, hash = '') {
  const api: AdminApi = {
    restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request
  };
  return render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/teams/${teamId}${hash}`]}><Routes>
    <Route path="/leagues/:leagueId/teams/:teamId" element={<TeamDetailPage api={api} />} />
  </Routes></MemoryRouter>);
}

it('separates overview, roster, settings, and shell management without an archive control', async () => {
  const request = vi.fn().mockResolvedValue(detail('巴塞罗那', 1));
  renderPage(request);

  expect(await screen.findByRole('heading', { name: '球队概览' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '阵容管理' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '球队设置' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '队壳管理' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '管理阵容' })).toHaveAttribute(
    'href',
    `/leagues/${leagueId}/teams/${teamId}/roster`
  );
  expect(screen.queryByLabelText('球队状态')).not.toBeInTheDocument();
  expect(screen.queryByText('归档')).not.toBeInTheDocument();
});

it('scrolls to the requested team management section after details load', async () => {
  const scrollIntoView = vi.fn();
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  try {
    renderPage(vi.fn().mockResolvedValue(detail('巴塞罗那', 1)), '#team-shell');

    expect(await screen.findByRole('heading', { name: '队壳管理' })).toBeInTheDocument();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }));
  } finally {
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: originalScrollIntoView });
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  }
});

it('saves team settings without changing the team lifecycle status', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(detail('巴塞罗那', 1))
    .mockResolvedValueOnce({ ...detail('巴塞罗那', 2), ownerAlias: '新称呼' });
  renderPage(request);

  const alias = await screen.findByLabelText('联赛称呼');
  await userEvent.clear(alias);
  await userEvent.type(alias, '新称呼');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(request).toHaveBeenNthCalledWith(2, `/v1/admin/leagues/${leagueId}/teams/${teamId}`, expect.objectContaining({
    method: 'PATCH',
    body: { teamNumber: 0, ownerAlias: '新称呼', shellValueMinor: 25000, expectedVersion: 1 }
  }));
});

it('refreshes current data after an optimistic-version conflict', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(detail('旧名称', 1))
    .mockRejectedValueOnce(new ApiError({ status: 409, code: 'VERSION_CONFLICT' }))
    .mockResolvedValueOnce(detail('其他管理员的新名称', 2));
  renderPage(request);

  const alias = await screen.findByLabelText('联赛称呼');
  await userEvent.clear(alias);
  await userEvent.type(alias, '我的新称呼');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('数据已被其他管理员更新');
  await waitFor(() => expect(screen.getByLabelText('联赛称呼')).toHaveValue('tidus'));
  expect(request).toHaveBeenNthCalledWith(2, `/v1/admin/leagues/${leagueId}/teams/${teamId}`, expect.objectContaining({
    method: 'PATCH', body: expect.objectContaining({ expectedVersion: 1 })
  }));
});

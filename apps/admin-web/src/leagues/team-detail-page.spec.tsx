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
  ownerDisplayName: '小宣', teamNumber: 0, name, shortName: '巴萨', logoUrl: null, status: 'ACTIVE' as const,
  rosterStatus: 'COMPLIANT' as const, activePlayerCount: 0, salaryTotalMinor: 0, salaryCapMinor: 0,
  defaultGameAccountId: null, participatingSeasonCount: 0, version,
  createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z'
});

it('refreshes current data after an optimistic-version conflict', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(detail('旧名称', 1))
    .mockRejectedValueOnce(new ApiError({ status: 409, code: 'VERSION_CONFLICT' }))
    .mockResolvedValueOnce(detail('其他管理员的新名称', 2));
  const api: AdminApi = {
    restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request
  };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/teams/${teamId}`]}><Routes>
    <Route path="/leagues/:leagueId/teams/:teamId" element={<TeamDetailPage api={api} />} />
  </Routes></MemoryRouter>);

  const name = await screen.findByLabelText('球队名称');
  await userEvent.clear(name);
  await userEvent.type(name, '我的新名称');
  await userEvent.click(screen.getByRole('button', { name: '保存球队' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('数据已被其他管理员更新');
  await waitFor(() => expect(screen.getByLabelText('球队名称')).toHaveValue('其他管理员的新名称'));
  expect(request).toHaveBeenNthCalledWith(2, `/v1/admin/leagues/${leagueId}/teams/${teamId}`, expect.objectContaining({
    method: 'PATCH', body: expect.objectContaining({ expectedVersion: 1 })
  }));
});

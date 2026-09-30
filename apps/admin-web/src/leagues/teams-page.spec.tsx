import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { ApiError } from '../lib/api';
import { TeamsPage } from './teams-page';

const leagueId = '22222222-2222-4222-8222-222222222222';
const userId = '44444444-4444-4444-8444-444444444444';

function renderPage(request: AdminApi['request']) {
  const api: AdminApi = {
    restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request
  };
  return render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/teams`]}><Routes>
    <Route path="/leagues/:leagueId/teams" element={<TeamsPage api={api} />} />
  </Routes></MemoryRouter>);
}

describe('league teams page', () => {
  it('renders the empty state and requires exact six-digit lookup before creation', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ id: userId, publicUserNo: '000123', displayName: '小宣', avatarUrl: null });
    renderPage(request);

    expect(await screen.findByText('暂无球队')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('用户编号'), '000123');
    await userEvent.click(screen.getByRole('button', { name: '查找用户' }));

    expect(await screen.findByText('小宣')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/users/000123`, expect.any(Object));
  });

  it('keeps owner, team number, and team name separate and reports duplicate numbers', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ id: userId, publicUserNo: '000123', displayName: '小宣', avatarUrl: null })
      .mockRejectedValueOnce(new ApiError({ status: 409, code: 'LEAGUE_TEAM_NUMBER_ALREADY_EXISTS' }));
    renderPage(request);
    await screen.findByText('暂无球队');
    await userEvent.type(screen.getByLabelText('用户编号'), '000123');
    await userEvent.click(screen.getByRole('button', { name: '查找用户' }));
    await screen.findByText('小宣');
    await userEvent.type(screen.getByLabelText('球队编号'), '0');
    await userEvent.type(screen.getByLabelText('球队名称'), '巴塞罗那-小宣');
    await userEvent.type(screen.getByLabelText('球队简称'), '巴萨');
    await userEvent.click(screen.getByRole('button', { name: '创建球队' }));

    expect(await screen.findByText('球队编号已被占用，请选择其他编号')).toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith(`/v1/admin/leagues/${leagueId}/teams`, expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ ownerUserId: userId, teamNumber: 0, name: '巴塞罗那-小宣', shortName: '巴萨' })
    }));
    expect(request.mock.calls.at(-1)?.[1]?.body).not.toHaveProperty('defaultGameAccountId');
  });

  it('explains that a current season must be selected before binding', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ id: userId, publicUserNo: '000123', displayName: '小宣', avatarUrl: null })
      .mockRejectedValueOnce(new ApiError({ status: 409, code: 'LEAGUE_CURRENT_SEASON_REQUIRED' }));
    renderPage(request);
    await screen.findByText('暂无球队');
    await userEvent.type(screen.getByLabelText('用户编号'), '000123');
    await userEvent.click(screen.getByRole('button', { name: '查找用户' }));
    await screen.findByText('小宣');
    await userEvent.type(screen.getByLabelText('球队编号'), '8');
    await userEvent.type(screen.getByLabelText('球队名称'), '测试球队');
    await userEvent.type(screen.getByLabelText('球队简称'), '测试');
    await userEvent.click(screen.getByRole('button', { name: '创建球队' }));

    expect(await screen.findByText('请先在赛季管理中设置当前赛季，再绑定球队')).toBeInTheDocument();
  });

  it('shows a recoverable loading error', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], nextCursor: null });
    renderPage(request);
    expect(await screen.findByRole('alert')).toHaveTextContent('球队列表加载失败');
    await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('暂无球队')).toBeInTheDocument();
  });

  it('reuses the same idempotency key when a failed create is retried unchanged', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ id: userId, publicUserNo: '000123', displayName: '小宣', avatarUrl: null })
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockRejectedValueOnce(new Error('network timeout'));
    renderPage(request);
    await screen.findByText('暂无球队');
    await userEvent.type(screen.getByLabelText('用户编号'), '000123');
    await userEvent.click(screen.getByRole('button', { name: '查找用户' }));
    await screen.findByText('小宣');
    await userEvent.type(screen.getByLabelText('球队编号'), '7');
    await userEvent.type(screen.getByLabelText('球队名称'), '测试球队');
    await userEvent.type(screen.getByLabelText('球队简称'), '测试');

    await userEvent.click(screen.getByRole('button', { name: '创建球队' }));
    await screen.findByText('球队创建失败，请稍后重试');
    await userEvent.click(screen.getByRole('button', { name: '创建球队' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4));

    const firstKey = request.mock.calls[2]?.[1]?.headers?.['Idempotency-Key'];
    const retryKey = request.mock.calls[3]?.[1]?.headers?.['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    expect(retryKey).toBe(firstKey);
  });
});

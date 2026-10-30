import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { MobileWorkbench } from './mobile-workbench';

const identity = { admin: { id: 'admin' }, platformAdmin: false, leagueGrants: [{ leagueId: 'l', leagueName: '测试联赛' }, { leagueId: 'other', leagueName: '另一联赛' }] };
vi.mock('../auth/admin-session', () => ({ useAdminSession: () => ({ identity, logout: vi.fn() }) }));
function renderPage(request: ReturnType<typeof vi.fn>, path = '/mobile/l/matches') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/mobile/:leagueId/:tab" element={<MobileWorkbench api={{ request } as unknown as AdminApi} />} /></Routes></MemoryRouter>);
}
it('blocks ungranted league URLs before fetching league records', async () => {
  const request = vi.fn(); renderPage(request, '/mobile/forbidden/matches');
  await screen.findByText('你没有此联赛的管理权限'); expect(request).not.toHaveBeenCalled();
});
it('shows a retryable schedule failure instead of reporting zero matches', async () => {
  const request = vi.fn().mockRejectedValue(new Error('offline')); renderPage(request);
  await screen.findByText('赛季加载失败，请重试。');
  expect(screen.queryByText('暂无已发布赛程')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
});
it('switching leagues removes the old league data while the new request is pending', async () => {
  const request = vi.fn(async (path: string) => {
    if (path.includes('/other/')) return new Promise(() => {});
    if (path.endsWith('/seasons')) return { items: [], nextCursor: null };
    if (path.endsWith('/transfer-proposals')) return { items: [{ id: 'p', playerName: '旧联赛球员', sourceTeamName: '甲队', targetTeamName: '乙队', amountMinor: 100, status: 'PENDING_ADMIN' }] };
    throw new Error(path);
  });
  renderPage(request, '/mobile/l/transfers');
  await screen.findByText('旧联赛球员');
  await userEvent.selectOptions(screen.getByLabelText('管理联赛'), 'other');
  expect(screen.queryByText('旧联赛球员')).not.toBeInTheDocument();
});

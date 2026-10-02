import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../lib/api';
import { AuditPage } from './audit-page';

it('renders audit history as a Chinese six-column business view with technical details on demand', async () => {
  const request = vi.fn().mockResolvedValue([{
    id: '11111111-1111-4111-8111-111111111111', actorAdminId: '22222222-2222-4222-8222-222222222222',
    actorDisplayName: '小宣', leagueId: '33333333-3333-4333-8333-333333333333', leagueName: 'CELL 联赛',
    action: 'admin.league-season.set-current', resourceType: 'League', resourceId: '33333333-3333-4333-8333-333333333333',
    subjectDisplayName: 'S2', reason: null,
    metadata: { newSeasonId: '44444444-4444-4444-8444-444444444444', version: 2 }, createdAt: '2026-09-29T00:00:00.000Z'
  }]);
  render(<AuditPage api={{ request } as unknown as AdminApi} />);

  expect(await screen.findByText('设置当前赛季')).toBeInTheDocument();
  for (const heading of ['时间', '操作人', '具体操作', '影响对象', '结果', '查看详情']) {
    expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
  }
  expect(screen.getByText('平台管理员“小宣”将 CELL 联赛的当前赛季设置为“S2”')).toBeInTheDocument();
  expect(screen.queryByText('admin.league-season.set-current')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '查看详情' }));
  expect(await screen.findByText('admin.league-season.set-current')).toBeInTheDocument();
  expect(screen.getByText('44444444-4444-4444-8444-444444444444')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑|删除/ })).not.toBeInTheDocument();
});

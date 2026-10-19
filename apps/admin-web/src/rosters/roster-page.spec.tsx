import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { RosterPage } from './roster-page';

it('disables operations that are not enabled by the active transfer window', async () => {
  const seasonId = '33333333-3333-4333-8333-333333333333';
  const request = vi.fn(async (path: string) => path.includes('roster-seasons')
    ? [{ id: seasonId, displayName: '2026 秋季赛' }]
    : path.endsWith('/teams')
      ? { items: [], nextCursor: null }
      : { teamId: '22222222-2222-4222-8222-222222222222', teamName: '巴塞罗那', seasonId, entries: [], summary: { rosterCount: 0, salaryMinor: 0, salaryCapMinor: 2000 }, operations: { BUY: true, SELL: false, TRANSFER: false, CARD_UPGRADE: true }, activeWindowName: '冬季窗口' }) as unknown as AdminApi['request'];
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={['/leagues/11111111-1111-4111-8111-111111111111/teams/22222222-2222-4222-8222-222222222222/roster?seasonId=33333333-3333-4333-8333-333333333333']}><Routes><Route path="/leagues/:leagueId/teams/:teamId/roster" element={<RosterPage api={api} />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('冬季窗口')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '购买球员' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '出售/解约' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '转会' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: '选择赛季' })).toBeInTheDocument();
  expect(screen.getByText('2026 秋季赛')).toBeInTheDocument();
  expect(screen.queryByText(seasonId)).not.toBeInTheDocument();
});

it('explains which league settings block player purchases and links to each fix', async () => {
  const leagueId = '11111111-1111-4111-8111-111111111111';
  const seasonId = '33333333-3333-4333-8333-333333333333';
  const request = vi.fn(async (path: string) => path.includes('roster-seasons')
    ? [{ id: seasonId, displayName: 'S1 新赛季' }]
    : path.endsWith('/teams')
      ? { items: [], nextCursor: null }
      : { teamId: '22222222-2222-4222-8222-222222222222', teamName: '阿哈哈', seasonId, entries: [], summary: { rosterCount: 0, salaryMinor: 0, salaryCapMinor: 0 }, operations: { BUY: false, SELL: false, TRANSFER: false, CARD_UPGRADE: false }, activeWindowName: null }) as unknown as AdminApi['request'];
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/teams/22222222-2222-4222-8222-222222222222/roster?seasonId=${seasonId}`]}><Routes><Route path="/leagues/:leagueId/teams/:teamId/roster" element={<RosterPage api={api} />} /></Routes></MemoryRouter>);

  expect(await screen.findByRole('alert')).toHaveTextContent('尚未配置生效的工资规则');
  expect(screen.getByRole('alert')).toHaveTextContent('当前没有开放的购买窗口');
  expect(screen.getByRole('link', { name: '配置工资规则' })).toHaveAttribute('href', `/leagues/${leagueId}/salary-rules`);
  expect(screen.getByRole('link', { name: '设置转会窗口' })).toHaveAttribute('href', `/leagues/${leagueId}/transfer-windows`);
  expect(screen.getByRole('button', { name: '购买球员' })).toBeDisabled();
});

it('shows clear Chinese player states and sends a reasoned lifecycle update', async () => {
  const entry = {
    id: '44444444-4444-4444-8444-444444444444', leagueId: '11111111-1111-4111-8111-111111111111',
    leagueTeamId: '22222222-2222-4222-8222-222222222222', playerId: '55555555-5555-4555-8555-555555555555',
    playerName: '保罗·马尔蒂尼', currentPlayerCardId: '66666666-6666-4666-8666-666666666666',
    cardName: '传奇', maxOverall: 99, dtRating: 99,
    salaryRuleVersionId: '77777777-7777-4777-8777-777777777777', salaryMinor: 800,
    acquiredAt: '2026-09-15T00:00:00.000Z', status: 'ACTIVE' as const, version: 1
  };
  const request = vi.fn(async (path: string) => {
    if (path.includes('roster-seasons')) return [{
      id: '33333333-3333-4333-8333-333333333333', leagueId: entry.leagueId, seasonNumber: 1,
      displayName: 'S1', status: 'ACTIVE', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z'
    }];
    if (path.endsWith('/teams')) return { items: [], nextCursor: null };
    if (path === '/v1/admin/roster/lifecycle-status') return { ...entry, status: 'DISAPPEARED', version: 2 };
    return { teamId: entry.leagueTeamId, teamName: '传奇队', seasonId: '33333333-3333-4333-8333-333333333333', entries: [entry], summary: { rosterCount: 1, salaryMinor: 800, salaryCapMinor: 2000 }, operations: { BUY: true, SELL: true, TRANSFER: true, CARD_UPGRADE: true }, activeWindowName: '夏季窗口' };
  }) as unknown as AdminApi['request'];
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={['/leagues/11111111-1111-4111-8111-111111111111/teams/22222222-2222-4222-8222-222222222222/roster?seasonId=33333333-3333-4333-8333-333333333333']}><Routes><Route path="/leagues/:leagueId/teams/:teamId/roster" element={<RosterPage api={api} />} /></Routes></MemoryRouter>);

  expect(await screen.findByText('有效')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio'));
  await userEvent.click(screen.getByRole('button', { name: '标记消失' }));
  await userEvent.type(screen.getByLabelText('状态变更原因'), '游戏数据库暂时移除');
  await userEvent.click(screen.getByRole('button', { name: '确认更新' }));

  expect(request).toHaveBeenCalledWith('/v1/admin/roster/lifecycle-status', expect.objectContaining({
    method: 'POST', body: expect.objectContaining({ status: 'DISAPPEARED', reason: '游戏数据库暂时移除', expectedVersion: 1 })
  }));
});

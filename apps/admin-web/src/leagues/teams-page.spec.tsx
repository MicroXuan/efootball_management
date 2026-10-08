import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { ApiError } from '../lib/api';
import { filterLeagueTeams, TeamsPage } from './teams-page';
import type { LeagueTeamSummary } from '@efm/contracts';

const leagueId = '22222222-2222-4222-8222-222222222222';
const userId = '44444444-4444-4444-8444-444444444444';
const baseTeam: LeagueTeamSummary = {
  id: '55555555-5555-4555-8555-555555555555',
  leagueId,
  ownerUserId: userId,
  ownerPublicUserNo: '000123',
  ownerDisplayName: '小宣',
  ownerAlias: 'tidus',
  catalogTeamId: '33333333-3333-4333-8333-333333333333',
  teamNumber: 7,
  name: '阿贾克斯',
  shortName: 'AJA',
  logoUrl: 'https://assets.example/ajax.png',
  status: 'ACTIVE',
  rosterStatus: 'COMPLIANT',
  activePlayerCount: 20,
  salaryTotalMinor: 12_000,
  salaryCapMinor: 20_000,
  shellValueMinor: 8_000,
  version: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
};

const secondTeam: LeagueTeamSummary = {
  ...baseTeam,
  id: '66666666-6666-4666-8666-666666666666',
  ownerUserId: '77777777-7777-4777-8777-777777777777',
  ownerPublicUserNo: '009876',
  ownerDisplayName: 'Alex Chen',
  teamNumber: 18,
  name: '北京国安',
  shortName: '国安'
};

const ajaxCatalogItem = {
  id: baseTeam.catalogTeamId,
  sourceType: 'PESDATA' as const,
  sourceExternalId: 'ajax',
  sourceLeagueExternalId: 'eredivisie',
  sourceLeagueName: '荷甲',
  nameZh: '阿贾克斯',
  nameEn: 'Ajax',
  nameJa: null,
  shortName: 'AJA',
  remoteLogoUrl: null,
  storedLogoUrl: baseTeam.logoUrl,
  status: 'ACTIVE' as const,
  sourceUpdatedAt: null,
  lastSyncedAt: null,
  createdAt: baseTeam.createdAt,
  updatedAt: baseTeam.updatedAt,
  isAssigned: false,
  assignedLeagueTeamId: null
};

function mockRoutes(options: {
  teams?: LeagueTeamSummary[];
  catalog?: typeof ajaxCatalogItem[];
  createErrors?: Error[];
  teamLoadErrors?: Error[];
} = {}) {
  let createAttempt = 0;
  let teamLoadAttempt = 0;
  return vi.fn(async (path: string, requestOptions?: {
    method?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  }) => {
    if (path.startsWith('/v1/admin/team-catalog')) {
      return { items: options.catalog ?? [], nextCursor: null };
    }
    if (path.includes('/users/')) {
      return { id: userId, publicUserNo: '000123', displayName: '小宣', avatarUrl: null };
    }
    if (path.endsWith('/teams') && requestOptions?.method === 'POST') {
      const error = options.createErrors?.[createAttempt++];
      if (error) throw error;
      return baseTeam;
    }
    if (path.endsWith('/teams')) {
      const error = options.teamLoadErrors?.[teamLoadAttempt++];
      if (error) throw error;
      return { items: options.teams ?? [], nextCursor: null };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function renderPage(request: ReturnType<typeof vi.fn>) {
  const api: AdminApi = {
    restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request: request as AdminApi['request']
  };
  return render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/teams`]}><Routes>
    <Route path="/leagues/:leagueId/teams" element={<TeamsPage api={api} />} />
  </Routes></MemoryRouter>);
}

describe('league teams page', () => {
  it('provides a visible roster management action for every team', async () => {
    const request = mockRoutes({ teams: [baseTeam] });
    renderPage(request);

    const rosterLink = await screen.findByRole('link', { name: '管理阵容' });
    expect(rosterLink).toHaveAttribute('href', `/leagues/${leagueId}/teams/${baseTeam.id}/roster`);
  });

  it('offers distinct settings and shell shortcuts without duplicating the team detail link', async () => {
    const request = mockRoutes({ teams: [baseTeam] });
    renderPage(request);

    await userEvent.click(await screen.findByRole('button', { name: '更多' }));

    expect(await screen.findByRole('link', { name: '球队设置' })).toHaveAttribute(
      'href',
      `/leagues/${leagueId}/teams/${baseTeam.id}#team-settings`
    );
    expect(screen.getByRole('link', { name: '队壳管理' })).toHaveAttribute(
      'href',
      `/leagues/${leagueId}/teams/${baseTeam.id}#team-shell`
    );
    expect(screen.queryByRole('link', { name: '查看球队详情' })).not.toBeInTheDocument();
    expect(screen.queryByText('归档球队')).not.toBeInTheDocument();
  });

  it('keeps PESDATA synchronization out of the league workspace', async () => {
    const request = mockRoutes();
    renderPage(request);
    expect(await screen.findByText('暂无球队')).toBeInTheDocument();
    expect(screen.queryByText('PESDATA 队壳同步')).not.toBeInTheDocument();
    expect(request.mock.calls.map(([path]) => String(path)).join(' ')).not.toContain('/sync-runs');
  });

  it('filters by team identity, number, owner, and normalized keyword', () => {
    const teams = [baseTeam, secondTeam];

    expect(filterLeagueTeams(teams, ' 阿贾克斯 ')).toEqual([baseTeam]);
    expect(filterLeagueTeams(teams, '8')).toEqual([secondTeam]);
    expect(filterLeagueTeams(teams, 'alex')).toEqual([secondTeam]);
    expect(filterLeagueTeams(teams, '0098')).toEqual([secondTeam]);
    expect(filterLeagueTeams(teams, '  ')).toEqual(teams);
  });

  it('shows a filtered empty state without disabling team creation', async () => {
    const request = mockRoutes({ teams: [baseTeam, secondTeam] });
    renderPage(request);

    expect(await screen.findByText('7-阿贾克斯')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('筛选球队'), '不存在的球队');
    expect(await screen.findByText('没有符合筛选条件的球队')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('用户编号'), '000123');
    await userEvent.click(screen.getByRole('button', { name: '查找用户' }));
    expect(await screen.findByText('小宣')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建球队' })).toBeEnabled();
  });

  it('renders the empty state and requires exact six-digit lookup before creation', async () => {
    const request = mockRoutes();
    renderPage(request);

    expect(await screen.findByText('暂无球队')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('用户编号'), '000123');
    await userEvent.click(screen.getByRole('button', { name: '查找用户' }));

    expect(await screen.findByText('小宣')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/users/000123`, expect.any(Object));
  });

  it('keeps the create action available and explains that the entered user must be confirmed', async () => {
    const request = mockRoutes({ catalog: [ajaxCatalogItem] });
    renderPage(request);
    await screen.findByText('暂无球队');
    await userEvent.type(screen.getByLabelText('用户编号'), '000123');
    await userEvent.type(screen.getByLabelText('球队编号'), '8');
    await userEvent.type(screen.getByLabelText('联赛称呼'), 'tidus');
    await userEvent.click(screen.getByRole('button', { name: '选择阿贾克斯' }));

    const createButton = screen.getByRole('button', { name: '创建球队' });
    expect(createButton).toBeEnabled();
    await userEvent.click(createButton);

    expect(await screen.findByText('请先查找并确认用户')).toBeInTheDocument();
  });

  it('submits only the owner, alias, number, and selected shell and reports duplicate numbers', async () => {
    const request = mockRoutes({
      catalog: [ajaxCatalogItem],
      createErrors: [new ApiError({ status: 409, code: 'LEAGUE_TEAM_NUMBER_ALREADY_EXISTS' })]
    });
    renderPage(request);
    await screen.findByText('暂无球队');
    await userEvent.type(screen.getByLabelText('用户编号'), '000123');
    await userEvent.click(screen.getByRole('button', { name: '查找用户' }));
    await screen.findByText('小宣');
    await userEvent.type(screen.getByLabelText('球队编号'), '0');
    await userEvent.type(screen.getByLabelText('联赛称呼'), 'tidus');
    await userEvent.click(screen.getByRole('button', { name: '选择阿贾克斯' }));
    await userEvent.click(screen.getByRole('button', { name: '创建球队' }));

    expect(await screen.findByText('球队编号已被占用，请选择其他编号')).toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith(`/v1/admin/leagues/${leagueId}/teams`, expect.objectContaining({
      method: 'POST',
      body: { ownerUserId: userId, ownerAlias: 'tidus', teamNumber: 0, catalogTeamId: baseTeam.catalogTeamId }
    }));
    expect(request.mock.calls.at(-1)?.[1]?.body).not.toHaveProperty('defaultGameAccountId');
  });

  it('explains that a current season must be selected before binding', async () => {
    const request = mockRoutes({
      catalog: [ajaxCatalogItem],
      createErrors: [new ApiError({ status: 409, code: 'LEAGUE_CURRENT_SEASON_REQUIRED' })]
    });
    renderPage(request);
    await screen.findByText('暂无球队');
    await userEvent.type(screen.getByLabelText('用户编号'), '000123');
    await userEvent.click(screen.getByRole('button', { name: '查找用户' }));
    await screen.findByText('小宣');
    await userEvent.type(screen.getByLabelText('球队编号'), '8');
    await userEvent.type(screen.getByLabelText('联赛称呼'), '测试');
    await userEvent.click(screen.getByRole('button', { name: '选择阿贾克斯' }));
    await userEvent.click(screen.getByRole('button', { name: '创建球队' }));

    expect(await screen.findByText('请先在赛季管理中设置当前赛季，再绑定球队')).toBeInTheDocument();
  });

  it('shows a recoverable loading error', async () => {
    const request = mockRoutes({ teamLoadErrors: [new Error('offline')] });
    renderPage(request);
    expect(await screen.findByRole('alert')).toHaveTextContent('球队列表加载失败');
    await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(request.mock.calls.filter(([path]) => path.endsWith('/teams'))).toHaveLength(2));
    expect(await screen.findByText('暂无球队')).toBeInTheDocument();
  });

  it('reuses the same idempotency key when a failed create is retried unchanged', async () => {
    const request = mockRoutes({
      catalog: [ajaxCatalogItem],
      createErrors: [new Error('network timeout'), new Error('network timeout')]
    });
    renderPage(request);
    await screen.findByText('暂无球队');
    await userEvent.type(screen.getByLabelText('用户编号'), '000123');
    await userEvent.click(screen.getByRole('button', { name: '查找用户' }));
    await screen.findByText('小宣');
    await userEvent.type(screen.getByLabelText('球队编号'), '7');
    await userEvent.type(screen.getByLabelText('联赛称呼'), 'tidus');
    await userEvent.click(screen.getByRole('button', { name: '选择阿贾克斯' }));

    await userEvent.click(screen.getByRole('button', { name: '创建球队' }));
    await screen.findByText('球队创建失败，请稍后重试');
    await userEvent.click(screen.getByRole('button', { name: '创建球队' }));
    await waitFor(() => expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2));

    const createCalls = request.mock.calls.filter(([, options]) => options?.method === 'POST');
    const firstKey = createCalls[0]?.[1]?.headers?.['Idempotency-Key'];
    const retryKey = createCalls[1]?.[1]?.headers?.['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    expect(retryKey).toBe(firstKey);
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { AuctionEditorPage } from './auction-editor-page';

const leagueId = '11111111-1111-4111-8111-111111111111';

it('searches a player, adds pricing, and exposes keyboard ordering controls', async () => {
  const api = { request: vi.fn((path: string) => path.includes('player-candidates') ? Promise.resolve({ items: [{ playerId: 'player-1', playerName: '车范根', ownedByTeamId: null, recommendedPlayerCardId: 'card-1', cards: [{ id: 'card-1', cardName: '传奇', imageUrl: null, position: 'CF', overallRating: 96, maxOverall: 96, salaryMinor: 500, recommended: true }] }] }) : Promise.resolve({ bindings: [{ id: 'group-1', deviceId: 'device-1', leagueId, wechatGroupId: 'room@chatroom', displayName: 'CELL 联赛群', enabled: true, version: 1, capabilities: ['PLAYER_AUCTION'], scheduleSourceIds: [], createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' }], devices: [], observedGroups: [], scheduleSourceOptions: [] })) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/new`]}><Routes><Route path="/leagues/:leagueId/auctions/new" element={<AuctionEditorPage api={api} />} /></Routes></MemoryRouter>);
  const channel = await screen.findByRole('combobox', { name: '出价渠道' });
  expect(screen.getByText('小程序拍卖大厅（推荐）')).toBeInTheDocument();
  await userEvent.click(channel);
  expect(await screen.findByRole('option', { name: '微信群纯数字出价' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '小程序拍卖大厅（推荐）' })).toBeInTheDocument();
  await userEvent.type(await screen.findByLabelText('搜索球员'), '车范根');
  await userEvent.click(screen.getByRole('button', { name: '搜索' }));
  await userEvent.click(await screen.findByRole('button', { name: /添加车范根/ }));
  expect(screen.getByLabelText('上移车范根')).toBeInTheDocument();
  expect(screen.getByText('50 资金')).toBeInTheDocument();
});

it('shows a league-owned player but does not allow adding it to an auction', async () => {
  const api = { request: vi.fn((path: string) => path.includes('player-candidates')
    ? Promise.resolve({ items: [{ playerId: 'player-1', playerName: '伊克拉斯·桑龙', ownedByTeamId: 'team-4', recommendedPlayerCardId: 'card-1', cards: [{ id: 'card-1', cardName: '精选', imageUrl: null, position: 'LMF', overallRating: 82, maxOverall: 82, salaryMinor: 100, recommended: true }] }] })
    : Promise.resolve({ bindings: [], devices: [], observedGroups: [], scheduleSourceOptions: [] })) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/new`]}><Routes><Route path="/leagues/:leagueId/auctions/new" element={<AuctionEditorPage api={api} />} /></Routes></MemoryRouter>);

  await userEvent.type(await screen.findByLabelText('搜索球员'), '伊克拉斯');
  await userEvent.click(screen.getByRole('button', { name: '搜索' }));
  expect(await screen.findByText('已归属本联赛球队')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '添加伊克拉斯·桑龙' })).toBeDisabled();
});

it('lists only enabled auction-capable groups', async () => {
  const binding = (id: string, displayName: string, enabled: boolean, capabilities: string[]) => ({
    id, deviceId: 'device-1', leagueId, wechatGroupId: `${id}@chatroom`, displayName, enabled, version: 1,
    capabilities, scheduleSourceIds: [], createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z'
  });
  const api = { request: vi.fn(() => Promise.resolve({
    bindings: [
      binding('query', '赛程查询群', true, ['SCHEDULE_QUERY']),
      binding('auction', '拍卖专用群', true, ['PLAYER_AUCTION']),
      binding('combined', '联赛综合群', true, ['SCHEDULE_QUERY', 'PLAYER_AUCTION']),
      binding('disabled', '已停用拍卖群', false, ['PLAYER_AUCTION'])
    ],
    devices: [], observedGroups: [], scheduleSourceOptions: []
  })) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/new`]}><Routes><Route path="/leagues/:leagueId/auctions/new" element={<AuctionEditorPage api={api} />} /></Routes></MemoryRouter>);

  await userEvent.click(await screen.findByRole('combobox', { name: '出价渠道' }));
  await userEvent.click(await screen.findByText('微信群纯数字出价'));
  await userEvent.click(await screen.findByRole('combobox', { name: '通知微信群' }));
  expect(await screen.findByRole('option', { name: '拍卖专用群' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '联赛综合群' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: '赛程查询群' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: '已停用拍卖群' })).not.toBeInTheDocument();
});

it('keeps an existing draft on its saved eligible group', async () => {
  const group = {
    id: 'group-2', deviceId: 'device-1', leagueId, wechatGroupId: 'auction@chatroom', displayName: '拍卖专用群',
    enabled: true, version: 2, capabilities: ['PLAYER_AUCTION'], scheduleSourceIds: [],
    createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z'
  };
  const draft = {
    id: 'batch-1', leagueId, groupBindingId: group.id, bidChannel: 'WECHAT_GROUP', name: '十月拍卖', status: 'DRAFT', currentLotId: null,
    version: 1, startedAt: null, completedAt: null, cancelledAt: null,
    createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z', lots: []
  };
  const api = { request: vi.fn((path: string) => path.endsWith('/wechat-bot')
    ? Promise.resolve({ bindings: [group], devices: [], observedGroups: [], scheduleSourceOptions: [] })
    : Promise.resolve(draft)) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/batch-1/edit`]}><Routes><Route path="/leagues/:leagueId/auctions/:batchId/edit" element={<AuctionEditorPage api={api} />} /></Routes></MemoryRouter>);

  expect(await screen.findByText('拍卖专用群')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '通知微信群' })).toBeDisabled();
});

it('does not expose the hidden WeChat bot configuration when no auction group is eligible', async () => {
  const api = { request: vi.fn(() => Promise.resolve({
    bindings: [{
      id: 'query', deviceId: 'device-1', leagueId, wechatGroupId: 'query@chatroom', displayName: '赛程查询群',
      enabled: true, version: 1, capabilities: ['SCHEDULE_QUERY'], scheduleSourceIds: [],
      createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z'
    }],
    devices: [], observedGroups: [], scheduleSourceOptions: []
  })) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/new`]}><Routes><Route path="/leagues/:leagueId/auctions/new" element={<AuctionEditorPage api={api} />} /></Routes></MemoryRouter>);

  await userEvent.click(await screen.findByRole('combobox', { name: '出价渠道' }));
  await userEvent.click(await screen.findByText('微信群纯数字出价'));
  expect(await screen.findByText('暂无可用的拍卖通知群')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '前往微信群机器人配置' })).not.toBeInTheDocument();
});

it('saves and prepares a miniprogram auction without a WeChat group', async () => {
  const created = {
    id: 'batch-1', leagueId, groupBindingId: null, bidChannel: 'MINIPROGRAM', name: '球员拍卖',
    status: 'DRAFT', currentLotId: null, version: 1, startedAt: null, completedAt: null, cancelledAt: null,
    createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z', lots: []
  };
  const withLots = { ...created, version: 2, lots: [{
    id: 'lot-1', displayOrder: 1, playerId: 'player-1', playerCardId: 'card-1', playerName: '车范根',
    playerSnapshot: { card: { cardName: '传奇' } }, startingPrice: 50, minimumIncrement: 10,
    status: 'QUEUED', currentPrice: null, currentHighestBidId: null, deadlineAt: null, deadlineEpoch: 0,
    pausedRemainingMs: null, version: 1, bids: [], review: null, startedAt: null, closedAt: null, reviewedAt: null
  }] };
  const api = { request: vi.fn((path: string, options?: { method?: string; body?: unknown }) => {
    if (path.endsWith('/wechat-bot')) return Promise.resolve({ bindings: [], devices: [], observedGroups: [], scheduleSourceOptions: [] });
    if (path.includes('player-candidates')) return Promise.resolve({ items: [{ playerId: 'player-1', playerName: '车范根', ownedByTeamId: null, recommendedPlayerCardId: 'card-1', cards: [{ id: 'card-1', cardName: '传奇', imageUrl: null, position: 'CF', overallRating: 96, maxOverall: 96, salaryMinor: 500, recommended: true }] }] });
    if (options?.method === 'PUT') return Promise.resolve(withLots);
    if (path.endsWith('/prepare')) return Promise.resolve({ ...withLots, status: 'READY', version: 3 });
    return Promise.resolve(created);
  }) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/new`]}><Routes><Route path="/leagues/:leagueId/auctions/new" element={<AuctionEditorPage api={api} />} /><Route path="/leagues/:leagueId/auctions/:batchId" element={<div>拍卖详情</div>} /></Routes></MemoryRouter>);

  await userEvent.type(await screen.findByLabelText('搜索球员'), '车范根');
  await userEvent.click(screen.getByRole('button', { name: '搜索' }));
  await userEvent.click(await screen.findByRole('button', { name: /添加车范根/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /保存并准备拍卖/ })).not.toHaveClass('ant-btn-loading'));
  await userEvent.click(screen.getByRole('button', { name: /保存并准备拍卖/ }));

  expect(await screen.findByText('拍卖详情')).toBeInTheDocument();
  const createCall = (api.request as ReturnType<typeof vi.fn>).mock.calls.find(([path, options]) =>
    path.endsWith('/player-auctions') && options?.method === 'POST'
  );
  expect(createCall?.[1]?.body).toMatchObject({ groupBindingId: null, bidChannel: 'MINIPROGRAM' });
  expect(screen.queryByText('请选择微信群，并至少添加一位球员')).not.toBeInTheDocument();
});

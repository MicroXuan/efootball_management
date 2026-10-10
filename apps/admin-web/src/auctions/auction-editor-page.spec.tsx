import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { AuctionEditorPage } from './auction-editor-page';

const leagueId = '11111111-1111-4111-8111-111111111111';

it('searches a player, adds pricing, and exposes keyboard ordering controls', async () => {
  const api = { request: vi.fn((path: string) => path.includes('player-candidates') ? Promise.resolve({ items: [{ playerId: 'player-1', playerName: '车范根', ownedByTeamId: null, recommendedPlayerCardId: 'card-1', cards: [{ id: 'card-1', cardName: '传奇', imageUrl: null, position: 'CF', overallRating: 96, maxOverall: 96, salaryMinor: 500, recommended: true }] }] }) : Promise.resolve({ bindings: [{ id: 'group-1', deviceId: 'device-1', leagueId, wechatGroupId: 'room@chatroom', displayName: 'CELL 联赛群', enabled: true, version: 1, capabilities: ['PLAYER_AUCTION'], scheduleSourceIds: [], createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' }], devices: [], observedGroups: [], scheduleSourceOptions: [] })) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/new`]}><Routes><Route path="/leagues/:leagueId/auctions/new" element={<AuctionEditorPage api={api} />} /></Routes></MemoryRouter>);
  await userEvent.type(await screen.findByLabelText('搜索球员'), '车范根');
  await userEvent.click(screen.getByRole('button', { name: '搜索' }));
  await userEvent.click(await screen.findByRole('button', { name: /添加车范根/ }));
  expect(screen.getByLabelText('上移车范根')).toBeInTheDocument();
  expect(screen.getByText('⭐50⭐')).toBeInTheDocument();
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

  await userEvent.click(await screen.findByRole('combobox'));
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
    id: 'batch-1', leagueId, groupBindingId: group.id, name: '十月拍卖', status: 'DRAFT', currentLotId: null,
    version: 1, startedAt: null, completedAt: null, cancelledAt: null,
    createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z', lots: []
  };
  const api = { request: vi.fn((path: string) => path.endsWith('/wechat-bot')
    ? Promise.resolve({ bindings: [group], devices: [], observedGroups: [], scheduleSourceOptions: [] })
    : Promise.resolve(draft)) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/batch-1/edit`]}><Routes><Route path="/leagues/:leagueId/auctions/:batchId/edit" element={<AuctionEditorPage api={api} />} /></Routes></MemoryRouter>);

  expect(await screen.findByText('拍卖专用群')).toBeInTheDocument();
  expect(screen.getByRole('combobox')).toBeDisabled();
});

it('links to WeChat group configuration when no auction group is eligible', async () => {
  const api = { request: vi.fn(() => Promise.resolve({
    bindings: [{
      id: 'query', deviceId: 'device-1', leagueId, wechatGroupId: 'query@chatroom', displayName: '赛程查询群',
      enabled: true, version: 1, capabilities: ['SCHEDULE_QUERY'], scheduleSourceIds: [],
      createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z'
    }],
    devices: [], observedGroups: [], scheduleSourceOptions: []
  })) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/new`]}><Routes><Route path="/leagues/:leagueId/auctions/new" element={<AuctionEditorPage api={api} />} /></Routes></MemoryRouter>);

  const link = await screen.findByRole('link', { name: '前往微信群机器人配置' });
  expect(link).toHaveAttribute('href', `/leagues/${leagueId}/wechat-bot`);
});

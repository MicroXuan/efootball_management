import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { AuctionEditorPage } from './auction-editor-page';

const leagueId = '11111111-1111-4111-8111-111111111111';

it('searches a player, adds pricing, and exposes keyboard ordering controls', async () => {
  const api = { request: vi.fn((path: string) => path.includes('player-candidates') ? Promise.resolve({ items: [{ playerId: 'player-1', playerName: '车范根', ownedByTeamId: null, recommendedPlayerCardId: 'card-1', cards: [{ id: 'card-1', cardName: '传奇', imageUrl: null, position: 'CF', overallRating: 96, maxOverall: 96, salaryMinor: 500, recommended: true }] }] }) : Promise.resolve({ bindings: [{ id: 'group-1', deviceId: 'device-1', leagueId, wechatGroupId: 'room@chatroom', displayName: 'CELL 联赛群', enabled: true, version: 1, scheduleSourceIds: [], createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' }], devices: [], observedGroups: [], scheduleSourceOptions: [] })) } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/auctions/new`]}><Routes><Route path="/leagues/:leagueId/auctions/new" element={<AuctionEditorPage api={api} />} /></Routes></MemoryRouter>);
  await userEvent.type(await screen.findByLabelText('搜索球员'), '车范根');
  await userEvent.click(screen.getByRole('button', { name: '搜索' }));
  await userEvent.click(await screen.findByRole('button', { name: /添加车范根/ }));
  expect(screen.getByLabelText('上移车范根')).toBeInTheDocument();
  expect(screen.getByText('⭐50⭐')).toBeInTheDocument();
});

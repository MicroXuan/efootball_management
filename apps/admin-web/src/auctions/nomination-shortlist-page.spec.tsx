import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import userEvent from '@testing-library/user-event';
import { NominationShortlistPage, mergeNominatedLots } from './nomination-shortlist-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const windowId = '22222222-2222-4222-8222-222222222222';
const playerId = '33333333-3333-4333-8333-333333333333';
const teamId = '44444444-4444-4444-8444-444444444444';

it('shows one candidate with all nominators and current eligibility', async () => {
  const request = vi.fn((path: string) => path.includes('/candidates') ? Promise.resolve({ items: [{ playerId, sourceNominationId: '66666666-6666-4666-8666-666666666666', playerName: '瓦拉内', nominatorCount: 2, eligible: true, cards: [{ id: '77777777-7777-4777-8777-777777777777', cardName: '传奇' }], nominators: [
    { leagueTeamId: teamId, teamNumber: 4, teamName: '巴塞罗那', ownerAlias: '小新' },
    { leagueTeamId: '55555555-5555-4555-8555-555555555555', teamNumber: 3, teamName: '阿贾克斯', ownerAlias: 'Tidus' }
  ] }] }) : Promise.resolve({ items: [{ id: '88888888-8888-4888-8888-888888888888', name: '草稿一', status: 'DRAFT' }] }));
  const api = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request } as unknown as AdminApi;
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/nomination-windows/${windowId}/candidates`]}><Routes><Route path="/leagues/:leagueId/nomination-windows/:windowId/candidates" element={<NominationShortlistPage api={api} />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('瓦拉内')).toBeInTheDocument();
  expect(screen.getByText(/4号 巴塞罗那（小新）、3号 阿贾克斯（Tidus）/)).toBeInTheDocument();
  expect(screen.getByText('可导入')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/nomination-windows/${windowId}/candidates`, expect.anything());
  const importButton = screen.getByRole('button', { name: /导入所选到草稿/ });
  expect(importButton).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: '选择瓦拉内' }));
  expect(importButton).toBeDisabled();
  await userEvent.click(screen.getByRole('combobox', { name: '瓦拉内卡片' }));
  await userEvent.click(await screen.findByText('传奇'));
  await userEvent.type(screen.getByRole('spinbutton', { name: '瓦拉内起拍价' }), '150');
  await userEvent.type(screen.getByRole('spinbutton', { name: '瓦拉内最低加价' }), '30');
  expect(importButton).toBeEnabled();
});

it('appends a nominee once without changing existing lot order or prices', () => {
  const nominationId = '66666666-6666-4666-8666-666666666666';
  const cardId = '77777777-7777-4777-8777-777777777777';
  const existing = { playerId: teamId, playerCardId: cardId, displayOrder: 1, startingPrice: 90, minimumIncrement: 20 };
  const batch = { lots: [existing] } as never;
  const candidates = [{ playerId, sourceNominationId: nominationId, playerName: '瓦拉内', eligible: true, cards: [{ id: cardId, cardName: '传奇' }] }] as never;
  const selected = { [playerId]: { cardId, startingPrice: 150, minimumIncrement: 30 } };
  expect(mergeNominatedLots(batch, candidates, selected)).toEqual([existing, { playerId, playerCardId: cardId, nominationId, displayOrder: 2, startingPrice: 150, minimumIncrement: 30 }]);
  expect(mergeNominatedLots({ lots: [...(batch as { lots: unknown[] }).lots, { playerId, playerCardId: cardId, nominationId, displayOrder: 2, startingPrice: 150, minimumIncrement: 30 }] } as never, candidates, selected)).toHaveLength(2);
});

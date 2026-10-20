import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { NominationShortlistPage } from './nomination-shortlist-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const windowId = '22222222-2222-4222-8222-222222222222';
const playerId = '33333333-3333-4333-8333-333333333333';
const teamId = '44444444-4444-4444-8444-444444444444';

it('shows one candidate with all nominators and current eligibility', async () => {
  const request = vi.fn().mockResolvedValueOnce({ items: [{ playerId, playerName: '瓦拉内', nominatorCount: 2, eligible: true, nominators: [
    { leagueTeamId: teamId, teamNumber: 4, teamName: '巴塞罗那', ownerAlias: '小新' },
    { leagueTeamId: '55555555-5555-4555-8555-555555555555', teamNumber: 3, teamName: '阿贾克斯', ownerAlias: 'Tidus' }
  ] }] });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/nomination-windows/${windowId}/candidates`]}><Routes><Route path="/leagues/:leagueId/nomination-windows/:windowId/candidates" element={<NominationShortlistPage api={api} />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('瓦拉内')).toBeInTheDocument();
  expect(screen.getByText(/4号 巴塞罗那（小新）、3号 阿贾克斯（Tidus）/)).toBeInTheDocument();
  expect(screen.getByText('可导入')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/nomination-windows/${windowId}/candidates`, expect.anything());
});

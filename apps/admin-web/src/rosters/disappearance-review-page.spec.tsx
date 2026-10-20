import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { DisappearanceReviewPage } from './disappearance-review-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const item = { id: '22222222-2222-4222-8222-222222222222', leagueId, seasonId: '33333333-3333-4333-8333-333333333333', ownershipId: '44444444-4444-4444-8444-444444444444', requesterTeamId: '55555555-5555-4555-8555-555555555555', requesterTeamName: '阿哈尔', requesterTeamNumber: 1, playerName: '瓦拉内', status: 'PENDING', reason: '游戏内已移除', reviewReason: null, version: 1, createdAt: '2026-10-21T12:00:00.000Z', reviewedAt: null, events: [] };

it('requires a review reason and submits the request version', async () => {
  const request = vi.fn().mockResolvedValueOnce({ items: [item] }).mockResolvedValueOnce({ ...item, status: 'APPROVED', reviewReason: '已核实' }).mockResolvedValueOnce({ items: [] });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/disappearance-requests`]}><Routes><Route path="/leagues/:leagueId/disappearance-requests" element={<DisappearanceReviewPage api={api} />} /></Routes></MemoryRouter>);
  await screen.findByText('瓦拉内');
  await userEvent.click(screen.getByRole('button', { name: '查看并审核' }));
  expect(screen.getByRole('button', { name: '确认审核' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('审核理由'), '已核实');
  await userEvent.click(screen.getByRole('button', { name: '确认审核' }));
  expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/disappearance-requests/${item.id}/review`, expect.objectContaining({ body: { decision: 'APPROVE', reason: '已核实', expectedVersion: 1 } }));
});

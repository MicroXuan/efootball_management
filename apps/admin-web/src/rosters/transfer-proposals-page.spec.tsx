import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { TransferProposalsPage } from './transfer-proposals-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const item = { id: '22222222-2222-4222-8222-222222222222', leagueId, seasonId: '33333333-3333-4333-8333-333333333333', ownershipId: '44444444-4444-4444-8444-444444444444', playerName: '瓦拉内', sourceTeamId: '55555555-5555-4555-8555-555555555555', sourceTeamName: '巴塞罗那', sourceTeamNumber: 4, targetTeamId: '66666666-6666-4666-8666-666666666666', targetTeamName: '阿贾克斯', targetTeamNumber: 3, initiatorTeamId: '55555555-5555-4555-8555-555555555555', amountMinor: 15000, status: 'PENDING_ADMIN', reason: '协商', reviewReason: null, version: 2, createdAt: '2026-10-21T12:00:00.000Z', reviewedAt: null, counterpartyConfirmed: true, events: [] };

it('shows the frozen amount and requires an admin review reason', async () => {
  const request = vi.fn().mockResolvedValueOnce({ items: [item] }).mockResolvedValueOnce({ ...item, status: 'APPROVED', reviewReason: '已核实' }).mockResolvedValueOnce({ items: [] });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/transfer-proposals`]}><Routes><Route path="/leagues/:leagueId/transfer-proposals" element={<TransferProposalsPage api={api} />} /></Routes></MemoryRouter>);
  await screen.findByText('瓦拉内');
  expect(screen.getByText('15000')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '查看并审核' }));
  expect(screen.getByRole('button', { name: '确认审核' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('审核理由'), '已核实');
  await userEvent.click(screen.getByRole('button', { name: '确认审核' }));
  expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/transfer-proposals/${item.id}/review`, expect.objectContaining({ body: { decision: 'APPROVE', reason: '已核实', expectedVersion: 2 } }));
});

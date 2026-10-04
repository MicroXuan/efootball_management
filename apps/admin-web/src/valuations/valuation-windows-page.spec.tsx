import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { ValuationWindowsPage } from './valuation-windows-page';

it('shows Chinese window state, rule version, and dynamic rule editor', async () => {
  const request = vi.fn(async (path: string) => path.includes('roster-seasons') ? [{ id: '22222222-2222-4222-8222-222222222222', displayName: 'S2' }] : { items: [{ id: '33333333-3333-4333-8333-333333333333', seasonId: '22222222-2222-4222-8222-222222222222', name: '季前申报', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-08T00:00:00.000Z', closedAt: null, state: 'OPEN', currentRule: { id: '44444444-4444-4444-8444-444444444444', windowId: '33333333-3333-4333-8333-333333333333', version: 2, minimumValueMinor: 100, maximumValueMinor: 10000, maximumIncreaseBps: 2000, maximumDecreaseBps: 1000, createdByAdminId: '55555555-5555-4555-8555-555555555555', createdAt: '2026-09-01T00:00:00.000Z' }, createdByAdminId: '55555555-5555-4555-8555-555555555555', version: 2, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }] }) as unknown as AdminApi['request'];
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={['/leagues/11111111-1111-4111-8111-111111111111/valuation-windows']}><Routes><Route path="/leagues/:leagueId/valuation-windows" element={<ValuationWindowsPage api={api} />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('季前申报')).toBeInTheDocument();
  expect(screen.getByText('开放中')).toBeInTheDocument();
  expect(screen.getByText('V2')).toBeInTheDocument();
  expect(screen.getByText('修改规则会生成新版本，已保存的旧申报仍引用原规则。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '创建窗口' })).toBeInTheDocument();
});

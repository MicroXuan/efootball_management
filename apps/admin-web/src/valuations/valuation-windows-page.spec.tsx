import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError, type AdminApi } from '../lib/api';
import { ValuationWindowsPage } from './valuation-windows-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const seasonId = '22222222-2222-4222-8222-222222222222';
const windowId = '33333333-3333-4333-8333-333333333333';

function valuationWindow(state: 'OPEN' | 'CLOSED' = 'OPEN') {
  return {
    id: windowId,
    seasonId,
    name: '季前申报',
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-10-08T00:00:00.000Z',
    closedAt: state === 'CLOSED' ? '2026-10-05T00:00:00.000Z' : null,
    state,
    currentRule: {
      id: '44444444-4444-4444-8444-444444444444',
      windowId,
      version: 2,
      minimumValueMinor: 100,
      maximumValueMinor: 10000,
      maximumIncreaseBps: 2000,
      maximumDecreaseBps: 1000,
      createdByAdminId: '55555555-5555-4555-8555-555555555555',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    createdByAdminId: '55555555-5555-4555-8555-555555555555',
    version: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function renderPage(request: AdminApi['request']) {
  const api: AdminApi = {
    restore: vi.fn(), login: vi.fn(), logout: vi.fn(),
    onSessionExpired: vi.fn().mockReturnValue(() => undefined), request,
  };
  render(
    <MemoryRouter initialEntries={[`/leagues/${leagueId}/valuation-windows`]}>
      <Routes><Route path="/leagues/:leagueId/valuation-windows" element={<ValuationWindowsPage api={api} />} /></Routes>
    </MemoryRouter>,
  );
}

it('shows percentage-based valuation rules with a concrete decrease example', async () => {
  const request = vi.fn(async (path: string) => path.includes('roster-seasons')
    ? [{ id: seasonId, displayName: 'S2' }]
    : { items: [valuationWindow()] }) as unknown as AdminApi['request'];
  renderPage(request);

  expect(await screen.findByText('季前申报')).toBeInTheDocument();
  expect(screen.getByText('开放中')).toBeInTheDocument();
  expect(screen.getByText('V2')).toBeInTheDocument();
  expect(screen.getByLabelText('最大涨幅（%）')).toHaveValue('20');
  expect(screen.getByLabelText('最大跌幅（%）')).toHaveValue('20');
  expect(screen.getByText(/10,000.*10%.*9,000/)).toBeInTheDocument();
});

it('copies a closed window into a new POST request and converts percentages to basis points', async () => {
  const user = userEvent.setup();
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.includes('roster-seasons')) return [{ id: seasonId, displayName: 'S2' }];
    if (options?.method === 'POST') return valuationWindow('OPEN');
    return { items: [valuationWindow('CLOSED')] };
  }) as unknown as AdminApi['request'];
  renderPage(request);

  await user.click(await screen.findByRole('button', { name: '复制为新窗口' }));
  expect(screen.queryByRole('button', { name: '调整规则' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('窗口名称')).toHaveValue('季前申报（新窗口）');
  expect(screen.getByLabelText('最低身价')).toHaveAttribute('step', '10');
  expect(screen.getByLabelText('最高身价')).toHaveAttribute('step', '10');
  expect(screen.getByLabelText('最大涨幅（%）')).toHaveValue('20');
  expect(screen.getByLabelText('最大跌幅（%）')).toHaveValue('10');

  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-10-12T10:00' } });
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-10-19T10:00' } });
  await user.click(screen.getByRole('button', { name: '创建新窗口' }));

  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/seasons/${seasonId}/valuation-windows`,
    expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        startsAt: expect.any(String),
        endsAt: expect.any(String),
        rule: expect.objectContaining({
          minimumValueMinor: 100,
          maximumValueMinor: 10000,
          maximumIncreaseBps: 2000,
          maximumDecreaseBps: 1000,
        }),
      }),
    }),
  ));
});

it('explains a close race instead of showing the generic save failure', async () => {
  const user = userEvent.setup();
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.includes('roster-seasons')) return [{ id: seasonId, displayName: 'S2' }];
    if (options?.method === 'PATCH') {
      throw new ApiError({ status: 409, code: 'VALUATION_WINDOW_CLOSED' });
    }
    return { items: [valuationWindow()] };
  }) as unknown as AdminApi['request'];
  renderPage(request);

  await user.click(await screen.findByRole('button', { name: '调整规则' }));
  await user.click(screen.getByRole('button', { name: '保存并发布新版本' }));

  expect(await screen.findByText('该窗口已关闭，不能继续修改。请复制为新窗口后重新设置时间')).toBeInTheDocument();
});

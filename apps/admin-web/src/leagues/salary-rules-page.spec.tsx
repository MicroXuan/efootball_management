import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { SalaryRulesPage } from './salary-rules-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const tiers = [{ minOverall: 0, maxOverall: 92, salaryMinor: 100 }, { minOverall: 93, maxOverall: 120, salaryMinor: 200 }];

it('does not flash a draft validation error while a published rule loads', async () => {
  let resolveLoad: (value: unknown) => void = () => undefined;
  const request = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/salary-rules`]}><Routes><Route path="/leagues/:leagueId/salary-rules" element={<SalaryRulesPage api={api} />} /></Routes></MemoryRouter>);

  expect(screen.getByText('正在加载工资规则…')).toBeInTheDocument();
  expect(screen.queryByText('第 1 档请填写整数')).not.toBeInTheDocument();
  expect(screen.queryByText('尚未发布工资规则')).not.toBeInTheDocument();
  resolveLoad({ items: [{ version: 3, salaryCapMinor: 0, tiers }] });

  expect(await screen.findByText('当前版本 v3')).toBeInTheDocument();
  expect(screen.getByLabelText('第 1 档结束分')).toHaveValue('92');
  expect(screen.queryByText('第 1 档请填写整数')).not.toBeInTheDocument();
});

it('starts a new rule with one manually editable tier instead of fixed score bands', async () => {
  const request = vi.fn().mockResolvedValue({ items: [] });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/salary-rules`]}><Routes><Route path="/leagues/:leagueId/salary-rules" element={<SalaryRulesPage api={api} />} /></Routes></MemoryRouter>);
  await screen.findByText('尚未发布工资规则');
  expect(screen.getAllByLabelText(/档起始分/)).toHaveLength(1);
  expect(screen.getByLabelText('第 1 档结束分')).toHaveValue('120');
  expect(screen.getByLabelText('第 1 档工资')).toHaveValue('');
  expect(screen.getByRole('button', { name: '预览影响' })).toBeDisabled();
});

it('previews team salary impact before publishing a rule version', async () => {
  const request = vi.fn().mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ salaryCapMinor: 2000, teams: [{ leagueTeamId: '22222222-2222-4222-8222-222222222222', teamName: '巴塞罗那', currentSalaryMinor: 1500, projectedSalaryMinor: 1800, deltaMinor: 300, projectedStatus: 'COMPLIANT' }] });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/salary-rules`]}><Routes><Route path="/leagues/:leagueId/salary-rules" element={<SalaryRulesPage api={api} initialTiers={tiers} />} /></Routes></MemoryRouter>);
  await screen.findByText('尚未发布工资规则');
  expect(screen.getByText('工资档位与自动加点总评')).toBeInTheDocument();
  expect(screen.getByText('起始分')).toBeInTheDocument();
  expect(screen.getByText('结束分')).toBeInTheDocument();
  expect(screen.getByLabelText('第 1 档起始分')).toHaveValue('0');
  expect(screen.queryByLabelText('工资帽')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '预览影响' }));
  expect(request).toHaveBeenNthCalledWith(2, `/v1/admin/leagues/${leagueId}/salary-rules/preview`, expect.objectContaining({ body: expect.objectContaining({ salaryCapMinor: 0 }) }));
  expect(await screen.findByText('巴塞罗那')).toBeInTheDocument();
  expect(screen.getByText('+300')).toBeInTheDocument();
});

it('lets an admin define each tier explicitly and requires a fresh preview after edits', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce({ items: [] })
    .mockResolvedValueOnce({ salaryCapMinor: 0, teams: [] })
    .mockResolvedValueOnce({ salaryCapMinor: 0, teams: [] })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ items: [] });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/salary-rules`]}><Routes><Route path="/leagues/:leagueId/salary-rules" element={<SalaryRulesPage api={api} initialTiers={tiers} />} /></Routes></MemoryRouter>);
  await screen.findByText('尚未发布工资规则');
  await userEvent.click(screen.getByRole('button', { name: '重新填写档位' }));
  expect(screen.getByRole('button', { name: '预览影响' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('第 1 档结束分'), { target: { value: '88' } });
  fireEvent.change(screen.getByLabelText('第 1 档工资'), { target: { value: '100' } });
  await userEvent.click(screen.getByRole('button', { name: '新增档位' }));
  fireEvent.change(screen.getByLabelText('第 2 档起始分'), { target: { value: '89' } });
  fireEvent.change(screen.getByLabelText('第 2 档结束分'), { target: { value: '91' } });
  fireEvent.change(screen.getByLabelText('第 2 档工资'), { target: { value: '200' } });
  await userEvent.click(screen.getByRole('button', { name: '新增档位' }));
  fireEvent.change(screen.getByLabelText('第 3 档起始分'), { target: { value: '92' } });
  fireEvent.change(screen.getByLabelText('第 3 档结束分'), { target: { value: '120' } });
  fireEvent.change(screen.getByLabelText('第 3 档工资'), { target: { value: '300' } });
  expect(screen.getByRole('button', { name: '预览影响' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: '预览影响' }));
  expect(request).toHaveBeenNthCalledWith(2, `/v1/admin/leagues/${leagueId}/salary-rules/preview`, expect.objectContaining({
    body: { salaryCapMinor: 0, tiers: [{ minOverall: 0, maxOverall: 88, salaryMinor: 100 }, { minOverall: 89, maxOverall: 91, salaryMinor: 200 }, { minOverall: 92, maxOverall: 120, salaryMinor: 300 }] },
  }));
  await waitFor(() => expect(screen.getByText('发布新版本').closest('button')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('第 3 档工资'), { target: { value: '1100' } });
  expect(screen.getByText('发布新版本').closest('button')).toBeDisabled();
  await userEvent.click(screen.getByText('预览影响').closest('button')!);
  await waitFor(() => expect(screen.getByText('发布新版本').closest('button')).toBeEnabled());
  await userEvent.click(screen.getByText('发布新版本').closest('button')!);
  expect(request).toHaveBeenNthCalledWith(4, `/v1/admin/leagues/${leagueId}/salary-rules`, expect.objectContaining({
    method: 'POST', body: expect.objectContaining({
      expectedCurrentVersion: 0,
      tiers: [{ minOverall: 0, maxOverall: 88, salaryMinor: 100 }, { minOverall: 89, maxOverall: 91, salaryMinor: 200 }, { minOverall: 92, maxOverall: 120, salaryMinor: 1100 }],
    }),
  }));
});

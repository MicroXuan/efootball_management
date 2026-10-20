import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { SalaryRulesPage } from './salary-rules-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const tiers = [{ minOverall: 0, maxOverall: 92, salaryMinor: 100 }, { minOverall: 93, maxOverall: 120, salaryMinor: 200 }];

it('previews team salary impact before publishing a rule version', async () => {
  const request = vi.fn().mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ salaryCapMinor: 2000, teams: [{ leagueTeamId: '22222222-2222-4222-8222-222222222222', teamName: '巴塞罗那', currentSalaryMinor: 1500, projectedSalaryMinor: 1800, deltaMinor: 300, projectedStatus: 'COMPLIANT' }] });
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/salary-rules`]}><Routes><Route path="/leagues/:leagueId/salary-rules" element={<SalaryRulesPage api={api} initialTiers={tiers} />} /></Routes></MemoryRouter>);
  await screen.findByText('尚未发布工资规则');
  expect(screen.getByText('工资档位与自动加点总评')).toBeInTheDocument();
  expect(screen.getByText('自动加点总评范围')).toBeInTheDocument();
  expect(screen.queryByLabelText('工资帽')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '预览影响' }));
  expect(request).toHaveBeenNthCalledWith(2, `/v1/admin/leagues/${leagueId}/salary-rules/preview`, expect.objectContaining({ body: expect.objectContaining({ salaryCapMinor: 0 }) }));
  expect(await screen.findByText('巴塞罗那')).toBeInTheDocument();
  expect(screen.getByText('+300')).toBeInTheDocument();
});

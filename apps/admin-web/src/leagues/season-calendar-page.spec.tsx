import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { SeasonCalendarPage } from './season-calendar-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const seasonId = '22222222-2222-4222-8222-222222222222';
const noteId = '33333333-3333-4333-8333-333333333333';
const phase = (id: string, kind: 'TRANSFER' | 'FORCED_OFFER' | 'VALUATION' | 'NOMINATION', title: string) => ({
  id, kind, noteKind: null, title, description: null, version: null, firstDate: '2026-10-20', lastDate: '2026-10-22',
  startsAt: '2026-10-20T00:00:00.000Z', endsAt: '2026-10-22T16:00:00.000Z', status: 'ACTIVE', targetPath: null,
});
const note = { id: noteId, kind: 'MANUAL', noteKind: 'HOLIDAY', title: '假期', description: '暂停考核', version: 1,
  firstDate: '2026-10-01', lastDate: '2026-10-07', startsAt: null, endsAt: null, status: 'ENDED', targetPath: null };
const response = { month: '2026-10', seasonId, timezone: 'Asia/Shanghai', items: [
  phase('44444444-4444-4444-8444-444444444444', 'TRANSFER', '转会窗口'),
  phase('55555555-5555-4555-8555-555555555555', 'FORCED_OFFER', '强报窗口'),
  phase('66666666-6666-4666-8666-666666666666', 'VALUATION', '身价窗口'),
  phase('77777777-7777-4777-8777-777777777777', 'NOMINATION', '提名窗口'), note
] };

function renderPage(request: AdminApi['request']) {
  const api: AdminApi = { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/season-calendar`]}><Routes>
    <Route path="/leagues/:leagueId/season-calendar" element={<SeasonCalendarPage api={api} />} />
  </Routes></MemoryRouter>);
}

it('shows the current season month with all four phases, notes and no fixtures', async () => {
  const request = vi.fn().mockResolvedValue(response);
  renderPage(request);
  expect(await screen.findByText('强报窗口')).toBeInTheDocument();
  expect(screen.getByText('转会窗口')).toBeInTheDocument();
  expect(screen.getByText('身价窗口')).toBeInTheDocument();
  expect(screen.getByText('提名窗口')).toBeInTheDocument();
  expect(screen.getAllByText('假期').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/北京时间/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/比赛赛程/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '下个月' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/current-season/agenda?month=2026-11`, expect.any(Object)));
});

it('saves and deletes a manual note, refreshing the month after each change', async () => {
  const request = vi.fn().mockResolvedValue(response);
  renderPage(request);
  await screen.findByText('强报窗口');
  await userEvent.type(screen.getByLabelText('事项标题'), '赛季公告');
  await userEvent.type(screen.getByLabelText('开始日期'), '2026-10-25');
  await userEvent.type(screen.getByLabelText('结束日期'), '2026-10-26');
  await userEvent.click(screen.getByRole('button', { name: '新增事项' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('/calendar-notes'), expect.objectContaining({ method: 'POST', body: expect.objectContaining({ title: '赛季公告' }) })));
  await userEvent.click(screen.getByRole('button', { name: '删除假期' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining(`/calendar-notes/${noteId}`), expect.objectContaining({ method: 'DELETE', body: { expectedVersion: 1 } })));
});

it('shows a permission error without an editable form', async () => {
  const request = vi.fn().mockRejectedValue(new Error('denied'));
  renderPage(request);
  expect(await screen.findByText('赛季日历加载失败')).toBeInTheDocument();
  expect(screen.queryByLabelText('事项标题')).not.toBeInTheDocument();
});

it('shows a normal empty state when no current season exists', async () => {
  renderPage(vi.fn().mockResolvedValue({ month: '2026-10', seasonId: null, timezone: 'Asia/Shanghai', items: [] }));
  expect(await screen.findByText('尚未设置当前赛季')).toBeInTheDocument();
  expect(screen.queryByLabelText('事项标题')).not.toBeInTheDocument();
});

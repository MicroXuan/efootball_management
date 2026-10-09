import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { ApiError } from '../lib/api';
import { WechatBotPage } from './wechat-bot-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const deviceId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const competitionId = '44444444-4444-4444-8444-444444444444';
const config = {
  bindings: [],
  devices: [{
    id: deviceId, name: '联赛机器人', status: 'ACTIVE', loginStatus: 'LOGGED_IN', circuitStatus: 'CLOSED',
    circuitReason: null, lastHeartbeatAt: '2026-10-09T12:00:00.000Z', wechatVersion: '4.1.15.13',
    outboundQueueDepth: 0, createdAt: '2026-10-09T10:00:00.000Z', updatedAt: '2026-10-09T12:00:00.000Z'
  }],
  observedGroups: [{ id: groupId, deviceId, wechatGroupId: 'room@chatroom', displayName: 'CELL 联赛群', lastObservedAt: '2026-10-09T12:00:00.000Z' }],
  scheduleSourceOptions: [{ id: competitionId, name: '甲级联赛', status: 'IN_PROGRESS' }]
};

function renderPage(api: AdminApi) {
  return render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/wechat-bot`]}><Routes>
    <Route path="/leagues/:leagueId/wechat-bot" element={<WechatBotPage api={api} />} />
  </Routes></MemoryRouter>);
}

it('selects one observed group and schedule sources, then saves the binding', async () => {
  const binding = {
    id: '55555555-5555-4555-8555-555555555555', deviceId, leagueId, wechatGroupId: 'room@chatroom',
    displayName: 'CELL 联赛群', enabled: true, version: 1, scheduleSourceIds: [competitionId],
    createdAt: '2026-10-09T12:00:00.000Z', updatedAt: '2026-10-09T12:00:00.000Z'
  };
  const request = vi.fn((_path: string, options?: { method?: string }) => options?.method === 'PUT'
    ? Promise.resolve(binding)
    : Promise.resolve(config));
  renderPage({ request } as unknown as AdminApi);
  await userEvent.click(await screen.findByRole('button', { name: '选择群 CELL 联赛群' }));
  await userEvent.click(screen.getByRole('checkbox', { name: '甲级联赛' }));
  await userEvent.click(screen.getByRole('button', { name: '保存群机器人配置' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/wechat-bot/group`,
    expect.objectContaining({ method: 'PUT', body: { deviceId, observedGroupId: groupId, enabled: true, scheduleSourceIds: [competitionId] } })
  ));
  expect(await screen.findByRole('status')).toHaveTextContent('配置已保存');
  expect(screen.queryByText(/轮换令牌|设备令牌/)).not.toBeInTheDocument();
});

it('keeps a group conflict visible and tells the manager how to recover', async () => {
  const request = vi.fn((_path: string, options?: { method?: string }) => options?.method === 'PUT'
    ? Promise.reject(new ApiError({ status: 409, code: 'WECHAT_GROUP_ALREADY_BOUND' }))
    : Promise.resolve(config));
  renderPage({ request } as unknown as AdminApi);
  await userEvent.click(await screen.findByRole('button', { name: '选择群 CELL 联赛群' }));
  await userEvent.click(screen.getByRole('button', { name: '保存群机器人配置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('该微信群已绑定其他联赛');
});

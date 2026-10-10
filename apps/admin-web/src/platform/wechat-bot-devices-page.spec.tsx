import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../lib/api';
import { WechatBotDevicesPage } from './wechat-bot-devices-page';

const device = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '联赛机器人 A',
  status: 'ACTIVE' as const,
  loginStatus: 'LOGGED_OUT' as const,
  circuitStatus: 'OPEN' as const,
  circuitReason: 'SEND_FAILED',
  lastHeartbeatAt: '2026-10-09T12:00:00.000Z',
  wechatVersion: '4.1.15.13',
  outboundQueueDepth: 3,
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-09T12:00:00.000Z',
};

it('shows loading, offline, and circuit states without exposing stored hashes', async () => {
  let resolve!: (value: unknown) => void;
  const request = vi.fn(() => new Promise((done) => { resolve = done; }));
  render(<WechatBotDevicesPage api={{ request } as unknown as AdminApi} />);
  expect(screen.getByText('正在读取设备状态…')).toBeInTheDocument();
  resolve({ items: [device] });
  expect(screen.getByRole('heading', { name: '群机器人' })).toBeInTheDocument();
  expect(await screen.findByText('联赛机器人 A')).toBeInTheDocument();
  expect(screen.getByText('离线')).toBeInTheDocument();
  expect(screen.getByText('熔断已开启')).toBeInTheDocument();
  expect(screen.queryByText(/secret-hash|tokenHash/)).not.toBeInTheDocument();
});

it('renders directed empty and error states', async () => {
  const emptyApi = { request: vi.fn().mockResolvedValue({ items: [] }) } as unknown as AdminApi;
  const { unmount } = render(<WechatBotDevicesPage api={emptyApi} />);
  expect(await screen.findByText('还没有机器人设备')).toBeInTheDocument();
  unmount();
  const errorApi = { request: vi.fn().mockRejectedValue(new Error('down')) } as unknown as AdminApi;
  render(<WechatBotDevicesPage api={errorApi} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('设备状态加载失败');
});

it('shows a newly created credential once in a modal', async () => {
  const created = { device: { ...device, id: '22222222-2222-4222-8222-222222222222', name: '新机器人', loginStatus: 'UNKNOWN', circuitStatus: 'CLOSED', circuitReason: null }, token: 'one-time-device-token-12345678901234567890' };
  const request = vi.fn((path: string, options?: { method?: string }) => options?.method === 'POST'
    ? Promise.resolve(created)
    : Promise.resolve({ items: [] }));
  render(<WechatBotDevicesPage api={{ request } as unknown as AdminApi} />);
  await screen.findByText('还没有机器人设备');
  await userEvent.click(screen.getByRole('button', { name: '创建设备' }));
  await userEvent.type(screen.getByLabelText('设备名称'), '新机器人');
  await userEvent.click(screen.getByRole('button', { name: '确认创建' }));
  expect(await screen.findByText('one-time-device-token-12345678901234567890')).toBeInTheDocument();
  expect(screen.getByText('关闭后无法再次查看')).toBeInTheDocument();
  await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/admin/wechat-bot/devices', expect.objectContaining({
    method: 'POST', body: { name: '新机器人' }
  })));
});

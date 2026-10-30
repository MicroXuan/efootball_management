import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, it, expect } from 'vitest';
import { WechatBotAdminsPanel } from './wechat-bot-admins-panel';
import type { AdminApi } from '../lib/api';

it('unbinds an administrator with a version and idempotency key, independently of users', async () => {
  const writes: unknown[] = [];
  const request = vi.fn(async (_path: string, options?: { method?: string; body?: unknown }) => {
    if (options?.method === 'PUT') { writes.push(options.body); return { saved: true }; }
    return { enabled: true, items: [{ id: 'contact-1', wechatContactId: 'wxid_admin', version: 3, adminId: null, adminName: null }], admins: [] };
  });
  const user = userEvent.setup();
  render(<WechatBotAdminsPanel deviceId="device-1" api={{ request } as unknown as AdminApi} />);
  await user.click(await screen.findByRole('button', { name: '管理关联' }));
  expect(writes).toHaveLength(0);
  expect(screen.getByLabelText('备注（选填）')).toHaveValue('');
  await user.click(screen.getByRole('button', { name: '确认解除关联' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toEqual({ adminId: null, expectedVersion: 3, reason: '', idempotencyKey: expect.any(String) });
  expect(request.mock.calls.some(([path]) => path.endsWith('/private-admins/contact-1'))).toBe(true);
});
it('shows deployment prerequisite while private score feature is disabled', async () => {
  const request = vi.fn(async () => ({ enabled: false, items: [], admins: [] }));
  render(<WechatBotAdminsPanel deviceId="device-1" api={{ request } as unknown as AdminApi} />);
  expect(await screen.findByText(/请先完成数据库迁移/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '管理关联' })).not.toBeInTheDocument();
});

it('shows the observed WeChat name alongside the stable ID before confirming a binding', async () => {
  const request = vi.fn(async () => ({ enabled: true, items: [{ id: 'contact-1', wechatContactId: 'wxid_dust',
    observedName: 'Dust', observedNameAt: '2026-10-30T01:13:17.000Z', lastObservedAt: '2026-10-30T01:33:15.000Z',
    version: 1, adminId: null, adminName: null }], admins: [] }));
  const user = userEvent.setup();
  render(<WechatBotAdminsPanel deviceId="device-1" api={{ request } as unknown as AdminApi} />);
  expect(await screen.findByText(/Dust/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '管理关联' }));
  expect(screen.getAllByText(/wxid_dust/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Dust/).length).toBeGreaterThan(1);
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, it, expect } from 'vitest';
import { WechatBotMembersPanel } from './wechat-bot-members-panel';
import type { AdminApi } from '../lib/api';

const member = { id: 'm1', deviceId: 'd1', wechatGroupId: 'g@chatroom', groupName: '联赛群', wechatContactId: 'wxid_abc', displayName: null, lastObservedAt: '2026-10-26T10:00:00Z', binding: null };
it.each(['', '本人已核实'])('confirms a zero-prefixed user with optional reason %j', async (reason) => {
  const writes: unknown[] = [];
  const request = vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (options?.method === 'PUT') { writes.push(options.body); return { binding: {} }; }
    if (path.includes('observed-groups')) return { items: [] };
    if (path.includes('user-candidates')) return { user: { id: 'u1', publicUserNo: '001234', displayName: '张三', teams: [{ name: '利物浦', leagueName: '冠军联赛' }] } };
    return { items: [member], nextCursor: null };
  });
  const user = userEvent.setup();
  render(<WechatBotMembersPanel deviceId="d1" deviceName="联赛机器人" api={{ request } as unknown as AdminApi} />);
  await screen.findByText('昵称暂不可用');
  await user.click(screen.getByRole('button', { name: '关联用户' }));
  await user.type(screen.getByLabelText('用户编号'), '001234');
  await user.click(screen.getByRole('button', { name: '查找用户' }));
  await screen.findByText(/张三/);
  expect(writes).toHaveLength(0);
  if (reason) await user.type(screen.getByLabelText('核实说明（选填）'), reason);
  await user.click(screen.getByRole('button', { name: '确认关联' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ userId: 'u1', observedMemberId: 'm1', expectedBindingId: null, expectedVersion: null, reason });
  expect(request.mock.calls.some(([path]) => path.includes('publicUserNo=001234'))).toBe(true);
});

it('does not let a late response from a previous device replace the current list', async () => {
  let resolveOld!: (value: unknown) => void;
  const request = vi.fn((path: string) => {
    if (path.includes('observed-groups')) return Promise.resolve({ items: [] });
    return path.includes('/d1/') ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ items: [{ ...member, id: 'm2', deviceId: 'd2', displayName: '新设备成员' }], nextCursor: null });
  });
  const api = { request } as unknown as AdminApi;
  const { rerender } = render(<WechatBotMembersPanel deviceId="d1" api={api} />);
  rerender(<WechatBotMembersPanel deviceId="d2" api={api} />);
  await screen.findByText('新设备成员');
  resolveOld({ items: [{ ...member, displayName: '旧设备成员' }], nextCursor: null });
  await waitFor(() => expect(screen.queryByText('旧设备成员')).not.toBeInTheDocument());
  expect(screen.getByText('新设备成员')).toBeInTheDocument();
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../lib/api';
import { AdvancementEditor } from './mobile-advancement';
import { DirectTransfer } from './mobile-transfer';
const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const match = { id: id(1), competitionId: id(2), version: 3, roundNumber: 1, homeParticipant: { id: id(3), displayName: '甲队' }, awayParticipant: { id: id(4), displayName: '乙队' }, officialResult: null };
it('previews advancement and retries uncertain submissions with the same key', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
  const saved = vi.fn();
  render(<AdvancementEditor leagueId={id(5)} match={match as never} api={{ request } as unknown as AdminApi} onClose={vi.fn()} onSaved={saved} />);
  expect(screen.getByRole('button', { name: '核对晋级' })).toBeDisabled();
  await userEvent.click(screen.getByRole('radio', { name: /甲队/ }));
  await userEvent.type(screen.getByLabelText('裁定原因'), '乙队弃权');
  await userEvent.click(screen.getByRole('button', { name: '核对晋级' }));
  expect(request).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /确认裁定晋级/ }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('button', { name: /确认裁定晋级/ })).not.toHaveClass('ant-btn-loading'));
  await userEvent.click(screen.getByRole('button', { name: /确认裁定晋级/ }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(request.mock.calls[0]![1].headers).toEqual(request.mock.calls[1]![1].headers);
  expect(request.mock.calls[1]![1].body).toEqual({ winnerParticipantId: id(3), expectedVersion: 3, reason: '乙队弃权' });
});
const teams = [{ id: id(6), name: '转出队', teamNumber: 1 }, { id: id(7), name: '转入队', teamNumber: 2 }];
const roster = { entries: [{ id: id(8), leagueTeamId: id(6), playerName: '测试球员', cardName: '传奇', status: 'ACTIVE', version: 4 }], operations: { TRANSFER: true }, activeWindowName: '转会期' };
function apiRequest() {
  return vi.fn(async (path: string) => {
    if (path.includes('/teams?')) return { items: teams, nextCursor: null };
    if (path.includes('/roster?')) return roster;
    if (path.endsWith('/transfers')) return {};
    throw new Error(path);
  });
}
async function fillTransfer() {
  await userEvent.click(screen.getByRole('button', { name: '办理转会' }));
  await within(screen.getByLabelText('转出球队')).findByRole('option', { name: /转出队/ });
  await userEvent.selectOptions(screen.getByLabelText('转出球队'), id(6));
  await screen.findByRole('option', { name: /测试球员/ });
  await userEvent.selectOptions(screen.getByLabelText('转会球员'), id(8));
  await userEvent.selectOptions(screen.getByLabelText('转入球队'), id(7));
  await userEvent.type(screen.getByLabelText('转会金额（资金）'), '1200');
  await userEvent.type(screen.getByLabelText('转会原因'), '双方协商');
}
it('selects roster ownership and confirms a direct transfer with its frozen version', async () => {
  const request = apiRequest(), saved = vi.fn();
  render(<DirectTransfer leagueId={id(5)} seasonId={id(9)} api={{ request } as unknown as AdminApi} onSaved={saved} />);
  await fillTransfer();
  expect(screen.getByLabelText('转入球队').querySelector(`option[value="${id(6)}"]`)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '核对转会' }));
  expect(request.mock.calls.some(([path]) => path.endsWith('/transfers'))).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: '确认办理转会' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledWith('/v1/admin/roster/transfers', expect.objectContaining({ body: expect.objectContaining({ seasonId: id(9), ownershipId: id(8), targetLeagueTeamId: id(7), amountMinor: 1200, expectedVersion: 4, reason: '双方协商', idempotencyKey: expect.any(String) }) }));
});
it('clears selected ownership immediately when changing the source team', async () => {
  const request = apiRequest();
  render(<DirectTransfer leagueId={id(5)} seasonId={id(9)} api={{ request } as unknown as AdminApi} onSaved={vi.fn()} />);
  await fillTransfer();
  request.mockImplementation(async () => new Promise(() => {}));
  await userEvent.selectOptions(screen.getByLabelText('转出球队'), id(7));
  expect(screen.getByRole('button', { name: '核对转会' })).toBeDisabled();
  expect(screen.queryByRole('option', { name: /测试球员/ })).not.toBeInTheDocument();
});
it('shows a recoverable error for team loading failures', async () => {
  render(<DirectTransfer leagueId={id(5)} seasonId={id(9)} api={{ request: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as AdminApi} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '办理转会' }));
  await screen.findByText('球队加载失败，请重试。');
  expect(screen.getByRole('button', { name: '重新加载球队' })).toBeInTheDocument();
});

it('keeps a direct transfer retry idempotent and blocks duplicate in-flight clicks', async () => {
  const request = apiRequest();
  const original = request.getMockImplementation()!;
  let attempts = 0;
  request.mockImplementation(async (path: string) => {
    if (!path.endsWith('/transfers')) return original(path);
    attempts++;
    if (attempts === 1) throw new Error('network result unknown');
    return new Promise(() => {});
  });
  render(<DirectTransfer leagueId={id(5)} seasonId={id(9)} api={{ request } as unknown as AdminApi} onSaved={vi.fn()} />);
  await fillTransfer();
  await userEvent.click(screen.getByRole('button', { name: '核对转会' }));
  await userEvent.click(screen.getByRole('button', { name: /确认办理转会/ }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('button', { name: /确认办理转会/ })).not.toHaveClass('ant-btn-loading'));
  await userEvent.dblClick(screen.getByRole('button', { name: /确认办理转会/ }));
  const writes = (request.mock.calls as unknown as [string, { body: { idempotencyKey: string } }][]).filter(([path]) => path.endsWith('/transfers'));
  expect(writes).toHaveLength(2);
  expect(writes[0]![1].body.idempotencyKey).toBe(writes[1]![1].body.idempotencyKey);
  expect(screen.getByRole('button', { name: '返回修改' })).toBeDisabled();
});
it('rejects invalid amounts and clears the form when switching seasons', async () => {
  const request = apiRequest();
  const api = { request } as unknown as AdminApi;
  const { rerender } = render(<DirectTransfer leagueId={id(5)} seasonId={id(9)} api={api} onSaved={vi.fn()} />);
  await fillTransfer();
  for (const value of ['-1', '0', '1.5', '4294967296']) {
    await userEvent.clear(screen.getByLabelText('转会金额（资金）'));
    await userEvent.type(screen.getByLabelText('转会金额（资金）'), value);
    expect(screen.getByRole('button', { name: '核对转会' })).toBeDisabled();
  }
  rerender(<DirectTransfer leagueId={id(5)} seasonId={id(10)} api={api} onSaved={vi.fn()} />);
  expect(screen.getByLabelText('转出球队')).toHaveValue('');
  expect(screen.getByLabelText('转会原因')).toHaveValue('');
});
it('does not allow transfer when the roster reports a closed window', async () => {
  const request = apiRequest();
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (path: string) => path.includes('/roster?') ? { ...roster, operations: { TRANSFER: false } } : original(path));
  render(<DirectTransfer leagueId={id(5)} seasonId={id(9)} api={{ request } as unknown as AdminApi} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '办理转会' }));
  await within(screen.getByLabelText('转出球队')).findByRole('option', { name: /转出队/ });
  await userEvent.selectOptions(screen.getByLabelText('转出球队'), id(6));
  await screen.findByText('所选赛季当前不允许转会，请核对转会窗口。');
  expect(screen.getByLabelText('转会球员')).toBeDisabled();
  expect(screen.getByRole('button', { name: '核对转会' })).toBeDisabled();
});

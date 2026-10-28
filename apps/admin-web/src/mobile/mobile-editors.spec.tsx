import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../lib/api';
import { ScoreEditor, TransferEditor } from './mobile-editors';

const match = { id: 'm', competitionId: 'c', version: 3, roundNumber: 2, homeParticipant: { displayName: '主队' }, awayParticipant: { displayName: '客队' }, officialResult: null };
const proposal = { id: 'p', playerName: '瓦拉内', sourceTeamName: '主队', targetTeamName: '客队', amountMinor: 15000, status: 'PENDING_ADMIN', counterpartyConfirmed: true, version: 4, events: [] };

it('requires a reason and preview before writing a score with the original version', async () => {
  const request = vi.fn().mockResolvedValue({}); const saved = vi.fn();
  render(<ScoreEditor leagueId="l" match={match as never} api={{ request } as unknown as AdminApi} onClose={vi.fn()} onSaved={saved} />);
  expect(screen.getByRole('button', { name: '核对比分' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('主队比分'), '0');
  await userEvent.type(screen.getByLabelText('客队比分'), '0');
  await userEvent.type(screen.getByLabelText('录入或修正原因'), '双方已确认');
  await userEvent.click(screen.getByRole('button', { name: '核对比分' }));
  expect(request).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /确认提交比分/ }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(request).toHaveBeenCalledWith('/v1/admin/leagues/l/competitions/c/matches/m/results', expect.objectContaining({ body: { homeScore: 0, awayScore: 0, reason: '双方已确认', expectedVersion: 3 }, headers: { 'Idempotency-Key': expect.any(String) } }));
});

it('keeps the same key when retrying an uncertain score submission', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
  render(<ScoreEditor leagueId="l" match={match as never} api={{ request } as unknown as AdminApi} onClose={vi.fn()} onSaved={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('主队比分'), '3'); await userEvent.type(screen.getByLabelText('客队比分'), '1');
  await userEvent.type(screen.getByLabelText('录入或修正原因'), '核实');
  await userEvent.click(screen.getByRole('button', { name: '核对比分' }));
  await userEvent.click(screen.getByRole('button', { name: /确认提交比分/ }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('button', { name: /确认提交比分/ })).not.toHaveClass('ant-btn-loading'));
  await userEvent.click(screen.getByRole('button', { name: /确认提交比分/ }));
  expect(request.mock.calls[0]![1].headers).toEqual(request.mock.calls[1]![1].headers);
});

it('reviews the selected frozen proposal and requires a reason', async () => {
  const request = vi.fn().mockResolvedValue({});
  render(<TransferEditor leagueId="l" proposal={proposal as never} api={{ request } as unknown as AdminApi} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByRole('button', { name: '确认批准转会' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '驳回' }));
  await userEvent.type(screen.getByLabelText('审核理由'), '双方需要重新议价');
  await userEvent.click(screen.getByRole('button', { name: '确认驳回转会' }));
  expect(request).toHaveBeenCalledWith('/v1/admin/leagues/l/transfer-proposals/p/review', expect.objectContaining({ body: { decision: 'REJECT', expectedVersion: 4, reason: '双方需要重新议价' } }));
});

it('does not permit review of an already processed transfer', () => {
  render(<TransferEditor leagueId="l" proposal={{ ...proposal, status: 'APPROVED' } as never} api={{ request: vi.fn() } as unknown as AdminApi} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '确认批准转会' })).not.toBeInTheDocument();
});

it('rejects decimal and out-of-range scores before allowing confirmation', async () => {
  render(<ScoreEditor leagueId="l" match={match as never} api={{ request: vi.fn() } as unknown as AdminApi} onClose={vi.fn()} onSaved={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('录入或修正原因'), '核对');
  await userEvent.type(screen.getByLabelText('客队比分'), '1');
  await userEvent.type(screen.getByLabelText('主队比分'), '-1');
  expect(screen.getByRole('button', { name: '核对比分' })).toBeDisabled();
  await userEvent.clear(screen.getByLabelText('主队比分'));
  await userEvent.type(screen.getByLabelText('主队比分'), '1.');
  expect(screen.getByRole('button', { name: '核对比分' })).toBeDisabled();
});

it('blocks duplicate transfer submissions while the first request is in flight', async () => {
  const request = vi.fn(() => new Promise(() => {}));
  render(<TransferEditor leagueId="l" proposal={proposal as never} api={{ request } as unknown as AdminApi} onClose={vi.fn()} onSaved={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('审核理由'), '已核实');
  await userEvent.dblClick(screen.getByRole('button', { name: '确认批准转会' }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('审核理由')).toBeDisabled();
});

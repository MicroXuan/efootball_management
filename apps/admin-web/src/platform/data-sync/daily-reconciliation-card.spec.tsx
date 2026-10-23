import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminApi } from '../../lib/api';
import { DailyReconciliationCard } from './daily-reconciliation-card';

describe('DailyReconciliationCard', () => {
  it('lets an administrator save the daily time and timezone', async () => {
    const request = vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (path.endsWith('/players/schedule') && options?.method === 'PUT') {
        return { ...(options.body as object), lastTriggeredDate: null };
      }
      if (path.endsWith('/players/schedule')) {
        return { enabled: false, timeZone: 'UTC', localTime: '03:00', lastTriggeredDate: null };
      }
      throw new Error(`Unexpected path ${path}`);
    });
    render(<DailyReconciliationCard api={{ request } as unknown as AdminApi} selectedRunId={null} onChanged={vi.fn()} />);

    expect(await screen.findByText('每日球员库对账')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('时区'), { target: { value: 'Asia/Shanghai' } });
    fireEvent.change(screen.getByLabelText('每日开始时间'), { target: { value: '04:30' } });
    fireEvent.click(screen.getByRole('button', { name: '保存时间设置' }));

    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/admin/data-sync/players/schedule',
      expect.objectContaining({ method: 'PUT', body: { enabled: false, timeZone: 'Asia/Shanghai', localTime: '04:30' } })));
  });

  it('continues publishing pending batches from a single confirmation', async () => {
    let publishCalls = 0;
    const request = vi.fn(async (path: string, options?: { method?: string }) => {
      if (path.endsWith('/players/schedule')) {
        return { enabled: false, timeZone: 'UTC', localTime: '03:00', lastTriggeredDate: null };
      }
      if (path.includes('/publish-valid') && options?.method === 'POST') {
        publishCalls += 1;
        return { published: 1, skipped: 0, failed: 0, remaining: publishCalls === 1 ? 1 : 0,
          failures: [] };
      }
      if (path.includes('/reconciliation?')) {
        return { runId: '33333333-3333-4333-8333-333333333333', status: 'READY', phase: 'READY',
          trusted: true, warningCode: null, sourceTotal: 2, publicActive: 0,
          businessDate: '2026-10-23', startedAt: null, finishedAt: null,
          counts: { ADDED: 2 }, page: 1, pageSize: 20, total: 0, items: [] };
      }
      throw new Error(`Unexpected path ${path}`);
    });
    render(<DailyReconciliationCard api={{ request } as unknown as AdminApi}
      selectedRunId="33333333-3333-4333-8333-333333333333" selectedRunMode="RECONCILE"
      onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '一键发布有效变更' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认发布' }));
    await waitFor(() => expect(publishCalls).toBe(2));
    expect(await screen.findByText('成功发布 2 个批次；跳过 0 个，失败 0 个')).toBeInTheDocument();
  });
});

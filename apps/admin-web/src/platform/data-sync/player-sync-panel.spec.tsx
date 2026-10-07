import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AdminApi } from '../../lib/api';
import { ApiError } from '../../lib/api';
import { PlayerSyncPanel } from './player-sync-panel';

const runId = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';
const recordId = '33333333-3333-4333-8333-333333333333';

const run = {
  id: runId, kind: 'PLAYER_CARDS', mode: 'INCREMENTAL', status: 'READY', actorAdminId: '44444444-4444-4444-8444-444444444444',
  currentPhase: 'READY', heartbeatAt: null, leaseExpiresAt: null, resumable: false,
  counters: { sourceTotal: 43000, scanned: 43000, fetched: 100, skipped: 0, added: 0, updated: 0, missing: 0, failed: 1, batches: 1 },
  errorCode: null, errorMessage: null, startedAt: null, completedAt: '2026-10-07T00:00:00.000Z',
  createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z'
};

const batch = {
  id: batchId, sourceCode: 'pesdata', fileName: 'pesdata-players-001.json', format: 'JSON', checksum: 'a'.repeat(64), status: 'READY',
  totalCount: 43000, createCount: 100, updateCount: 20, unchangedCount: 42880, invalidCount: 0, failureReason: null,
  releaseId: null, releaseSequence: null, createdBy: run.actorAdminId, createdAt: run.createdAt, publishedAt: null
};

const record = {
  id: recordId, batchId, rowNumber: 1, externalId: 'card-001', diffType: 'UPDATE', raw: {},
  normalized: { externalId: 'card-001', playerNameZh: '测试球员', cardName: '精选', position: 'CMF', overallRating: 97, cardType: 'FEATURED', packName: '周精选', imageUrl: 'https://media.example.com/card.webp', status: 'ACTIVE', skills: [], attributes: {} },
  fieldDiff: { overallRating: { before: 96, after: 97 } },
  validationErrors: [{ code: 'IMAGE_INVALID', path: 'imageUrl', message: '图片无效' }], targetPlayerId: null, targetCardId: null
};

function fixture({ publishFails = false, resumableRun = false } = {}) {
  const request = vi.fn(async (path: string) => {
    if (path.includes('/publish')) {
      if (publishFails) throw new ApiError({ status: 409, code: 'IMPORT_BATCH_NOT_READY' });
      return { ...batch, status: 'PUBLISHED' };
    }
    if (path.includes('/records')) return { items: [record], page: 1, pageSize: 20, total: 43000, summary: { create: 100, update: 20, unchanged: 42880, invalid: 0 } };
    if (path.includes('/batches')) return { items: [batch], page: path.includes('page=2') ? 2 : 1, pageSize: 20, total: 43000, summary: { uploaded: 0, validated: 0, ready: 1, published: 0, failed: 0, cancelled: 0 } };
    if (path.includes('/runs')) return {
      items: [{ ...run, status: resumableRun ? 'FAILED' : 'READY', resumable: resumableRun, errorCode: resumableRun ? 'PROCESS_INTERRUPTED' : null }],
      page: 1, pageSize: 20, total: 1,
      summary: { pending: 0, running: 0, ready: resumableRun ? 0 : 1, paused: 0, failed: resumableRun ? 1 : 0 }
    };
    throw new Error(`Unexpected path: ${path}`);
  });
  return { api: { request } as unknown as AdminApi, request };
}

describe('PlayerSyncPanel', () => {
  it('uses server pagination, default exception filters, and only 20/50 page sizes', async () => {
    const { api, request } = fixture();
    render(<PlayerSyncPanel api={api} onChanged={vi.fn()} onResumeRun={vi.fn()} />);

    expect(await screen.findByText('共 43000 条')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(expect.stringContaining('status=READY%2CVALIDATED%2CFAILED'), expect.anything());
    expect(screen.queryByText('第 21 条以后未请求的数据')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('page=2&pageSize=20'), expect.anything()));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '每页条数' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('20'), expect.stringContaining('50')]));
    expect(options.some((option) => option.textContent?.includes('100'))).toBe(false);
  });

  it('shows record differences and keeps a specific publish error visible', async () => {
    const { api } = fixture({ publishFails: true });
    render(<PlayerSyncPanel api={api} onChanged={vi.fn()} onResumeRun={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '查看记录' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看详情' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('overallRating')).toBeInTheDocument();
    expect(within(drawer).getByText('IMAGE_INVALID')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '发布批次' }));
    expect(await screen.findByText('将发布整个导入批次')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    expect(await screen.findByText(/IMPORT_BATCH_NOT_READY/)).toBeInTheDocument();
    expect(screen.getAllByText('共 43000 条').length).toBeGreaterThan(0);
  });

  it('filters large batch records by difference type and search text', async () => {
    const { api, request } = fixture();
    render(<PlayerSyncPanel api={api} onChanged={vi.fn()} onResumeRun={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '查看记录' }));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '记录差异类型' }));
    fireEvent.click(await screen.findByText('无效'));
    const search = screen.getByRole('searchbox', { name: '搜索球员卡记录' });
    fireEvent.change(search, { target: { value: '梅西' } });
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      expect.stringContaining('diffType=INVALID'), expect.anything()
    ));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      expect.stringContaining('query=%E6%A2%85%E8%A5%BF'), expect.anything()
    ));
  });

  it('offers an explicit recovery action for an interrupted run', async () => {
    const { api } = fixture({ resumableRun: true });
    const onResumeRun = vi.fn().mockResolvedValue(undefined);
    render(<PlayerSyncPanel api={api} onChanged={vi.fn()} onResumeRun={onResumeRun} />);

    fireEvent.click(await screen.findByRole('button', { name: '继续任务' }));
    await waitFor(() => expect(onResumeRun).toHaveBeenCalledWith(runId));
    await waitFor(() => expect(screen.getByText('继续任务').closest('button')).not.toHaveClass('ant-btn-loading'));
  });

  it('refreshes history and review batches when the overview run state changes', async () => {
    const { api, request } = fixture();
    const view = render(<PlayerSyncPanel api={api} onChanged={vi.fn()} onResumeRun={vi.fn()} refreshKey="run:RUNNING" />);
    await screen.findByText('共 43000 条');
    const before = request.mock.calls.length;

    view.rerender(<PlayerSyncPanel api={api} onChanged={vi.fn()} onResumeRun={vi.fn()} refreshKey="idle:READY:2026-10-07" />);

    await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(before));
    expect(request.mock.calls.filter(([path]) => String(path).includes('/runs?')).length).toBeGreaterThanOrEqual(2);
    expect(request.mock.calls.filter(([path]) => String(path).includes('/batches?')).length).toBeGreaterThanOrEqual(2);
  });

  it('switches review data to the newest run after a terminal refresh', async () => {
    const newerRunId = 'aaaaaaaa-1111-4111-8111-111111111111';
    let completed = false;
    const request = vi.fn(async (path: string) => {
      if (path.includes('/runs?')) return {
        items: completed ? [{ ...run, id: newerRunId, createdAt: '2026-10-07T01:00:00.000Z' }, run] : [run],
        page: path.includes('page=2') ? 2 : 1, pageSize: 20, total: completed ? 22 : 21,
        summary: { pending: 0, running: 0, ready: completed ? 2 : 1, paused: 0, failed: 0 }
      };
      if (path.includes('/batches')) return {
        items: [], page: 1, pageSize: 20, total: 0,
        summary: { uploaded: 0, validated: 0, ready: 0, published: 0, failed: 0, cancelled: 0 }
      };
      throw new Error(`Unexpected path: ${path}`);
    });
    const api = { request } as unknown as AdminApi;
    const view = render(<PlayerSyncPanel api={api} onChanged={vi.fn()} onResumeRun={vi.fn()} refreshKey="run:RUNNING" />);
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining(`/runs/${runId}/batches`), expect.anything()));
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('/runs?page=2'), expect.anything()));

    completed = true;
    view.rerender(<PlayerSyncPanel api={api} onChanged={vi.fn()} onResumeRun={vi.fn()} refreshKey="idle:READY:2026-10-07T01:00:00.000Z" />);

    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining(`/runs/${newerRunId}/batches`), expect.anything()));
  });
});

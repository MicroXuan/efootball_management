import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../../lib/api';
import { TeamSyncPanel } from './team-sync-panel';

const runId = '11111111-1111-4111-8111-111111111111';
const ids = Array.from({ length: 20 }, (_, index) => `${String(index + 10).padStart(8, '0')}-1111-4111-8111-111111111111`);
const run = {
  id: runId, kind: 'TEAM_SHELLS', mode: 'INCREMENTAL', status: 'READY', actorAdminId: '99999999-1111-4111-8111-111111111111',
  currentPhase: 'READY', heartbeatAt: null, leaseExpiresAt: null, resumable: false,
  counters: { sourceTotal: null, scanned: 981, fetched: 0, skipped: 0, added: 900, updated: 80, missing: 1, failed: 1, batches: 0 },
  errorCode: null, errorMessage: null, startedAt: null, completedAt: '2026-10-07T00:00:00.000Z', createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z'
};

const items = ids.map((id, index) => ({
  id, runId, sourceExternalId: `team-${index + 1}`, changeType: index === 2 ? 'UPDATED' : 'ADDED',
  reviewStatus: index === 2 ? 'FAILED' : 'PENDING', currentCatalogItemId: index === 2 ? '88888888-1111-4111-8111-111111111111' : null,
  current: index === 2 ? { nameZh: '旧球队名', nameEn: 'Old Team', shortName: 'OLD', remoteLogoUrl: 'https://remote.example.com/old.png', storedLogoUrl: 'https://media.example.com/old.png', logoChecksum: 'a'.repeat(64), sourceChecksum: 'b'.repeat(64) } : null,
  candidate: { sourceExternalId: `team-${index + 1}`, sourceLeagueExternalId: 'league-1', sourceLeagueName: '荷甲', nameZh: index === 2 ? '新球队名' : `球队 ${index + 1}`, nameEn: `Team ${index + 1}`, nameJa: null, shortName: `T${index + 1}`, remoteLogoUrl: 'https://remote.example.com/new.png', storedLogoUrl: 'https://media.example.com/new.png', sourceUpdatedAt: null },
  candidateLogoChecksum: 'c'.repeat(64), candidateSourceChecksum: 'd'.repeat(64),
  errorCode: index === 2 ? 'CREST_INVALID' : null, errorMessage: index === 2 ? '队徽校验失败' : null
}));

function fixture() {
  const request = vi.fn(async (path: string, options?: { method?: string; body?: { ids?: string[] } }) => {
    if (path.endsWith('/publish') && options?.method === 'POST') return {
      requestedCount: options.body?.ids?.length ?? 0,
      succeededIds: options.body?.ids?.slice(0, 2) ?? [],
      failed: options.body?.ids?.slice(2).map((id) => ({ id, code: 'TEAM_SYNC_ITEM_NOT_PENDING', message: '状态已变化' })) ?? []
    };
    if (path.endsWith('/reject') || path.endsWith('/retry')) return { requestedCount: 0, succeededIds: [], failed: [] };
    if (path.includes('/items')) {
      if (path.includes('status=') && decodeURIComponent(path).includes('PUBLISHED')) return { items: [{ ...items[0], reviewStatus: 'PUBLISHED' }], page: 1, pageSize: 20, total: 1, summary: { pending: 19, failed: 1, published: 1, rejected: 0, errors: [{ code: 'CREST_INVALID', count: 1 }] } };
      return { items, page: 1, pageSize: path.includes('pageSize=50') ? 50 : 20, total: 981, summary: { pending: 19, failed: 1, published: 0, rejected: 0, errors: [{ code: 'CREST_INVALID', count: 1 }] } };
    }
    if (path.includes('/runs')) return { items: [run], page: 1, pageSize: 20, total: 1, summary: { pending: 0, running: 0, ready: 1, paused: 0, failed: 0 } };
    throw new Error(`Unexpected path: ${path}`);
  });
  return { api: { request } as unknown as AdminApi, request };
}

describe('TeamSyncPanel', () => {
  it('shows only the current server page and applies exception-first filters', async () => {
    const { api, request } = fixture();
    render(<TeamSyncPanel api={api} onChanged={vi.fn()} />);

    expect(await screen.findByText('共 981 条')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '查看详情' })).toHaveLength(20);
    expect(request).toHaveBeenCalledWith(expect.stringContaining('status=PENDING%2CFAILED'), expect.anything());
    expect(screen.queryByText('已发布球队')).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '审核状态' }));
    await userEvent.click(await screen.findByText('已发布'));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('PUBLISHED'), expect.anything()));

    await userEvent.click(screen.getByRole('button', { name: /CREST_INVALID/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('errorCode=CREST_INVALID'), expect.anything()));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '每页条数' }));
    const options = await screen.findAllByRole('option');
    await userEvent.click(options.find((option) => option.textContent?.includes('50'))!);
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('page=1&pageSize=50'), expect.anything()));
  });

  it('reports partial batch results and shows readable old/new detail without raw JSON', async () => {
    const { api } = fixture();
    render(<TeamSyncPanel api={api} onChanged={vi.fn()} />);
    await screen.findByText('共 981 条');
    for (const id of ids.slice(0, 3)) await userEvent.click(screen.getByRole('checkbox', { name: `选择 ${id}` }));
    await userEvent.click(screen.getByRole('button', { name: '批量发布' }));
    const confirmation = await screen.findByText(/将发布 3 条队壳/);
    expect(confirmation.parentElement).toHaveTextContent(ids[0]!);
    expect(confirmation.parentElement).toHaveTextContent(ids[2]!);
    await userEvent.click(screen.getByRole('button', { name: '确认发布' }));
    expect(await screen.findByText('成功 2 条，失败 1 条')).toBeInTheDocument();
    expect(screen.getByText(/TEAM_SYNC_ITEM_NOT_PENDING/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: '查看详情' })[2]!);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('旧球队名')).toBeInTheDocument();
    expect(within(drawer).getByText('新球队名')).toBeInTheDocument();
    expect(within(drawer).getByText('https://media.example.com/old.png')).toBeInTheDocument();
    expect(within(drawer).getByText('https://media.example.com/new.png')).toBeInTheDocument();
    expect(within(drawer).getByText(/CREST_INVALID/)).toBeInTheDocument();
    expect(within(drawer).queryByText(/rawDetail/)).not.toBeInTheDocument();
  });
});

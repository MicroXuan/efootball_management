import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AdminApi } from '../../lib/api';
import { DataSyncPage } from './data-sync-page';

const overview = {
  players: { activeRun: null, pendingReview: 3, failedReview: 1, published: 20, lastCompletedAt: null },
  teams: { activeRun: null, pendingReview: 5, failedReview: 2, published: 980, lastCompletedAt: null }
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

const api = {
  request: vi.fn().mockResolvedValue(overview)
} as unknown as AdminApi;

describe('DataSyncPage', () => {
  it('defaults to player cards and persists the selected data domain in the URL', async () => {
    render(<MemoryRouter initialEntries={['/platform/data-sync']}>
      <DataSyncPage api={api} />
      <LocationProbe />
    </MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '数据同步' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /球员卡/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /球队队壳/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /球队队壳/ }));
    await waitFor(() => expect(screen.getByLabelText('current location')).toHaveTextContent('/platform/data-sync?tab=teams'));
    expect(screen.getByRole('tab', { name: /球队队壳/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('restores the team-shell tab after a refresh URL', async () => {
    render(<MemoryRouter initialEntries={['/platform/data-sync?tab=teams']}><DataSyncPage api={api} /></MemoryRouter>);
    expect(await screen.findByRole('tab', { name: /球队队壳/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('resumes the exact interrupted run selected from history', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const failedRun = {
      id: runId, kind: 'PLAYER_CARDS', mode: 'INCREMENTAL', status: 'FAILED',
      actorAdminId: '22222222-2222-4222-8222-222222222222', currentPhase: 'INTERRUPTED',
      heartbeatAt: '2026-10-07T00:00:00.000Z', leaseExpiresAt: null, resumable: true,
      counters: { sourceTotal: 43000, scanned: 1000, fetched: 900, skipped: 0, added: 0, updated: 0, missing: 0, failed: 1, batches: 1 },
      errorCode: 'PROCESS_INTERRUPTED', errorMessage: 'Synchronization process was interrupted and can be resumed',
      startedAt: '2026-10-07T00:00:00.000Z', completedAt: '2026-10-07T00:10:00.000Z',
      createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:10:00.000Z'
    };
    const request = vi.fn(async (path: string) => {
      if (path === `/v1/admin/data-sync/players/runs/${runId}/resume`) return { runId, status: 'PENDING' };
      if (path === '/v1/admin/data-sync/overview') return overview;
      if (path.startsWith('/v1/admin/data-sync/players/runs?')) return {
        items: [failedRun], page: 1, pageSize: 20, total: 1,
        summary: { pending: 0, running: 0, ready: 0, paused: 0, failed: 1 }
      };
      if (path.includes('/batches?')) return {
        items: [], page: 1, pageSize: 20, total: 0,
        summary: { uploaded: 0, validated: 0, ready: 0, published: 0, failed: 0, cancelled: 0 }
      };
      throw new Error(`Unexpected path: ${path}`);
    });
    render(<MemoryRouter initialEntries={['/platform/data-sync']}><DataSyncPage api={{ request } as unknown as AdminApi} /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '继续任务' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      `/v1/admin/data-sync/players/runs/${runId}/resume`,
      expect.objectContaining({ method: 'POST' })
    ));
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../lib/api';
import { TeamCatalogSyncCard } from './team-catalog-sync-card';

const run = {
  id: '11111111-1111-4111-8111-111111111111', mode: 'SAMPLE' as const, status: 'READY' as const,
  scannedCount: 1, addedCount: 1, updatedCount: 0, missingCount: 0, failedCount: 0,
  createdAt: '2026-10-06T00:00:00.000Z', completedAt: '2026-10-06T00:01:00.000Z', errorCode: null
};
const difference = {
  id: '22222222-2222-4222-8222-222222222222', runId: run.id, sourceExternalId: 'ajax',
  changeType: 'ADDED' as const, reviewStatus: 'PENDING' as const, currentCatalogItemId: null, errorCode: null,
  candidate: {
    sourceExternalId: 'ajax', sourceLeagueExternalId: 'eredivisie', sourceLeagueName: '荷甲',
    nameZh: '阿贾克斯', nameEn: 'Ajax', nameJa: null, shortName: 'AJA', remoteLogoUrl: null,
    storedLogoUrl: 'https://assets.example/ajax.png', sourceUpdatedAt: null
  }
};

it('uses only local admin APIs and requires explicit publication of staged differences', async () => {
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/sync-runs') && options?.method === 'POST') return { runId: run.id, status: 'READY' };
    if (path.endsWith('/sync-runs')) return { items: [run] };
    if (path.endsWith('/items')) return { items: [difference] };
    if (path.endsWith('/publish')) return { ok: true };
    throw new Error(`Unexpected request: ${path}`);
  });
  const api: AdminApi = {
    restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined),
    request: request as AdminApi['request']
  };
  render(<TeamCatalogSyncCard api={api} />);

  expect(await screen.findByText('阿贾克斯')).toBeInTheDocument();
  expect(request.mock.calls.map(([path]) => path).every((path) => String(path).startsWith('/v1/admin/'))).toBe(true);
  expect(request.mock.calls.map(([path]) => path).join(' ')).not.toContain('pesdata.net');
  await userEvent.click(screen.getByRole('button', { name: /发\s*布/ }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/team-catalog/sync-items/${difference.id}/publish`, expect.objectContaining({ method: 'POST' })
  ));
});

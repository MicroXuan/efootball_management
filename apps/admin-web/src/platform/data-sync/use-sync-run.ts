import { useCallback, useEffect } from 'react';
import type { PlatformSyncStatus } from '@efm/contracts';

const ACTIVE_STATUSES = new Set<PlatformSyncStatus>(['PENDING', 'RUNNING']);

export function useSyncRun({ status, refresh, intervalMs = 2_500 }: {
  status: PlatformSyncStatus | null;
  refresh: () => Promise<unknown>;
  intervalMs?: number;
}) {
  const refreshAfterMutation = useCallback(() => refresh(), [refresh]);

  useEffect(() => {
    if (!status || !ACTIVE_STATUSES.has(status)) return undefined;
    const timer = window.setInterval(() => { void refresh(); }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, refresh, status]);

  return { refreshAfterMutation };
}

import { act, renderHook } from '@testing-library/react';
import { useSyncRun } from './use-sync-run';

describe('useSyncRun', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['PENDING', 'RUNNING'] as const)('polls every 2.5 seconds while status is %s', async (status) => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useSyncRun({ status, refresh }));

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it.each(['READY', 'FAILED'] as const)('does not poll terminal status %s', async (status) => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useSyncRun({ status, refresh }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes immediately after a start or resume mutation', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSyncRun({ status: null, refresh }));
    await act(async () => { await result.current.refreshAfterMutation(); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

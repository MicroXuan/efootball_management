import { render, screen } from '@testing-library/react';
import type { PlatformSyncRunSummary } from '@efm/contracts';
import { SyncRunCard } from './sync-run-card';

const run: PlatformSyncRunSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'PLAYER_CARDS',
  mode: 'INCREMENTAL',
  status: 'RUNNING',
  actorAdminId: '22222222-2222-4222-8222-222222222222',
  currentPhase: 'FETCHING',
  heartbeatAt: '2026-10-07T00:00:00.000Z',
  leaseExpiresAt: '2026-10-07T00:01:00.000Z',
  resumable: false,
  counters: { sourceTotal: 200, scanned: 120, fetched: 100, skipped: 10, added: 5, updated: 2, missing: 0, failed: 3, batches: 0 },
  errorCode: null,
  errorMessage: null,
  startedAt: '2026-10-07T00:00:00.000Z',
  completedAt: null,
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:30.000Z'
};

describe('SyncRunCard', () => {
  it('explains an active task with business language instead of internal phase codes', () => {
    render(<SyncRunCard kind="PLAYER_CARDS" run={run} pendingReview={2} failedReview={3} published={911} onStart={vi.fn()} onResume={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '当前同步任务' })).toBeInTheDocument();
    expect(screen.getByText('正在获取球员卡')).toBeInTheDocument();
    expect(screen.queryByText('FETCHING')).not.toBeInTheDocument();
    expect(screen.getByText('待确认批次')).toBeInTheDocument();
    expect(screen.getByText('已发布批次')).toBeInTheDocument();
    expect(screen.getByText('本次已检查')).toBeInTheDocument();
  });

  it('says there is no current task instead of implying sync has never run', () => {
    render(<SyncRunCard kind="TEAM_SHELLS" run={null} pendingReview={2} failedReview={70} published={911} onStart={vi.fn()} onResume={vi.fn()} />);

    expect(screen.getByText('当前没有同步任务')).toBeInTheDocument();
    expect(screen.queryByText('尚未运行')).not.toBeInTheDocument();
    expect(screen.getByText('待确认队壳')).toBeInTheDocument();
    expect(screen.getByText('正式队壳')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新变化数据' })).toBeInTheDocument();
  });
});

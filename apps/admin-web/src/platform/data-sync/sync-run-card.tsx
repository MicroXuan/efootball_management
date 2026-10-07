import { Button, Card, Popconfirm, Space, Tag } from 'antd';
import type { PlatformSyncMode, PlatformSyncRunSummary } from '@efm/contracts';

const statusCopy: Record<PlatformSyncRunSummary['status'], { label: string; color: string }> = {
  PENDING: { label: '排队中', color: 'processing' },
  RUNNING: { label: '同步中', color: 'processing' },
  READY: { label: '同步完成 · 待审核', color: 'success' },
  PAUSED: { label: '已暂停', color: 'warning' },
  FAILED: { label: '同步失败', color: 'error' }
};

export function SyncRunCard({ kind, run, pendingReview, failedReview, published, busy = false, onStart, onResume }: {
  kind: 'PLAYER_CARDS' | 'TEAM_SHELLS';
  run: PlatformSyncRunSummary | null;
  pendingReview: number;
  failedReview: number;
  published: number;
  busy?: boolean;
  onStart: (mode: Exclude<Lowercase<PlatformSyncMode>, 'resume'>) => Promise<void>;
  onResume: () => Promise<void>;
}) {
  const active = run?.status === 'PENDING' || run?.status === 'RUNNING';
  const title = kind === 'PLAYER_CARDS' ? '球员卡数据' : '球队队壳数据';
  return <Card className={`data-card sync-run-card${active ? ' sync-run-card--active' : ''}`}>
    <div className="sync-run-card__head">
      <div><span className="section-kicker">PESDATA · {kind === 'PLAYER_CARDS' ? 'PLAYER CARDS' : 'TEAM SHELLS'}</span><h2>{title}</h2></div>
      {run ? <Tag color={statusCopy[run.status].color}>{statusCopy[run.status].label}</Tag> : <Tag>尚未运行</Tag>}
    </div>
    <div className="sync-run-card__pulse" aria-hidden="true"><span /><span /><span /><span /></div>
    <dl className="sync-run-card__metrics">
      <div><dt>待审核</dt><dd>{pendingReview}</dd></div>
      <div><dt>失败</dt><dd>{failedReview}</dd></div>
      <div><dt>已发布</dt><dd>{published}</dd></div>
      <div><dt>本次扫描</dt><dd>{run?.counters.scanned ?? '—'}</dd></div>
    </dl>
    {run ? <div className="sync-run-card__status">
      <span>当前阶段</span><strong>{run.currentPhase ?? statusCopy[run.status].label}</strong>
      {run.errorMessage ? <small>{run.errorMessage}</small> : null}
    </div> : <p className="sync-run-card__empty">建议先用抽样同步验证数据；日常更新使用增量同步。</p>}
    <Space wrap className="sync-run-card__actions">
      <Button disabled={active || busy} onClick={() => void onStart('sample')}>抽样同步</Button>
      <Button type="primary" disabled={active || busy} loading={busy} onClick={() => void onStart('incremental')}>增量同步</Button>
      <Popconfirm
        title="确认开始全量同步？"
        description="全量同步耗时更长，并会产生更多待审核数据。"
        okText="开始全量同步"
        cancelText="取消"
        onConfirm={() => onStart('full')}
      ><Button danger disabled={active || busy}>全量同步</Button></Popconfirm>
      {run?.resumable ? <Button disabled={busy} onClick={() => void onResume()}>继续上次任务</Button> : null}
    </Space>
  </Card>;
}

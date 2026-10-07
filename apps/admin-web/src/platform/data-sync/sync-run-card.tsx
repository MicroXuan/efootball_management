import { Button, Card, Popconfirm, Space, Tag } from 'antd';
import type { PlatformSyncMode, PlatformSyncRunSummary } from '@efm/contracts';

const statusCopy: Record<PlatformSyncRunSummary['status'], { label: string; color: string }> = {
  PENDING: { label: '排队中', color: 'processing' },
  RUNNING: { label: '同步中', color: 'processing' },
  READY: { label: '同步完成', color: 'success' },
  PAUSED: { label: '已暂停', color: 'warning' },
  FAILED: { label: '同步失败', color: 'error' }
};

const phaseCopy: Record<string, { players: string; teams: string }> = {
  QUEUED: { players: '正在等待开始', teams: '正在等待开始' },
  FETCHING: { players: '正在获取球员卡', teams: '正在获取球队和队徽' },
  IMPORTING: { players: '正在整理待确认数据', teams: '正在整理待确认数据' },
  READY: { players: '数据已准备好，请确认后发布', teams: '数据已准备好，请确认后发布' },
  INTERRUPTED: { players: '任务中断，可以继续执行', teams: '任务中断，可以继续执行' },
  FAILED: { players: '同步失败，请查看原因', teams: '同步失败，请查看原因' }
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
  const isPlayers = kind === 'PLAYER_CARDS';
  const dataName = isPlayers ? '球员卡' : '球队队壳';
  const metricLabels = isPlayers
    ? { pending: '待确认批次', failed: '失败批次', published: '已发布批次' }
    : { pending: '待确认队壳', failed: '失败队壳', published: '正式队壳' };
  const phase = run?.currentPhase
    ? phaseCopy[run.currentPhase]?.[isPlayers ? 'players' : 'teams'] ?? statusCopy[run.status].label
    : run ? statusCopy[run.status].label : null;
  return <Card className={`data-card sync-run-card${active ? ' sync-run-card--active' : ''}`}>
    <div className="sync-run-card__head">
      <div><span className="section-kicker">PESDATA · {dataName}</span><h2>当前同步任务</h2><p>检查 PESDATA 的{dataName}变化，确认后再进入正式目录。</p></div>
      {run ? <Tag color={statusCopy[run.status].color}>{statusCopy[run.status].label}</Tag> : <Tag>当前无任务</Tag>}
    </div>
    <div className="sync-run-card__pulse" aria-hidden="true"><span /><span /><span /><span /></div>
    <dl className="sync-run-card__metrics">
      <div><dt>{metricLabels.pending}</dt><dd>{pendingReview}</dd></div>
      <div><dt>{metricLabels.failed}</dt><dd>{failedReview}</dd></div>
      <div><dt>{metricLabels.published}</dt><dd>{published}</dd></div>
      <div><dt>{run ? '本次已检查' : '最近一次检查'}</dt><dd>{run?.counters.scanned ?? '—'}</dd></div>
    </dl>
    {run ? <div className="sync-run-card__status">
      <span>当前进度</span><strong>{phase}</strong>
      {run.errorMessage ? <small>{run.errorMessage}</small> : null}
    </div> : <p className="sync-run-card__empty"><strong>当前没有同步任务</strong><span>日常更新请选择“更新变化数据”；首次验证数据可使用“抽样检查”。</span></p>}
    <Space wrap className="sync-run-card__actions">
      <Button disabled={active || busy} onClick={() => void onStart('sample')}>抽样检查</Button>
      <Button type="primary" disabled={active || busy} loading={busy} onClick={() => void onStart('incremental')}>更新变化数据</Button>
      <Popconfirm
        title="确认重新检查全部数据？"
        description="该操作耗时较长，并会产生更多等待确认的数据。"
        okText="开始全部检查"
        cancelText="取消"
        onConfirm={() => onStart('full')}
      ><Button danger disabled={active || busy}>重新检查全部</Button></Popconfirm>
      {run?.resumable ? <Button disabled={busy} onClick={() => void onResume()}>继续上次任务</Button> : null}
    </Space>
  </Card>;
}

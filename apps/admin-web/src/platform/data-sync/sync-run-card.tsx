import { Button, Card, Popconfirm, Select, Space, Tag } from 'antd';
import type { PlatformSyncRunSummary } from '@efm/contracts';

const statusCopy: Record<PlatformSyncRunSummary['status'], { label: string; color: string }> = {
  PENDING: { label: '排队中', color: 'processing' },
  RUNNING: { label: '同步中', color: 'processing' },
  READY: { label: '同步完成', color: 'success' },
  PAUSED: { label: '已暂停', color: 'warning' },
  FAILED: { label: '同步失败', color: 'error' },
  CANCELLED: { label: '已取消', color: 'default' }
};

const phaseCopy: Record<string, { players: string; teams: string }> = {
  QUEUED: { players: '正在等待开始', teams: '正在等待开始' },
  FETCHING: { players: '正在获取球员卡', teams: '正在获取球队和队徽' },
  IMPORTING: { players: '正在整理待确认数据', teams: '正在整理待确认数据' },
  READY: { players: '数据已准备好，请确认后发布', teams: '数据已准备好，请确认后发布' },
  INTERRUPTED: { players: '任务中断，可以继续执行', teams: '任务中断，可以继续执行' },
  FAILED: { players: '同步失败，请查看原因', teams: '同步失败，请查看原因' },
  PAUSED: { players: '任务已暂停，可继续执行或取消', teams: '任务已暂停，可继续执行或取消' },
  PAUSING: { players: '正在暂停，当前分片完成后停止', teams: '正在暂停，当前分片完成后停止' },
  CANCELLED: { players: '任务已取消', teams: '任务已取消' },
  SCAN_PASS_1: { players: '正在第一次完整扫描', teams: '正在扫描' },
  SCAN_PASS_2: { players: '正在第二次完整扫描', teams: '正在扫描' },
  DIFF_SOURCE: { players: '正在核对新增和更新', teams: '正在核对' },
  DIFF_MISSING: { players: '正在复核来源缺失的卡', teams: '正在核对' },
  PUBLISHING: { players: '正在发布有效变更', teams: '正在发布' },
  PUBLISHED: { players: '有效变更已发布', teams: '已发布' },
  PARTIALLY_PUBLISHED: { players: '部分变更已发布，请查看待确认项', teams: '部分已发布' }
};

export function SyncRunCard({ kind, run, pendingReview, failedReview, published, busy = false, sampleLimit = 100, onSampleLimitChange = () => undefined, onStart, onPause, onResume, onCancel }: {
  kind: 'PLAYER_CARDS' | 'TEAM_SHELLS';
  run: PlatformSyncRunSummary | null;
  pendingReview: number;
  failedReview: number;
  published: number;
  busy?: boolean;
  sampleLimit?: 10 | 100 | 500;
  onSampleLimitChange?: (limit: 10 | 100 | 500) => void;
  onStart: (mode: 'sample' | 'incremental' | 'full') => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const active = run?.status === 'PENDING' || run?.status === 'RUNNING';
  const paused = run?.status === 'PAUSED';
  const blocked = active || paused;
  const isPlayers = kind === 'PLAYER_CARDS';
  const dataName = isPlayers ? '球员卡' : '球队队壳';
  const metricLabels = isPlayers
    ? { pending: '待确认批次', failed: '失败批次', published: '已发布批次' }
    : { pending: '待确认队壳', failed: '失败队壳', published: '正式队壳' };
  const phase = run?.currentPhase
    ? phaseCopy[run.currentPhase]?.[isPlayers ? 'players' : 'teams'] ?? statusCopy[run.status].label
    : run ? statusCopy[run.status].label : null;
  const partial = Boolean(run?.status === 'READY' && run.completionReason === 'SOURCE_EXHAUSTED'
    && run.targetCount !== null && run.matchedCount < run.targetCount);
  const progressCopy = run?.mode === 'SAMPLE' && run.targetCount !== null
    ? `新增 ${run.matchedCount}/${run.targetCount} · 已检查 ${run.counters.scanned.toLocaleString('en-US')}`
    : run ? `已处理 ${run.counters.scanned} 条 · 失败 ${run.counters.failed} 条` : null;
  return <Card className={`data-card sync-run-card${active ? ' sync-run-card--active' : ''}`}>
    <div className="sync-run-card__head">
      <div><span className="section-kicker">PESDATA · {dataName}</span><h2>当前同步任务</h2><p>检查 PESDATA 的{dataName}变化，确认后再进入正式目录。</p></div>
      {run ? <Tag color={partial ? 'warning' : statusCopy[run.status].color}>{partial ? '部分完成' : statusCopy[run.status].label}</Tag> : <Tag>当前无任务</Tag>}
    </div>
    <div
      className="sync-run-card__pulse"
      role={active ? 'progressbar' : undefined}
      aria-label={active ? `${dataName}同步进度` : undefined}
      aria-valuetext={active && run ? `已处理 ${run.counters.scanned} 条，失败 ${run.counters.failed} 条` : undefined}
      aria-hidden={active ? undefined : true}
    ><span /><span /><span /><span /></div>
    <dl className="sync-run-card__metrics">
      <div><dt>{metricLabels.pending}</dt><dd>{pendingReview}</dd></div>
      <div><dt>{metricLabels.failed}</dt><dd>{failedReview}</dd></div>
      <div><dt>{metricLabels.published}</dt><dd>{published}</dd></div>
      <div><dt>{run ? '本次已检查' : '最近一次检查'}</dt><dd>{run?.counters.scanned ?? '—'}</dd></div>
    </dl>
    {run ? <div className="sync-run-card__status">
      <span>当前进度</span><strong>{phase}</strong>
      {progressCopy ? <small className="sync-run-card__live-count">{progressCopy}</small> : null}
      {run.errorMessage ? <small className="sync-run-card__error">{run.errorMessage}</small> : null}
    </div> : <p className="sync-run-card__empty"><strong>当前没有同步任务</strong><span>日常更新请选择“增量同步”；首次验证数据可使用“抽样同步”。</span></p>}
    <Space wrap className="sync-run-card__actions">
      <Select
        aria-label="抽样数量"
        value={sampleLimit}
        disabled={blocked || busy}
        onChange={(value) => onSampleLimitChange(value)}
        options={[10, 100, 500].map((value) => ({ value, label: `${value} 条` }))}
      />
      <Button disabled={blocked || busy} onClick={() => void onStart('sample')}>抽样同步</Button>
      <Button type="primary" disabled={blocked || busy} loading={busy} onClick={() => void onStart('incremental')}>增量同步</Button>
      <Popconfirm
        title="确认进行全量同步？"
        description="该操作耗时较长，并会产生更多等待确认的数据。"
        okText="开始全部检查"
        cancelText="取消"
        onConfirm={() => onStart('full')}
      ><Button danger disabled={blocked || busy}>全量同步</Button></Popconfirm>
      {active ? <Popconfirm
        title="确认暂停当前同步？"
        description="任务进度会保留，之后可以继续同步。"
        okText="暂停同步"
        cancelText="返回"
        onConfirm={onPause}
      ><Button disabled={busy}>暂停同步</Button></Popconfirm> : null}
      {paused ? <Button type="primary" disabled={busy} loading={busy} onClick={() => void onResume()}>继续同步</Button> : null}
      {paused ? <Popconfirm
        title="确认取消当前任务？"
        description="取消后任务不能继续，但已经生成的待确认数据仍可查看、发布或驳回。"
        okText="取消任务"
        cancelText="返回"
        okButtonProps={{ danger: true }}
        onConfirm={onCancel}
      ><Button danger disabled={busy}>取消任务</Button></Popconfirm> : null}
      {run?.resumable && !paused ? <Button disabled={busy} onClick={() => void onResume()}>继续上次任务</Button> : null}
    </Space>
  </Card>;
}

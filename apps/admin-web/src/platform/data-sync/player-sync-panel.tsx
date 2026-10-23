import { Alert, Button, Card, Descriptions, Drawer, Empty, Image, Input, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ImportBatchSchema,
  PlayerImportRecordPageSchema,
  PlayerSyncBatchPageSchema,
  PlatformSyncRunPageSchema,
  type ImportBatchResponse,
  type ImportRecordResponse,
  type PlayerSyncBatchPage,
  type PlatformSyncRunSummary
} from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../../lib/api';
import { formatDateTime } from '../../lib/date-time';
import { syncErrorText } from './sync-error-text';
import { DailyReconciliationCard } from './daily-reconciliation-card';

const DEFAULT_BATCH_STATUSES = ['READY'];
const pageSizeOptions = [20, 50];
const batchStatusCopy: Record<ImportBatchResponse['status'], string> = {
  UPLOADED: '等待校验', VALIDATED: '存在异常', READY: '等待确认', PUBLISHED: '已发布', FAILED: '同步失败', CANCELLED: '已驳回'
};
const diffCopy: Record<ImportRecordResponse['diffType'], string> = {
  CREATE: '新增', UPDATE: '更新', UNCHANGED: '无变化', INVALID: '无效'
};
const runModeCopy = { SAMPLE: '抽样同步', INCREMENTAL: '增量同步', FULL: '全量同步', RECONCILE: '每日对账', RESUME: '继续执行' } as const;
const runStatusCopy = { PENDING: '排队中', RUNNING: '同步中', READY: '同步完成', PAUSED: '已暂停', FAILED: '同步失败', CANCELLED: '已取消' } as const;

export function PlayerSyncPanel({ api = adminApi, onChanged, onResumeRun, onCancelRun, refreshKey = '' }: {
  api?: AdminApi;
  onChanged: () => Promise<unknown> | unknown;
  onResumeRun: (runId: string) => Promise<unknown>;
  onCancelRun?: (runId: string) => Promise<unknown>;
  refreshKey?: string;
}) {
  const [runs, setRuns] = useState<PlatformSyncRunSummary[]>([]);
  const [runPage, setRunPage] = useState(1);
  const [runTotal, setRunTotal] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatchResponse[]>([]);
  const [batchPage, setBatchPage] = useState(1);
  const [batchPageSize, setBatchPageSize] = useState<20 | 50>(20);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchSummary, setBatchSummary] = useState<PlayerSyncBatchPage['summary'] | null>(null);
  const [batchStatuses, setBatchStatuses] = useState(DEFAULT_BATCH_STATUSES);
  const [query, setQuery] = useState('');
  const [selectedBatch, setSelectedBatch] = useState<ImportBatchResponse | null>(null);
  const [records, setRecords] = useState<ImportRecordResponse[]>([]);
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState<20 | 50>(20);
  const [recordTotal, setRecordTotal] = useState(0);
  const [recordDiffType, setRecordDiffType] = useState('');
  const [recordQuery, setRecordQuery] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<ImportRecordResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [fullPublishProgress, setFullPublishProgress] = useState<string | null>(null);
  const [fullPublishResult, setFullPublishResult] = useState<{ succeeded: number; skipped: number; failed: Array<{ name: string; reason: string }> } | null>(null);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRefreshKey = useRef<string | null>(null);
  const runRequestSequence = useRef(0);
  const selectNewestOnNextRunLoad = useRef(false);

  const loadRuns = useCallback(async () => {
    try {
      const refreshChanged = loadedRefreshKey.current !== refreshKey;
      loadedRefreshKey.current = refreshKey;
      if (refreshChanged) selectNewestOnNextRunLoad.current = true;
      const requestedPage = refreshChanged ? 1 : runPage;
      if (refreshChanged && runPage !== 1) setRunPage(1);
      const requestSequence = ++runRequestSequence.current;
      const result = await api.request(`/v1/admin/data-sync/players/runs?page=${requestedPage}&pageSize=20`, { schema: PlatformSyncRunPageSchema });
      if (requestSequence !== runRequestSequence.current) return;
      const selectNewest = selectNewestOnNextRunLoad.current && requestedPage === 1;
      if (selectNewest) selectNewestOnNextRunLoad.current = false;
      setRuns(result.items); setRunTotal(result.total);
      setSelectedRunId((current) => selectNewest
        ? result.items[0]?.id ?? null
        : current && result.items.some(({ id }) => id === current) ? current : result.items[0]?.id ?? null);
    } catch (caught) { setError(errorCopy(caught, '球员卡同步历史加载失败')); }
  }, [api, refreshKey, runPage]);

  const loadBatches = useCallback(async () => {
    if (!selectedRunId) { setBatches([]); setBatchTotal(0); setBatchSummary(null); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(batchPage), pageSize: String(batchPageSize), status: batchStatuses.join(',')
      });
      if (query) params.set('query', query);
      const result = await api.request(`/v1/admin/data-sync/players/runs/${selectedRunId}/batches?${params}`, { schema: PlayerSyncBatchPageSchema });
      setBatches(result.items); setBatchTotal(result.total); setBatchSummary(result.summary); setError(null);
    } catch (caught) { setError(errorCopy(caught, '待审核批次加载失败')); }
    finally { setLoading(false); }
  }, [api, batchPage, batchPageSize, batchStatuses, query, refreshKey, selectedRunId]);

  const loadRecords = useCallback(async () => {
    if (!selectedBatch) { setRecords([]); setRecordTotal(0); return; }
    try {
      const params = new URLSearchParams({ page: String(recordPage), pageSize: String(recordPageSize) });
      if (recordDiffType) params.set('diffType', recordDiffType);
      if (recordQuery) params.set('query', recordQuery);
      const result = await api.request(
        `/v1/admin/data-sync/players/batches/${selectedBatch.id}/records?${params}`,
        { schema: PlayerImportRecordPageSchema }
      );
      setRecords(result.items); setRecordTotal(result.total);
    } catch (caught) { setError(errorCopy(caught, '球员卡明细加载失败')); }
  }, [api, recordDiffType, recordPage, recordPageSize, recordQuery, selectedBatch]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => { void loadBatches(); }, [loadBatches]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);
  useEffect(() => { setBatchSummary(null); }, [selectedRunId]);

  const mutateBatch = async (batch: ImportBatchResponse, action: 'publish' | 'reject') => {
    if (mutatingId) return;
    setMutatingId(batch.id); setError(null);
    try {
      await api.request(`/v1/admin/data-sync/players/batches/${batch.id}/${action}`, { method: 'POST', schema: ImportBatchSchema });
      await Promise.all([loadBatches(), selectedBatch?.id === batch.id ? loadRecords() : Promise.resolve(), onChanged()]);
    } catch (caught) { setError(caught instanceof ApiError && action === 'publish' ? `${batch.fileName}：${syncErrorText(caught.code)}` : errorCopy(caught, action === 'publish' ? '批次发布失败' : '批次驳回失败')); }
    finally { setMutatingId(null); }
  };

  const publishAllReady = async () => {
    if (!selectedRunId || !batchSummary?.ready || mutatingId) return;
    const runId = selectedRunId;
    const outcome = { succeeded: 0, skipped: 0, failed: [] as Array<{ name: string; reason: string }> };
    let refreshError: string | null = null;
    setMutatingId('all'); setError(null); setFullPublishResult(null);
    setFullPublishProgress('正在查找当前任务中可发布的球员卡批次…');
    try {
      const readyBatches: ImportBatchResponse[] = [];
      let readyTotal = 0;
      for (let readyPage = 1; ; readyPage += 1) {
        const params = new URLSearchParams({ page: String(readyPage), pageSize: '50', status: 'READY' });
        const response = await api.request(`/v1/admin/data-sync/players/runs/${runId}/batches?${params}`, { schema: PlayerSyncBatchPageSchema });
        readyTotal = response.total;
        readyBatches.push(...response.items.filter((item) => item.status === 'READY'));
        setFullPublishProgress(`正在查找可发布批次：已检查 ${Math.min(readyPage * 50, readyTotal)} / ${readyTotal} 个`);
        if (readyPage * 50 >= readyTotal || response.items.length === 0) break;
      }
      const uniqueBatches = [...new Map(readyBatches.map((item) => [item.id, item])).values()];
      outcome.skipped = uniqueBatches.filter((item) => item.invalidCount > 0).length;
      const publishable = uniqueBatches.filter((item) => item.invalidCount === 0);
      for (const batch of publishable) {
        try {
          await api.request(`/v1/admin/data-sync/players/batches/${batch.id}/publish`, { method: 'POST', schema: ImportBatchSchema });
          outcome.succeeded += 1;
        } catch (caught) {
          outcome.failed.push({ name: batch.fileName, reason: caught instanceof ApiError ? syncErrorText(caught.code) : '发布时连接中断，请检查批次状态后重试' });
        }
        setFullPublishProgress(`正在发布：已处理 ${outcome.succeeded + outcome.failed.length} / ${publishable.length} 个批次`);
      }
      setFullPublishResult({ ...outcome });
    } catch (caught) {
      setFullPublishResult({ ...outcome });
      refreshError = `${errorCopy(caught, '全量发布中断')}；请检查结果后重试。`;
    } finally {
      setFullPublishProgress(null);
      try { await Promise.all([loadBatches(), onChanged()]); }
      catch (caught) { refreshError ??= errorCopy(caught, '发布结果刷新失败'); }
      if (refreshError) setError(refreshError);
      setMutatingId(null);
    }
  };

  const resumeRun = async (runId: string) => {
    if (resumingRunId) return;
    setResumingRunId(runId);
    try { await onResumeRun(runId); await loadRuns(); }
    finally { setResumingRunId(null); }
  };

  const cancelRun = async (runId: string) => {
    if (!onCancelRun || cancellingRunId) return;
    setCancellingRunId(runId);
    try { await onCancelRun(runId); await loadRuns(); }
    finally { setCancellingRunId(null); }
  };

  const isReconciliation = runs.find((item) => item.id === selectedRunId)?.mode === 'RECONCILE';
  const batchColumns = useMemo(() => [
    { title: '导入批次', dataIndex: 'fileName', key: 'fileName', render: (value: string, item: ImportBatchResponse) => <div className="sync-table-identity"><strong>{value}</strong><small>共 {item.totalCount} 条球员卡记录</small></div> },
    { title: '变化', key: 'changes', render: (_: unknown, item: ImportBatchResponse) => <span>新增 {item.createCount} · 更新 {item.updateCount} · 无效 {item.invalidCount}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (value: ImportBatchResponse['status']) => <Tag color={value === 'READY' ? 'success' : value === 'FAILED' || value === 'VALIDATED' ? 'error' : 'default'}>{batchStatusCopy[value]}</Tag> },
    { title: '操作', key: 'actions', render: (_: unknown, item: ImportBatchResponse) => <Space wrap>
      <Button onClick={() => { setSelectedBatch(item); setRecordPage(1); setRecordDiffType(''); setRecordQuery(''); }}>查看记录</Button>
      {!isReconciliation ? <Popconfirm title="将发布整个导入批次" description={`共 ${item.totalCount} 条记录，不能只发布单条球员卡。`} okText="确认发布" cancelText="取消" onConfirm={() => mutateBatch(item, 'publish')}>
        <Button type="primary" loading={mutatingId === item.id} disabled={Boolean(mutatingId) || item.status !== 'READY' || item.invalidCount > 0}>发布批次</Button>
      </Popconfirm> : null}
      {!isReconciliation ? <Popconfirm title="确认驳回整个批次？" okText="确认驳回" cancelText="取消" onConfirm={() => mutateBatch(item, 'reject')}>
        <Button danger disabled={Boolean(mutatingId) || !['READY', 'VALIDATED', 'UPLOADED'].includes(item.status)}>驳回</Button>
      </Popconfirm> : null}
    </Space> }
  ], [isReconciliation, mutatingId]);

  const recordColumns = useMemo(() => [
    { title: '球员', key: 'player', render: (_: unknown, item: ImportRecordResponse) => <div className="sync-player-cell">
      {item.normalized?.imageUrl ? <Image preview={false} src={item.normalized.imageUrl} alt="" /> : <span>{item.normalized?.playerShortName?.slice(0, 2) ?? '球'}</span>}
      <div><strong>{item.normalized?.playerNameZh ?? item.normalized?.playerNameEn ?? '无法识别'}</strong><small>第 {item.rowNumber} 条球员卡记录</small></div>
    </div> },
    { title: '卡片 / 卡包', key: 'card', render: (_: unknown, item: ImportRecordResponse) => <div className="sync-table-identity"><strong>{item.normalized?.cardName ?? '—'}</strong><small>{item.normalized ? `${item.normalized.cardType} · ${item.normalized.packName ?? '未标记卡包'}` : '—'}</small></div> },
    { title: '位置', key: 'position', render: (_: unknown, item: ImportRecordResponse) => item.normalized?.position ?? '—' },
    { title: '总评', key: 'overall', render: (_: unknown, item: ImportRecordResponse) => item.normalized?.overallRating ?? '—' },
    { title: '差异', dataIndex: 'diffType', key: 'diffType', render: (value: ImportRecordResponse['diffType']) => <Tag color={value === 'INVALID' ? 'error' : value === 'CREATE' ? 'success' : 'default'}>{diffCopy[value]}</Tag> },
    { title: '状态 / 错误', key: 'status', render: (_: unknown, item: ImportRecordResponse) => <div className="sync-table-identity"><strong>{item.normalized?.status === 'ACTIVE' ? '启用' : item.normalized?.status ?? '无效记录'}</strong><small>{item.validationErrors[0]?.code ?? '无错误'}</small></div> },
    { title: '操作', key: 'action', render: (_: unknown, item: ImportRecordResponse) => <Button onClick={() => setSelectedRecord(item)}>查看详情</Button> }
  ], []);

  const selectedRun = runs.find((item) => item.id === selectedRunId) ?? null;

  return <div className="player-sync-panel">
    <DailyReconciliationCard api={api} selectedRunId={selectedRunId} selectedRunMode={selectedRun?.mode}
      onChanged={async () => { selectNewestOnNextRunLoad.current = true; await onChanged(); await loadRuns(); }} />
    {error ? <Alert role="alert" type="error" showIcon closable onClose={() => setError(null)} title={error} /> : null}
    {fullPublishResult ? <Alert
      role="status" type={fullPublishResult.failed.length ? 'warning' : 'success'} showIcon closable onClose={() => setFullPublishResult(null)}
      title={`成功发布 ${fullPublishResult.succeeded} 个批次，跳过 ${fullPublishResult.skipped} 个含无效记录的批次，失败 ${fullPublishResult.failed.length} 个`}
      description={fullPublishResult.failed.length ? `${fullPublishResult.failed.slice(0, 10).map((failure) => `${failure.name}：${failure.reason}`).join('；')}${fullPublishResult.failed.length > 10 ? `；另有 ${fullPublishResult.failed.length - 10} 个失败` : ''}` : '同步失败和存在异常的批次已自动跳过。'}
    /> : null}
    <Card title={<div className="sync-section-title"><strong>需要确认的球员卡</strong><small>{selectedRun ? selectedRunDescription(selectedRun) : '同步完成后，需要确认的数据会显示在这里。'}</small></div>} className="data-card">
      <div className="sync-filter-bar">
        <Select mode="multiple" aria-label="批次状态" value={batchStatuses} onChange={(values) => { setBatchStatuses(values.length ? values : DEFAULT_BATCH_STATUSES); setBatchPage(1); }} options={[
          { value: 'READY', label: '等待确认' }, { value: 'VALIDATED', label: '存在异常' }, { value: 'FAILED', label: '同步失败' },
          { value: 'PUBLISHED', label: '已发布' }, { value: 'CANCELLED', label: '已驳回' }
        ]} />
        <Input.Search aria-label="搜索批次" allowClear placeholder="批次名称" onSearch={(value) => { setQuery(value.trim()); setBatchPage(1); }} />
      </div>
      <div className="sync-batch-bar">
        <span>{batchSummary ? `当前任务有 ${batchSummary.ready} 个待确认批次` : '正在加载批次概况'}</span>
        {selectedRun?.mode !== 'RECONCILE' ? <Popconfirm
          title={`将处理当前任务的 ${batchSummary?.ready ?? 0} 个等待确认的批次`}
          description="只发布状态正常且没有无效记录的批次；跳过同步失败和存在异常的批次。将处理当前任务的所有页面，不受上方筛选条件影响。"
          okText="确认全量发布" cancelText="取消" onConfirm={publishAllReady}
        ><Button type="primary" loading={Boolean(fullPublishProgress)} disabled={!selectedRunId || !batchSummary?.ready || Boolean(mutatingId)}>全量发布</Button></Popconfirm> : null}
      </div>
      {fullPublishProgress ? <Alert role="status" type="info" showIcon title={fullPublishProgress} /> : null}
      <Table<ImportBatchResponse>
        rowKey="id" loading={loading} dataSource={batches} columns={batchColumns} scroll={{ x: 920 }}
        locale={{ emptyText: <Empty description={selectedRunId ? '当前筛选下没有批次' : '暂无同步任务'} /> }}
        pagination={{
          current: batchPage, pageSize: batchPageSize, total: batchTotal,
          showSizeChanger: { 'aria-label': '每页条数' }, pageSizeOptions,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, size) => { setBatchPage(page); setBatchPageSize(size as 20 | 50); }
        }}
      />
    </Card>
    {selectedBatch ? <Card title={`批次记录 · ${selectedBatch.fileName}`} className="data-card">
      <div className="sync-filter-bar">
        <Select
          aria-label="记录差异类型"
          value={recordDiffType || undefined}
          placeholder="全部差异类型"
          allowClear
          onChange={(value) => { setRecordDiffType(value ?? ''); setRecordPage(1); }}
          options={Object.entries(diffCopy).map(([value, label]) => ({ value, label }))}
        />
        <Input.Search
          aria-label="搜索球员卡记录"
          allowClear
          placeholder="球员名或卡片名"
          onSearch={(value) => { setRecordQuery(value.trim()); setRecordPage(1); }}
        />
      </div>
      <Table<ImportRecordResponse>
        rowKey="id" dataSource={records} columns={recordColumns} scroll={{ x: 980 }}
        pagination={{
          current: recordPage, pageSize: recordPageSize, total: recordTotal,
          showSizeChanger: { 'aria-label': '记录每页条数' }, pageSizeOptions,
          showTotal: (total) => `共 ${total} 条记录`,
          onChange: (page, size) => { setRecordPage(page); setRecordPageSize(size as 20 | 50); }
        }}
      />
    </Card> : null}
    <details className="sync-history-disclosure">
      <summary><span>历史同步记录</span><small>查看以前执行过的任务，共 {runTotal} 次</small></summary>
      <Card className="data-card sync-history-card">
        <Table<PlatformSyncRunSummary>
          rowKey="id" size="small" dataSource={runs}
          rowClassName={(item) => item.id === selectedRunId ? 'is-selected' : ''}
          onRow={(item) => ({ onClick: () => { if (mutatingId) return; setSelectedRunId(item.id); setBatchPage(1); } })}
          columns={[
            { title: '创建时间', dataIndex: 'createdAt', render: (value: string) => formatDateTime(value) },
            { title: '同步方式', dataIndex: 'mode', render: (value: PlatformSyncRunSummary['mode']) => runModeCopy[value] },
            { title: '任务状态', dataIndex: 'status', render: (value: PlatformSyncRunSummary['status']) => runStatusCopy[value] },
            { title: '已检查', render: (_, item) => item.counters.scanned }, { title: '失败', render: (_, item) => item.counters.failed },
            { title: '操作', render: (_, item) => item.resumable ? <Space wrap onClick={(event) => event.stopPropagation()}>
              <Button
                loading={resumingRunId === item.id}
                disabled={Boolean(resumingRunId) || Boolean(cancellingRunId)}
                onClick={() => void resumeRun(item.id)}
              >继续任务</Button>
              {onCancelRun ? <Popconfirm
                title="确认取消这个同步任务？"
                description="取消后任务不能继续，但已生成的待确认批次仍可查看、发布或驳回。"
                okText="确认取消"
                cancelText="返回"
                okButtonProps={{ danger: true }}
                onConfirm={() => cancelRun(item.id)}
              ><Button danger loading={cancellingRunId === item.id} disabled={Boolean(resumingRunId) || Boolean(cancellingRunId)}>取消任务</Button></Popconfirm> : null}
            </Space> : '—' }
          ]}
          pagination={{ current: runPage, pageSize: 20, total: runTotal, showSizeChanger: false, onChange: setRunPage }}
        />
      </Card>
    </details>
    <Drawer size="large" open={Boolean(selectedRecord)} title="球员卡差异详情" onClose={() => setSelectedRecord(null)}>
      {selectedRecord ? <div className="sync-record-detail">
        <Descriptions column={1} size="small" bordered items={[
          { key: 'name', label: '球员', children: selectedRecord.normalized?.playerNameZh ?? selectedRecord.normalized?.playerNameEn ?? '无法识别' },
          { key: 'source', label: '来源编号（排查用）', children: selectedRecord.externalId ?? '—' },
          { key: 'card', label: '卡片', children: selectedRecord.normalized?.cardName ?? '—' }
        ]} />
        <section><h3>字段变化</h3>{Object.entries(selectedRecord.fieldDiff).length ? Object.entries(selectedRecord.fieldDiff).map(([field, change]) => <article key={field}><strong>{field}</strong><span>{displayValue(change.before)} → {displayValue(change.after)}</span></article>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有字段变化" />}</section>
        <section><h3>校验错误</h3>{selectedRecord.validationErrors.length ? selectedRecord.validationErrors.map((validation) => <Alert key={`${validation.code}-${validation.path}`} type="error" showIcon title={validation.code} description={`${validation.path} · ${validation.message}`} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有校验错误" />}</section>
      </div> : null}
    </Drawer>
  </div>;
}

function selectedRunDescription(run: PlatformSyncRunSummary) {
  return `当前显示 ${formatDateTime(run.createdAt)} 的${runModeCopy[run.mode]}任务；可在历史记录中切换。`;
}

function displayValue(value: unknown) {
  if (value === null) return '空';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function errorCopy(caught: unknown, fallback: string) {
  return caught instanceof ApiError ? `${fallback}（${caught.code}）` : fallback;
}

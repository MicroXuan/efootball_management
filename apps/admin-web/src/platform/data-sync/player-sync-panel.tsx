import { Alert, Button, Card, Descriptions, Drawer, Empty, Image, Input, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ImportBatchSchema,
  PlayerImportRecordPageSchema,
  PlayerSyncBatchPageSchema,
  PlatformSyncRunPageSchema,
  type ImportBatchResponse,
  type ImportRecordResponse,
  type PlatformSyncRunSummary
} from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../../lib/api';

const DEFAULT_BATCH_STATUSES = ['READY', 'VALIDATED', 'FAILED'];
const pageSizeOptions = [20, 50];
const batchStatusCopy: Record<ImportBatchResponse['status'], string> = {
  UPLOADED: '已上传', VALIDATED: '有无效记录', READY: '待发布', PUBLISHED: '已发布', FAILED: '同步失败', CANCELLED: '已驳回'
};
const diffCopy: Record<ImportRecordResponse['diffType'], string> = {
  CREATE: '新增', UPDATE: '更新', UNCHANGED: '无变化', INVALID: '无效'
};
const runModeCopy = { SAMPLE: '抽样', INCREMENTAL: '增量', FULL: '全量', RESUME: '继续' } as const;
const runStatusCopy = { PENDING: '排队中', RUNNING: '同步中', READY: '待审核', PAUSED: '已暂停', FAILED: '失败' } as const;

export function PlayerSyncPanel({ api = adminApi, onChanged, onResumeRun }: {
  api?: AdminApi;
  onChanged: () => Promise<unknown> | unknown;
  onResumeRun: (runId: string) => Promise<unknown>;
}) {
  const [runs, setRuns] = useState<PlatformSyncRunSummary[]>([]);
  const [runPage, setRunPage] = useState(1);
  const [runTotal, setRunTotal] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatchResponse[]>([]);
  const [batchPage, setBatchPage] = useState(1);
  const [batchPageSize, setBatchPageSize] = useState<20 | 50>(20);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchStatuses, setBatchStatuses] = useState(DEFAULT_BATCH_STATUSES);
  const [query, setQuery] = useState('');
  const [selectedBatch, setSelectedBatch] = useState<ImportBatchResponse | null>(null);
  const [records, setRecords] = useState<ImportRecordResponse[]>([]);
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState<20 | 50>(20);
  const [recordTotal, setRecordTotal] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<ImportRecordResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const result = await api.request(`/v1/admin/data-sync/players/runs?page=${runPage}&pageSize=20`, { schema: PlatformSyncRunPageSchema });
      setRuns(result.items); setRunTotal(result.total);
      setSelectedRunId((current) => current && result.items.some(({ id }) => id === current) ? current : result.items[0]?.id ?? null);
    } catch (caught) { setError(errorCopy(caught, '球员卡同步历史加载失败')); }
  }, [api, runPage]);

  const loadBatches = useCallback(async () => {
    if (!selectedRunId) { setBatches([]); setBatchTotal(0); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(batchPage), pageSize: String(batchPageSize), status: batchStatuses.join(',')
      });
      if (query) params.set('query', query);
      const result = await api.request(`/v1/admin/data-sync/players/runs/${selectedRunId}/batches?${params}`, { schema: PlayerSyncBatchPageSchema });
      setBatches(result.items); setBatchTotal(result.total); setError(null);
    } catch (caught) { setError(errorCopy(caught, '待审核批次加载失败')); }
    finally { setLoading(false); }
  }, [api, batchPage, batchPageSize, batchStatuses, query, selectedRunId]);

  const loadRecords = useCallback(async () => {
    if (!selectedBatch) { setRecords([]); setRecordTotal(0); return; }
    try {
      const result = await api.request(
        `/v1/admin/data-sync/players/batches/${selectedBatch.id}/records?page=${recordPage}&pageSize=${recordPageSize}`,
        { schema: PlayerImportRecordPageSchema }
      );
      setRecords(result.items); setRecordTotal(result.total);
    } catch (caught) { setError(errorCopy(caught, '球员卡明细加载失败')); }
  }, [api, recordPage, recordPageSize, selectedBatch]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => { void loadBatches(); }, [loadBatches]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);

  const mutateBatch = async (batch: ImportBatchResponse, action: 'publish' | 'reject') => {
    if (mutatingId) return;
    setMutatingId(batch.id); setError(null);
    try {
      await api.request(`/v1/admin/data-sync/players/batches/${batch.id}/${action}`, { method: 'POST', schema: ImportBatchSchema });
      await Promise.all([loadBatches(), selectedBatch?.id === batch.id ? loadRecords() : Promise.resolve(), onChanged()]);
    } catch (caught) { setError(errorCopy(caught, action === 'publish' ? '批次发布失败' : '批次驳回失败')); }
    finally { setMutatingId(null); }
  };

  const resumeRun = async (runId: string) => {
    if (resumingRunId) return;
    setResumingRunId(runId);
    try { await onResumeRun(runId); await loadRuns(); }
    finally { setResumingRunId(null); }
  };

  const batchColumns = useMemo(() => [
    { title: '导入批次', dataIndex: 'fileName', key: 'fileName', render: (value: string, item: ImportBatchResponse) => <div className="sync-table-identity"><strong>{value}</strong><small>{item.id}</small></div> },
    { title: '变化', key: 'changes', render: (_: unknown, item: ImportBatchResponse) => <span>新增 {item.createCount} · 更新 {item.updateCount} · 无效 {item.invalidCount}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (value: ImportBatchResponse['status']) => <Tag color={value === 'READY' ? 'success' : value === 'FAILED' || value === 'VALIDATED' ? 'error' : 'default'}>{batchStatusCopy[value]}</Tag> },
    { title: '操作', key: 'actions', render: (_: unknown, item: ImportBatchResponse) => <Space wrap>
      <Button onClick={() => { setSelectedBatch(item); setRecordPage(1); }}>查看记录</Button>
      <Popconfirm title="将发布整个导入批次" description={`共 ${item.totalCount} 条记录，不能只发布单条球员卡。`} okText="确认发布" cancelText="取消" onConfirm={() => mutateBatch(item, 'publish')}>
        <Button type="primary" loading={mutatingId === item.id} disabled={item.status !== 'READY' || item.invalidCount > 0}>发布批次</Button>
      </Popconfirm>
      <Popconfirm title="确认驳回整个批次？" okText="确认驳回" cancelText="取消" onConfirm={() => mutateBatch(item, 'reject')}>
        <Button danger disabled={!['READY', 'VALIDATED', 'UPLOADED'].includes(item.status)}>驳回</Button>
      </Popconfirm>
    </Space> }
  ], [mutatingId]);

  const recordColumns = useMemo(() => [
    { title: '球员', key: 'player', render: (_: unknown, item: ImportRecordResponse) => <div className="sync-player-cell">
      {item.normalized?.imageUrl ? <Image preview={false} src={item.normalized.imageUrl} alt="" /> : <span>{item.normalized?.playerShortName?.slice(0, 2) ?? '球'}</span>}
      <div><strong>{item.normalized?.playerNameZh ?? item.normalized?.playerNameEn ?? '无法识别'}</strong><small>{item.externalId ?? '无来源 ID'}</small></div>
    </div> },
    { title: '卡片 / 卡包', key: 'card', render: (_: unknown, item: ImportRecordResponse) => <div className="sync-table-identity"><strong>{item.normalized?.cardName ?? '—'}</strong><small>{item.normalized ? `${item.normalized.cardType} · ${item.normalized.packName ?? '未标记卡包'}` : '—'}</small></div> },
    { title: '位置', key: 'position', render: (_: unknown, item: ImportRecordResponse) => item.normalized?.position ?? '—' },
    { title: '总评', key: 'overall', render: (_: unknown, item: ImportRecordResponse) => item.normalized?.overallRating ?? '—' },
    { title: '差异', dataIndex: 'diffType', key: 'diffType', render: (value: ImportRecordResponse['diffType']) => <Tag color={value === 'INVALID' ? 'error' : value === 'CREATE' ? 'success' : 'default'}>{diffCopy[value]}</Tag> },
    { title: '状态 / 错误', key: 'status', render: (_: unknown, item: ImportRecordResponse) => <div className="sync-table-identity"><strong>{item.normalized?.status === 'ACTIVE' ? '启用' : item.normalized?.status ?? '无效记录'}</strong><small>{item.validationErrors[0]?.code ?? '无错误'}</small></div> },
    { title: '操作', key: 'action', render: (_: unknown, item: ImportRecordResponse) => <Button onClick={() => setSelectedRecord(item)}>查看详情</Button> }
  ], []);

  return <div className="player-sync-panel">
    {error ? <Alert role="alert" type="error" showIcon closable onClose={() => setError(null)} title={error} /> : null}
    <Card title="同步任务历史" className="data-card sync-history-card">
      <Table<PlatformSyncRunSummary>
        rowKey="id" size="small" dataSource={runs}
        rowClassName={(item) => item.id === selectedRunId ? 'is-selected' : ''}
        onRow={(item) => ({ onClick: () => { setSelectedRunId(item.id); setBatchPage(1); } })}
        columns={[
          { title: '创建时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
          { title: '模式', dataIndex: 'mode', render: (value: PlatformSyncRunSummary['mode']) => runModeCopy[value] },
          { title: '状态', dataIndex: 'status', render: (value: PlatformSyncRunSummary['status']) => runStatusCopy[value] },
          { title: '扫描', render: (_, item) => item.counters.scanned }, { title: '失败', render: (_, item) => item.counters.failed },
          { title: '操作', render: (_, item) => item.resumable ? <Button
            loading={resumingRunId === item.id}
            disabled={Boolean(resumingRunId)}
            onClick={(event) => { event.stopPropagation(); void resumeRun(item.id); }}
          >继续任务</Button> : '—' }
        ]}
        pagination={{ current: runPage, pageSize: 20, total: runTotal, showSizeChanger: false, onChange: setRunPage }}
      />
    </Card>
    <Card title="待审核批次" className="data-card">
      <div className="sync-filter-bar">
        <Select mode="multiple" aria-label="批次状态" value={batchStatuses} onChange={(values) => { setBatchStatuses(values.length ? values : DEFAULT_BATCH_STATUSES); setBatchPage(1); }} options={[
          { value: 'READY', label: '待发布' }, { value: 'VALIDATED', label: '有无效记录' }, { value: 'FAILED', label: '同步失败' },
          { value: 'PUBLISHED', label: '已发布' }, { value: 'CANCELLED', label: '已驳回' }
        ]} />
        <Input.Search aria-label="搜索批次" allowClear placeholder="批次文件名或 ID" onSearch={(value) => { setQuery(value.trim()); setBatchPage(1); }} />
      </div>
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
    <Drawer size="large" open={Boolean(selectedRecord)} title="球员卡差异详情" onClose={() => setSelectedRecord(null)}>
      {selectedRecord ? <div className="sync-record-detail">
        <Descriptions column={1} size="small" bordered items={[
          { key: 'name', label: '球员', children: selectedRecord.normalized?.playerNameZh ?? selectedRecord.normalized?.playerNameEn ?? '无法识别' },
          { key: 'source', label: '来源 ID', children: selectedRecord.externalId ?? '—' },
          { key: 'card', label: '卡片', children: selectedRecord.normalized?.cardName ?? '—' }
        ]} />
        <section><h3>字段变化</h3>{Object.entries(selectedRecord.fieldDiff).length ? Object.entries(selectedRecord.fieldDiff).map(([field, change]) => <article key={field}><strong>{field}</strong><span>{displayValue(change.before)} → {displayValue(change.after)}</span></article>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有字段变化" />}</section>
        <section><h3>校验错误</h3>{selectedRecord.validationErrors.length ? selectedRecord.validationErrors.map((validation) => <Alert key={`${validation.code}-${validation.path}`} type="error" showIcon title={validation.code} description={`${validation.path} · ${validation.message}`} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有校验错误" />}</section>
      </div> : null}
    </Drawer>
  </div>;
}

function displayValue(value: unknown) {
  if (value === null) return '空';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function errorCopy(caught: unknown, fallback: string) {
  return caught instanceof ApiError ? `${fallback}（${caught.code}）` : fallback;
}

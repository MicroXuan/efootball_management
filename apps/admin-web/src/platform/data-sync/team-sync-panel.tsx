import { Alert, Button, Card, Descriptions, Drawer, Empty, Image, Input, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BatchMutationResultSchema,
  PlatformSyncRunPageSchema,
  TeamSyncItemPageSchema,
  type BatchMutationResult,
  type PlatformSyncRunSummary,
  type TeamSyncItemPage
} from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../../lib/api';

type TeamSyncItem = TeamSyncItemPage['items'][number];
const DEFAULT_STATUSES = ['PENDING', 'FAILED'];
const pageSizeOptions = [20, 50];
const statusCopy = { PENDING: '待审核', FAILED: '失败', PUBLISHED: '已发布', REJECTED: '已驳回' } as const;
const changeCopy = { ADDED: '新增', UPDATED: '更新', SOURCE_MISSING: '来源缺失' } as const;
const runModeCopy = { SAMPLE: '抽样', INCREMENTAL: '增量', FULL: '全量', RESUME: '继续' } as const;
const runStatusCopy = { PENDING: '排队中', RUNNING: '同步中', READY: '待审核', PAUSED: '已暂停', FAILED: '失败' } as const;

export function TeamSyncPanel({ api = adminApi, onChanged, onResumeRun }: {
  api?: AdminApi;
  onChanged: () => Promise<unknown> | unknown;
  onResumeRun: (runId: string) => Promise<unknown>;
}) {
  const [runs, setRuns] = useState<PlatformSyncRunSummary[]>([]);
  const [runPage, setRunPage] = useState(1);
  const [runTotal, setRunTotal] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [items, setItems] = useState<TeamSyncItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 50>(20);
  const [total, setTotal] = useState(0);
  const [statuses, setStatuses] = useState(DEFAULT_STATUSES);
  const [changeTypes, setChangeTypes] = useState<string[]>([]);
  const [sourceLeagueId, setSourceLeagueId] = useState('');
  const [query, setQuery] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [errorReasons, setErrorReasons] = useState<Array<{ code: string; count: number }>>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<TeamSyncItem | null>(null);
  const [result, setResult] = useState<BatchMutationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const response = await api.request(`/v1/admin/data-sync/teams/runs?page=${runPage}&pageSize=20`, { schema: PlatformSyncRunPageSchema });
      setRuns(response.items); setRunTotal(response.total);
      setSelectedRunId((current) => current && response.items.some(({ id }) => id === current) ? current : response.items[0]?.id ?? null);
    } catch (caught) { setError(errorCopy(caught, '队壳同步历史加载失败')); }
  }, [api, runPage]);

  const loadItems = useCallback(async () => {
    if (!selectedRunId) { setItems([]); setTotal(0); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status: statuses.join(',') });
      if (changeTypes.length) params.set('changeType', changeTypes.join(','));
      if (sourceLeagueId) params.set('sourceLeagueId', sourceLeagueId);
      if (query) params.set('query', query);
      if (errorCode) params.set('errorCode', errorCode);
      const response = await api.request(`/v1/admin/data-sync/teams/runs/${selectedRunId}/items?${params}`, { schema: TeamSyncItemPageSchema });
      setItems(response.items); setTotal(response.total); setErrorReasons(response.summary.errors); setError(null);
      const eligible = new Set(response.items.filter(({ reviewStatus }) => reviewStatus === 'PENDING' || reviewStatus === 'FAILED').map(({ id }) => id));
      setSelectedIds((current) => current.filter((id) => eligible.has(id)));
    } catch (caught) { setError(errorCopy(caught, '队壳审核列表加载失败')); }
    finally { setLoading(false); }
  }, [api, changeTypes, errorCode, page, pageSize, query, selectedRunId, sourceLeagueId, statuses]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => { void loadItems(); }, [loadItems]);

  const mutate = async (action: 'publish' | 'reject' | 'retry') => {
    if (!selectedIds.length || mutating) return;
    setMutating(true); setError(null); setResult(null);
    try {
      const response = await api.request(`/v1/admin/data-sync/teams/items/${action}`, {
        method: 'POST', body: { ids: selectedIds }, schema: BatchMutationResultSchema
      });
      setResult(response);
      await Promise.all([loadItems(), onChanged()]);
    } catch (caught) { setError(errorCopy(caught, '批量操作失败')); }
    finally { setMutating(false); }
  };

  const resumeRun = async (runId: string) => {
    if (resumingRunId) return;
    setResumingRunId(runId);
    try { await onResumeRun(runId); await loadRuns(); }
    finally { setResumingRunId(null); }
  };

  const columns = useMemo(() => [
    { title: '球队队壳', key: 'team', render: (_: unknown, item: TeamSyncItem) => <div className="sync-team-cell">
      {item.candidate?.storedLogoUrl ? <Image preview={false} src={item.candidate.storedLogoUrl} alt="" /> : <span>{item.candidate?.shortName.slice(0, 2) ?? '队'}</span>}
      <div><strong>{item.candidate?.nameZh ?? item.candidate?.nameEn ?? item.current?.nameZh ?? item.sourceExternalId}</strong><small>{item.sourceExternalId}</small></div>
    </div> },
    { title: '来源联赛', key: 'league', render: (_: unknown, item: TeamSyncItem) => item.candidate?.sourceLeagueName ?? '未归类' },
    { title: '变化', dataIndex: 'changeType', key: 'changeType', render: (value: TeamSyncItem['changeType']) => <Tag>{changeCopy[value]}</Tag> },
    { title: '状态 / 错误', key: 'status', render: (_: unknown, item: TeamSyncItem) => <div className="sync-table-identity"><strong>{statusCopy[item.reviewStatus]}</strong><small>{item.errorCode ?? '无错误'}</small></div> },
    { title: '操作', key: 'action', render: (_: unknown, item: TeamSyncItem) => <Button onClick={() => setDetail(item)}>查看详情</Button> }
  ], []);

  const selectedSummary = selectedIds.join('、');
  return <div className="team-sync-panel">
    {error ? <Alert role="alert" type="error" showIcon closable onClose={() => setError(null)} title={error} /> : null}
    {result ? <Alert
      role="status" type={result.failed.length ? 'warning' : 'success'} showIcon closable onClose={() => setResult(null)}
      title={`成功 ${result.succeededIds.length} 条，失败 ${result.failed.length} 条`}
      description={result.failed.length ? result.failed.map((failure) => `${failure.id} · ${failure.code}`).join('；') : '所选队壳已处理'}
    /> : null}
    <Card title="同步任务历史" className="data-card sync-history-card">
      <Table<PlatformSyncRunSummary>
        rowKey="id" size="small" dataSource={runs}
        rowClassName={(item) => item.id === selectedRunId ? 'is-selected' : ''}
        onRow={(item) => ({ onClick: () => { setSelectedRunId(item.id); setPage(1); setSelectedIds([]); } })}
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
    <Card title="队壳审核" className="data-card">
      <div className="sync-filter-grid">
        <Select mode="multiple" aria-label="审核状态" value={statuses} onChange={(values) => { setStatuses(values.length ? values : DEFAULT_STATUSES); setPage(1); }} options={[
          { value: 'PENDING', label: '待审核' }, { value: 'FAILED', label: '失败' }, { value: 'PUBLISHED', label: '已发布' }, { value: 'REJECTED', label: '已驳回' }
        ]} />
        <Select mode="multiple" aria-label="变化类型" value={changeTypes} placeholder="全部变化类型" allowClear onChange={(values) => { setChangeTypes(values); setPage(1); }} options={[
          { value: 'ADDED', label: '新增' }, { value: 'UPDATED', label: '更新' }, { value: 'SOURCE_MISSING', label: '来源缺失' }
        ]} />
        <Input.Search aria-label="来源联赛" placeholder="来源联赛 ID" allowClear onSearch={(value) => { setSourceLeagueId(value.trim()); setPage(1); }} />
        <Input.Search aria-label="搜索队壳" placeholder="球队名称或来源 ID" allowClear onSearch={(value) => { setQuery(value.trim()); setPage(1); }} />
      </div>
      {errorReasons.length ? <div className="sync-error-chips"><span>失败原因</span>{errorReasons.map((reason) => <Button key={reason.code} type={errorCode === reason.code ? 'primary' : 'default'} onClick={() => { setErrorCode(errorCode === reason.code ? '' : reason.code); setPage(1); }}>{reason.code} · {reason.count}</Button>)}</div> : null}
      <div className="sync-batch-bar">
        <span>已选 {selectedIds.length} 条（最多 100 条）</span>
        <Space wrap>
          <Popconfirm title={`将发布 ${selectedIds.length} 条队壳`} description={selectedSummary} okText="确认发布" cancelText="取消" onConfirm={() => mutate('publish')}><Button type="primary" disabled={!selectedIds.length || mutating}>批量发布</Button></Popconfirm>
          <Popconfirm title={`将驳回 ${selectedIds.length} 条队壳`} description={selectedSummary} okText="确认驳回" cancelText="取消" onConfirm={() => mutate('reject')}><Button disabled={!selectedIds.length || mutating}>批量驳回</Button></Popconfirm>
          <Popconfirm title={`将重试 ${selectedIds.length} 条失败项`} description={selectedSummary} okText="确认重试" cancelText="取消" onConfirm={() => mutate('retry')}><Button disabled={!selectedIds.length || mutating}>重试失败项</Button></Popconfirm>
        </Space>
      </div>
      <Table<TeamSyncItem>
        rowKey="id" loading={loading} dataSource={items} columns={columns} scroll={{ x: 900 }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys.slice(0, 100).map(String)),
          getCheckboxProps: (item) => ({
            disabled: !['PENDING', 'FAILED'].includes(item.reviewStatus) || (selectedIds.length >= 100 && !selectedIds.includes(item.id)),
            'aria-label': `选择 ${item.id}`
          })
        }}
        locale={{ emptyText: <Empty description={selectedRunId ? '当前筛选下没有队壳差异' : '暂无同步任务'} /> }}
        pagination={{
          current: page, pageSize, total, showSizeChanger: { 'aria-label': '每页条数' }, pageSizeOptions,
          showTotal: (count) => `共 ${count} 条`,
          onChange: (nextPage, size) => { setPage(nextPage); setPageSize(size as 20 | 50); }
        }}
      />
    </Card>
    <Drawer size="large" open={Boolean(detail)} title="队壳差异详情" onClose={() => setDetail(null)}>
      {detail ? <div className="team-sync-detail">
        <Descriptions column={1} bordered size="small" items={[
          { key: 'change', label: '变化类型', children: changeCopy[detail.changeType] },
          { key: 'status', label: '审核状态', children: statusCopy[detail.reviewStatus] },
          { key: 'source', label: '来源 ID', children: detail.sourceExternalId },
          { key: 'error', label: '错误', children: detail.errorCode ? `${detail.errorCode} · ${detail.errorMessage ?? ''}` : '无' }
        ]} />
        <div className="team-sync-comparison">
          <TeamSnapshot title="当前正式数据" value={detail.current} />
          <TeamSnapshot title="本次候选数据" value={detail.candidate ? {
            nameZh: detail.candidate.nameZh, nameEn: detail.candidate.nameEn, shortName: detail.candidate.shortName,
            remoteLogoUrl: detail.candidate.remoteLogoUrl, storedLogoUrl: detail.candidate.storedLogoUrl,
            logoChecksum: detail.candidateLogoChecksum, sourceChecksum: detail.candidateSourceChecksum
          } : null} />
        </div>
      </div> : null}
    </Drawer>
  </div>;
}

function TeamSnapshot({ title, value }: { title: string; value: TeamSyncItem['current'] }) {
  return <section><h3>{title}</h3>{value ? <dl>
    <div><dt>中文名</dt><dd>{value.nameZh ?? '—'}</dd></div>
    <div><dt>英文名</dt><dd>{value.nameEn ?? '—'}</dd></div>
    <div><dt>简称</dt><dd>{value.shortName}</dd></div>
    <div><dt>远程队徽</dt><dd>{value.remoteLogoUrl ?? '—'}</dd></div>
    <div><dt>自有存储队徽</dt><dd>{value.storedLogoUrl ?? '—'}</dd></div>
    <div><dt>队徽校验值</dt><dd>{value.logoChecksum ?? '—'}</dd></div>
    <div><dt>来源校验值</dt><dd>{value.sourceChecksum ?? '—'}</dd></div>
  </dl> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="新增队壳，无旧数据" />}</section>;
}

function errorCopy(caught: unknown, fallback: string) {
  return caught instanceof ApiError ? `${fallback}（${caught.code}）` : fallback;
}

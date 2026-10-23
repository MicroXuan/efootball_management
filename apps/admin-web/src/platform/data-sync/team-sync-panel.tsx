import { Alert, Button, Card, Descriptions, Drawer, Empty, Image, Input, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BatchMutationResultSchema,
  PlatformSyncRunPageSchema,
  TeamSyncItemPageSchema,
  type BatchMutationResult,
  type PlatformSyncRunSummary,
  type TeamSyncItemPage
} from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../../lib/api';
import { formatDateTime } from '../../lib/date-time';
import { syncErrorText } from './sync-error-text';

type TeamSyncItem = TeamSyncItemPage['items'][number];
const DEFAULT_STATUSES = ['PENDING'];
const pageSizeOptions = [20, 50];
const statusCopy = { PENDING: '等待确认', FAILED: '同步失败', PUBLISHED: '已发布', REJECTED: '已驳回' } as const;
const changeCopy = { ADDED: '新增', UPDATED: '更新', SOURCE_MISSING: '来源缺失' } as const;
const runModeCopy = { SAMPLE: '抽样同步', INCREMENTAL: '增量同步', FULL: '全量同步', RECONCILE: '每日对账', RESUME: '继续执行' } as const;
const runStatusCopy = { PENDING: '排队中', RUNNING: '同步中', READY: '同步完成', PAUSED: '已暂停', FAILED: '同步失败', CANCELLED: '已取消' } as const;

export function TeamSyncPanel({ api = adminApi, onChanged, onResumeRun, onCancelRun, refreshKey = '' }: {
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
  const [runItemSummary, setRunItemSummary] = useState<TeamSyncItemPage['summary'] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<TeamSyncItem | null>(null);
  const [result, setResult] = useState<BatchMutationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [fullPublishProgress, setFullPublishProgress] = useState<string | null>(null);
  const [fullPublishResult, setFullPublishResult] = useState(false);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRefreshKey = useRef<string | null>(null);
  const runRequestSequence = useRef(0);
  const selectNewestOnNextRunLoad = useRef(false);
  const itemNames = useRef(new Map<string, string>());

  const loadRuns = useCallback(async () => {
    try {
      const refreshChanged = loadedRefreshKey.current !== refreshKey;
      loadedRefreshKey.current = refreshKey;
      if (refreshChanged) selectNewestOnNextRunLoad.current = true;
      const requestedPage = refreshChanged ? 1 : runPage;
      if (refreshChanged && runPage !== 1) setRunPage(1);
      const requestSequence = ++runRequestSequence.current;
      const response = await api.request(`/v1/admin/data-sync/teams/runs?page=${requestedPage}&pageSize=20`, { schema: PlatformSyncRunPageSchema });
      if (requestSequence !== runRequestSequence.current) return;
      const selectNewest = selectNewestOnNextRunLoad.current && requestedPage === 1;
      if (selectNewest) selectNewestOnNextRunLoad.current = false;
      setRuns(response.items); setRunTotal(response.total);
      setSelectedRunId((current) => selectNewest
        ? response.items[0]?.id ?? null
        : current && response.items.some(({ id }) => id === current) ? current : response.items[0]?.id ?? null);
    } catch (caught) { setError(errorCopy(caught, '队壳同步历史加载失败')); }
  }, [api, refreshKey, runPage]);

  const loadItems = useCallback(async () => {
    if (!selectedRunId) { setItems([]); setTotal(0); setRunItemSummary(null); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status: statuses.join(',') });
      if (changeTypes.length) params.set('changeType', changeTypes.join(','));
      if (sourceLeagueId) params.set('sourceLeagueId', sourceLeagueId);
      if (query) params.set('query', query);
      if (errorCode) params.set('errorCode', errorCode);
      const response = await api.request(`/v1/admin/data-sync/teams/runs/${selectedRunId}/items?${params}`, { schema: TeamSyncItemPageSchema });
      response.items.forEach((item) => itemNames.current.set(item.id, teamName(item)));
      setItems(response.items); setTotal(response.total); setRunItemSummary(response.summary); setErrorReasons(response.summary.errors); setError(null);
      const visible = new Map(response.items.map((item) => [item.id, item.reviewStatus]));
      setSelectedIds((current) => current.filter((id) => {
        const status = visible.get(id);
        return status === undefined || status === 'PENDING' || status === 'FAILED';
      }));
    } catch (caught) { setError(errorCopy(caught, '队壳审核列表加载失败')); }
    finally { setLoading(false); }
  }, [api, changeTypes, errorCode, page, pageSize, query, refreshKey, selectedRunId, sourceLeagueId, statuses]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => { setSelectedIds([]); }, [changeTypes, errorCode, query, selectedRunId, sourceLeagueId, statuses]);
  useEffect(() => { itemNames.current.clear(); setRunItemSummary(null); }, [selectedRunId]);

  const mutate = async (action: 'publish' | 'reject' | 'retry') => {
    if (!selectedIds.length || mutating) return;
    setMutating(true); setError(null); setResult(null); setFullPublishResult(false);
    try {
      const response = await api.request(`/v1/admin/data-sync/teams/items/${action}`, {
        method: 'POST', body: { ids: selectedIds }, schema: BatchMutationResultSchema
      });
      setResult(response);
      setSelectedIds([]);
      await Promise.all([loadItems(), onChanged()]);
    } catch (caught) { setError(errorCopy(caught, '批量操作失败')); }
    finally { setMutating(false); }
  };

  const publishAllPending = async () => {
    if (!selectedRunId || !runItemSummary?.pending || mutating) return;
    const runId = selectedRunId;
    const outcome: BatchMutationResult = { requestedCount: 0, succeededIds: [], failed: [] };
    let publishError: string | null = null;
    setMutating(true); setError(null); setResult(null); setFullPublishResult(true);
    setFullPublishProgress('正在查找当前任务中可发布的队壳…');
    try {
      const pendingIds: string[] = [];
      let pendingTotal = 0;
      for (let pendingPage = 1; ; pendingPage += 1) {
        const params = new URLSearchParams({ page: String(pendingPage), pageSize: '50', status: 'PENDING' });
        const response = await api.request(`/v1/admin/data-sync/teams/runs/${runId}/items?${params}`, { schema: TeamSyncItemPageSchema });
        response.items.forEach((item) => itemNames.current.set(item.id, teamName(item)));
        pendingTotal = response.total;
        pendingIds.push(...response.items.filter((item) => item.reviewStatus === 'PENDING').map((item) => item.id));
        setFullPublishProgress(`正在查找可发布队壳：已检查 ${Math.min(pendingPage * 50, pendingTotal)} / ${pendingTotal} 条`);
        if (pendingPage * 50 >= pendingTotal || response.items.length === 0) break;
      }
      const uniqueIds = [...new Set(pendingIds)];
      for (let offset = 0; offset < uniqueIds.length; offset += 100) {
        const ids = uniqueIds.slice(offset, offset + 100);
        const response = await api.request('/v1/admin/data-sync/teams/items/publish', {
          method: 'POST', body: { ids }, schema: BatchMutationResultSchema
        });
        outcome.requestedCount += response.requestedCount;
        outcome.succeededIds.push(...response.succeededIds);
        outcome.failed.push(...response.failed);
        setFullPublishProgress(`正在发布：已处理 ${outcome.requestedCount} / ${uniqueIds.length} 条`);
      }
      setResult({ ...outcome });
    } catch (caught) {
      if (outcome.requestedCount) setResult({ ...outcome });
      publishError = `${errorCopy(caught, '全量发布中断')}；请检查结果后重试，已成功发布的队壳不会重复处理。`;
    } finally {
      setFullPublishProgress(null);
      setSelectedIds([]);
      try { await Promise.all([loadItems(), onChanged()]); }
      catch (caught) { publishError ??= errorCopy(caught, '发布结果刷新失败'); }
      if (publishError) setError(publishError);
      setMutating(false);
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

  const columns = useMemo(() => [
    { title: '球队队壳', key: 'team', render: (_: unknown, item: TeamSyncItem) => <div className="sync-team-cell">
      {item.candidate?.storedLogoUrl ? <Image preview={false} src={item.candidate.storedLogoUrl} alt="" /> : <span>{item.candidate?.shortName.slice(0, 2) ?? '队'}</span>}
      <div><strong>{teamName(item)}</strong><small>{item.candidate?.nameEn ?? item.current?.nameEn ?? '球队队壳'}</small></div>
    </div> },
    { title: '来源联赛', key: 'league', render: (_: unknown, item: TeamSyncItem) => item.candidate?.sourceLeagueName ?? '未归类' },
    { title: '变化', dataIndex: 'changeType', key: 'changeType', render: (value: TeamSyncItem['changeType']) => <Tag>{changeCopy[value]}</Tag> },
    { title: '状态 / 错误', key: 'status', render: (_: unknown, item: TeamSyncItem) => <div className="sync-table-identity"><strong>{statusCopy[item.reviewStatus]}</strong><small title={item.errorCode ?? undefined}>{item.errorCode ? syncErrorText(item.errorCode) : '无错误'}</small></div> },
    { title: '操作', key: 'action', render: (_: unknown, item: TeamSyncItem) => <Button onClick={() => setDetail(item)}>查看详情</Button> }
  ], []);

  const selectedSummary = selectedIds.map((id) => itemNames.current.get(id) ?? '队壳记录').join('、');
  const selectedRun = runs.find((item) => item.id === selectedRunId) ?? null;
  return <div className="team-sync-panel">
    {error ? <Alert role="alert" type="error" showIcon closable onClose={() => setError(null)} title={error} /> : null}
    {result ? <Alert
      role="status" type={result.failed.length ? 'warning' : 'success'} showIcon closable onClose={() => setResult(null)}
      title={`成功 ${result.succeededIds.length} 条，失败 ${result.failed.length} 条`}
      description={result.failed.length ? <>{result.failed.slice(0, 10).map((failure) => `${itemNames.current.get(failure.id) ?? '队壳记录'}：${syncErrorText(failure.code)}`).join('；')}{result.failed.length > 10 ? `；另有 ${result.failed.length - 10} 条失败` : ''}</> : fullPublishResult ? '当前任务中等待确认的队壳已处理；同步失败项已自动跳过。' : '所选队壳已处理'}
    /> : null}
    <Card title={<div className="sync-section-title"><strong>需要确认的球队队壳</strong><small>{selectedRun ? selectedRunDescription(selectedRun) : '同步完成后，需要确认的队壳会显示在这里。'}</small></div>} className="data-card">
      <div className="sync-filter-grid">
        <Select mode="multiple" aria-label="审核状态" value={statuses} onChange={(values) => { setStatuses(values.length ? values : DEFAULT_STATUSES); setErrorCode(''); setPage(1); }} options={[
          { value: 'PENDING', label: '等待确认' }, { value: 'FAILED', label: '同步失败' }, { value: 'PUBLISHED', label: '已发布' }, { value: 'REJECTED', label: '已驳回' }
        ]} />
        <Select mode="multiple" aria-label="变化类型" value={changeTypes} placeholder="全部变化类型" allowClear onChange={(values) => { setChangeTypes(values); setPage(1); }} options={[
          { value: 'ADDED', label: '新增' }, { value: 'UPDATED', label: '更新' }, { value: 'SOURCE_MISSING', label: '来源缺失' }
        ]} />
        <Input.Search aria-label="来源联赛" placeholder="来源联赛 ID" allowClear onSearch={(value) => { setSourceLeagueId(value.trim()); setPage(1); }} />
        <Input.Search aria-label="搜索队壳" placeholder="球队名称或来源 ID" allowClear onSearch={(value) => { setQuery(value.trim()); setPage(1); }} />
      </div>
      {statuses.includes('FAILED') && errorReasons.length ? <div className="sync-error-chips"><span>失败原因</span>{errorReasons.map((reason) => <Button key={reason.code} title={reason.code} type={errorCode === reason.code ? 'primary' : 'default'} onClick={() => { setErrorCode(errorCode === reason.code ? '' : reason.code); setPage(1); }}>{syncErrorText(reason.code)} · {reason.count}</Button>)}</div> : null}
      <div className="sync-batch-bar">
        <span>已选 {selectedIds.length} 条（最多 100 条）{runItemSummary ? `；当前任务可全量发布 ${runItemSummary.pending} 条` : ''}</span>
        <Space wrap>
          <Popconfirm
            title={`发布当前任务中 ${runItemSummary?.pending ?? 0} 条等待确认的队壳`}
            description={`自动跳过 ${runItemSummary?.failed ?? 0} 条同步失败，以及已发布或已驳回的记录。将处理当前任务的所有页面，不受上方筛选条件影响。`}
            okText="确认全量发布" cancelText="取消" onConfirm={publishAllPending}
          ><Button type="primary" loading={Boolean(fullPublishProgress)} disabled={!selectedRunId || !runItemSummary?.pending || mutating}>全量发布</Button></Popconfirm>
          <Popconfirm title={`将发布 ${selectedIds.length} 条队壳`} description={selectedSummary} okText="确认发布" cancelText="取消" onConfirm={() => mutate('publish')}><Button type="primary" disabled={!selectedIds.length || mutating}>批量发布</Button></Popconfirm>
          <Popconfirm title={`将驳回 ${selectedIds.length} 条队壳`} description={selectedSummary} okText="确认驳回" cancelText="取消" onConfirm={() => mutate('reject')}><Button disabled={!selectedIds.length || mutating}>批量驳回</Button></Popconfirm>
          <Popconfirm title={`将重试 ${selectedIds.length} 条失败项`} description={selectedSummary} okText="确认重试" cancelText="取消" onConfirm={() => mutate('retry')}><Button disabled={!selectedIds.length || mutating}>重试失败项</Button></Popconfirm>
        </Space>
      </div>
      {fullPublishProgress ? <Alert role="status" type="info" showIcon title={fullPublishProgress} /> : null}
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
    <details className="sync-history-disclosure">
      <summary><span>历史同步记录</span><small>查看以前执行过的任务，共 {runTotal} 次</small></summary>
      <Card className="data-card sync-history-card">
        <Table<PlatformSyncRunSummary>
          rowKey="id" size="small" dataSource={runs}
          rowClassName={(item) => item.id === selectedRunId ? 'is-selected' : ''}
          onRow={(item) => ({ onClick: () => { if (mutating) return; setSelectedRunId(item.id); setPage(1); setSelectedIds([]); } })}
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
                description="取消后任务不能继续，但已生成的待确认队壳仍可查看、发布或驳回。"
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
    <Drawer size="large" open={Boolean(detail)} title="队壳差异详情" onClose={() => setDetail(null)}>
      {detail ? <div className="team-sync-detail">
        <Descriptions column={1} bordered size="small" items={[
          { key: 'change', label: '变化类型', children: changeCopy[detail.changeType] },
          { key: 'status', label: '审核状态', children: statusCopy[detail.reviewStatus] },
          { key: 'source', label: '来源编号（排查用）', children: detail.sourceExternalId },
          { key: 'error', label: '错误', children: detail.errorCode ? syncErrorText(detail.errorCode) : '无' }
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

function selectedRunDescription(run: PlatformSyncRunSummary) {
  return `当前显示 ${formatDateTime(run.createdAt)} 的${runModeCopy[run.mode]}任务；可在历史记录中切换。`;
}

function teamName(item: TeamSyncItem): string {
  return item.candidate?.nameZh ?? item.candidate?.nameEn ?? item.current?.nameZh ?? item.current?.nameEn ?? '未命名球队';
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

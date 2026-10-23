import { Alert, Button, Card, Input, Popconfirm, Space, Switch, Table, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import {
  PlayerCatalogPublishResultSchema,
  PlayerCatalogReconciliationReportSchema,
  PlayerCatalogScheduleSchema,
  QueuedSyncRunSchema,
  type PlayerCatalogScheduleInput
} from '@efm/contracts';
import { adminApi, type AdminApi } from '../../lib/api';

type Report = ReturnType<typeof PlayerCatalogReconciliationReportSchema.parse>;

const changeCopy: Record<string, string> = {
  ADDED: '新增', UPDATED: '更新', UNCHANGED: '复核无变化',
  REMOVAL_CANDIDATE: '待确认下架', REMOVAL_CONFIRMED: '已确认下架', FAILED: '同步失败'
};
const reasonCopy: Record<string, string> = {
  ROLLING_AUDIT: '定期复核', SOURCE_CHANGE: '官网资料有变化',
  ANOMALOUS_MISSING_RATE: '缺失比例异常，已暂停下架',
  DETAIL_STILL_ACTIVE: '卡片详情仍可读取，暂不下架',
  EXPLICIT_SOURCE_DELETION: '官网明确标记失效',
  TWO_ADJACENT_TRUSTED_DAYS: '连续两天完整扫描均缺失',
  FIRST_TRUSTED_MISSING_DAY: '首次完整扫描缺失，等待次日复核'
};

export function DailyReconciliationCard({ api = adminApi, selectedRunId, selectedRunMode, onChanged }: {
  api?: AdminApi;
  selectedRunId: string | null;
  selectedRunMode?: string | undefined;
  onChanged: () => Promise<unknown> | unknown;
}) {
  const [schedule, setSchedule] = useState<PlayerCatalogScheduleInput | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    try {
      const result = await api.request('/v1/admin/data-sync/players/schedule', { schema: PlayerCatalogScheduleSchema });
      setSchedule({ enabled: result.enabled, timeZone: result.timeZone, localTime: result.localTime });
    } catch { setError('每日对账设置加载失败'); }
  }, [api]);

  const loadReport = useCallback(async () => {
    if (!selectedRunId || selectedRunMode !== 'RECONCILE') { setReport(null); return; }
    try {
      const result = await api.request(
        `/v1/admin/data-sync/players/runs/${selectedRunId}/reconciliation?page=${page}&pageSize=20`,
        { schema: PlayerCatalogReconciliationReportSchema }
      );
      setReport(result);
    } catch { setError('对账差异报告加载失败'); }
  }, [api, selectedRunId, selectedRunMode, page]);

  useEffect(() => { void loadSchedule(); }, [loadSchedule]);
  useEffect(() => { void loadReport(); }, [loadReport]);
  useEffect(() => {
    if (!selectedRunId || selectedRunMode !== 'RECONCILE' || report?.status === 'READY') return;
    const timer = setInterval(() => { void loadReport(); }, 10_000);
    return () => clearInterval(timer);
  }, [loadReport, report?.status, selectedRunId, selectedRunMode]);

  const save = async () => {
    if (!schedule) return;
    setBusy('save'); setError(null); setMessage(null);
    try {
      const saved = await api.request('/v1/admin/data-sync/players/schedule', {
        method: 'PUT', body: schedule, schema: PlayerCatalogScheduleSchema
      });
      setSchedule({ enabled: saved.enabled, timeZone: saved.timeZone, localTime: saved.localTime });
      setMessage('每日对账时间已保存');
    } catch { setError('保存失败；启用前请先完成一次人工对账，并检查时区和时间'); }
    finally { setBusy(null); }
  };

  const start = async () => {
    setBusy('start'); setError(null); setMessage(null);
    try {
      await api.request('/v1/admin/data-sync/players/reconciliation-runs', {
        method: 'POST', schema: QueuedSyncRunSchema
      });
      setMessage('对账任务已开始；完成后请查看差异报告');
      await onChanged();
    } catch { setError('启动对账失败；请检查是否已有同步任务正在执行'); }
    finally { setBusy(null); }
  };

  const publish = async () => {
    if (!report) return;
    setBusy('publish'); setError(null); setMessage(null);
    try {
      let published = 0;
      let result;
      do {
        result = await api.request(`/v1/admin/data-sync/players/runs/${report.runId}/publish-valid`, {
          method: 'POST', schema: PlayerCatalogPublishResultSchema
        });
        published += result.published;
        setMessage(`已发布 ${published} 个批次，剩余 ${result.remaining} 个批次`);
      } while (result.remaining > 0 && result.failed === 0);
      setMessage(`成功发布 ${published} 个批次；跳过 ${result.skipped} 个，失败 ${result.failed} 个`);
      await Promise.all([loadReport(), onChanged()]);
    } catch { setError('发布失败；请确认这是最新的可信对账结果'); }
    finally { setBusy(null); }
  };

  return <Card title="每日球员库对账" className="data-card">
    <p>每天核对官网新增和下架的球员卡；现有卡资料分批复核。到点开始扫描，管理员看过差异并发布后，小程序才会更新。</p>
    {error ? <Alert type="error" showIcon title={error} /> : null}
    {message ? <Alert type="success" showIcon title={message} /> : null}
    <Space wrap align="end">
      <label>时区<br /><Input aria-label="时区" placeholder="Asia/Shanghai" value={schedule?.timeZone ?? ''}
        onChange={(event) => setSchedule((current) => current && { ...current, timeZone: event.target.value })} /></label>
      <label>每日开始时间<br /><Input aria-label="每日开始时间" type="time" value={schedule?.localTime ?? ''}
        onChange={(event) => setSchedule((current) => current && { ...current, localTime: event.target.value })} /></label>
      <label>启用定时任务<br /><Switch aria-label="启用定时任务" checked={schedule?.enabled ?? false}
        onChange={(checked) => setSchedule((current) => current && { ...current, enabled: checked })} /></label>
      <Button onClick={() => void save()} loading={busy === 'save'} disabled={!schedule}>保存时间设置</Button>
      <Button onClick={() => void start()} loading={busy === 'start'} disabled={Boolean(busy)}>立即人工对账</Button>
    </Space>
    {report ? <section>
      <p>本次对账：{report.trusted ? '两遍完整扫描可信' : '扫描未确认完整'}；官网 {report.sourceTotal ?? '—'} 张，当前公开 {report.publicActive} 张。
        扫描日期 {report.businessDate ?? '—'}。</p>
      <Space wrap>{Object.entries(report.counts).map(([type, count]) =>
        <Tag key={type}>{changeCopy[type] ?? type} {count}</Tag>)}</Space>
      {(report.counts.REMOVAL_CANDIDATE ?? 0) > 0 || (report.counts.FAILED ?? 0) > 0
        ? <Alert type="warning" showIcon title="仍有待确认或失败项目；发布有效变更后，球员库暂不能标记为完全对齐。" /> : null}
      {report.warningCode === 'REMOVAL_ANOMALY'
        ? <Alert type="warning" showIcon title="官网缺失数量异常，系统已暂停全部下架；请核对来源后重新扫描。" /> : null}
      <Popconfirm title="发布本次可信对账中的有效变更？" description="失败和待确认下架的卡会自动跳过。"
        okText="确认发布" cancelText="取消" onConfirm={() => void publish()}>
        <Button type="primary" loading={busy === 'publish'} disabled={!report.trusted || report.status !== 'READY' || Boolean(busy)}>
          一键发布有效变更
        </Button>
      </Popconfirm>
      <Table rowKey="id" size="small" dataSource={report.items} columns={[
        { title: '球员卡', render: (_, item) => item.displayName ?? '未命名球员卡' },
        { title: '变化', dataIndex: 'changeType', render: (value: string) => changeCopy[value] ?? value },
        { title: '说明', dataIndex: 'reason', render: (value: string | null) => value ? reasonCopy[value] ?? value : '—' },
        { title: '发布', dataIndex: 'publishedAt', render: (value: string | null) => value ? '已发布' : '未发布' }
      ]} pagination={{ current: page, pageSize: report.pageSize, total: report.total, showSizeChanger: false,
        onChange: setPage }} />
    </section> : null}
  </Card>;
}

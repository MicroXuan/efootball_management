import { Alert, Button, Card, Empty, Space, Spin, Tag } from 'antd';
import {
  TeamCatalogSyncDifferenceSchema,
  TeamCatalogSyncRunSummarySchema,
  type TeamCatalogSyncDifference,
  type TeamCatalogSyncRunSummary
} from '@efm/contracts';
import { z } from 'zod';
import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminApi } from '../lib/api';

const RunListSchema = z.object({ items: z.array(TeamCatalogSyncRunSummarySchema) });
const DifferenceListSchema = z.object({ items: z.array(TeamCatalogSyncDifferenceSchema) });
const SyncResultSchema = z.object({ runId: z.string(), status: z.enum(['READY', 'FAILED']) }).passthrough();
const OkSchema = z.object({ ok: z.literal(true) });

export function TeamCatalogSyncCard({ api = adminApi }: { api?: AdminApi }) {
  const [runs, setRuns] = useState<TeamCatalogSyncRunSummary[]>([]);
  const [differences, setDifferences] = useState<TeamCatalogSyncDifference[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const response = await api.request('/v1/admin/team-catalog/sync-runs', { schema: RunListSchema });
      setRuns(response.items);
      const latest = response.items[0];
      if (latest) {
        const items = await api.request(`/v1/admin/team-catalog/sync-runs/${latest.id}/items`, { schema: DifferenceListSchema });
        setDifferences(items.items);
      } else setDifferences([]);
    } catch { setError('队壳同步状态加载失败'); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const start = async (mode: 'sample' | 'incremental') => {
    setWorking(true); setError(undefined);
    try {
      await api.request('/v1/admin/team-catalog/sync-runs', {
        method: 'POST', body: mode === 'sample' ? { mode, limit: 2 } : { mode }, schema: SyncResultSchema
      });
      await load();
    } catch { setError('队壳同步启动失败，已发布目录未发生变化'); }
    finally { setWorking(false); }
  };

  const review = async (item: TeamCatalogSyncDifference, decision: 'publish' | 'reject') => {
    setWorking(true); setError(undefined);
    try {
      await api.request(`/v1/admin/team-catalog/sync-items/${item.id}/${decision}`, { method: 'POST', schema: OkSchema });
      await load();
    } catch { setError('审核操作失败，请重新加载后再试'); }
    finally { setWorking(false); }
  };
  const latest = runs[0];

  return <Card className="team-catalog-sync-card" title="PESDATA 队壳同步" extra={<Space>
    <Button loading={working} onClick={() => void start('sample')}>抽样同步 2 支</Button>
    <Button type="primary" loading={working} onClick={() => void start('incremental')}>增量同步</Button>
  </Space>}>
    {error ? <Alert role="alert" type="error" showIcon title={error} action={<Button onClick={() => void load()}>重新加载</Button>} /> : null}
    {loading ? <div className="loading-block"><Spin /></div> : null}
    {!loading && !latest ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未同步队壳目录" /> : null}
    {!loading && latest ? <>
      <div className="team-sync-summary">
        <span>最近任务 <strong>{latest.mode}</strong></span><Tag color={latest.status === 'READY' ? 'success' : latest.status === 'FAILED' ? 'error' : 'processing'}>{latest.status}</Tag>
        <span>扫描 {latest.scannedCount}</span><span>新增 {latest.addedCount}</span><span>更新 {latest.updatedCount}</span><span>待确认缺失 {latest.missingCount}</span><span>失败 {latest.failedCount}</span>
      </div>
      {differences.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次没有待审核差异" /> : <div className="team-sync-differences">
        {differences.map((item) => <article key={item.id}>
          <div><strong>{item.candidate?.nameZh ?? item.candidate?.nameEn ?? item.candidate?.nameJa ?? item.sourceExternalId}</strong><span>{item.changeType} · {item.reviewStatus}</span></div>
          {item.reviewStatus === 'PENDING' ? <Space>
            <Button size="small" onClick={() => void review(item, 'reject')}>拒绝</Button>
            <Button size="small" type="primary" onClick={() => void review(item, 'publish')}>发布</Button>
          </Space> : <Tag>{item.reviewStatus}</Tag>}
        </article>)}
      </div>}
    </> : null}
  </Card>;
}

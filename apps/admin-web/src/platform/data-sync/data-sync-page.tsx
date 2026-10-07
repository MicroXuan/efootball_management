import { Alert, Spin, Tabs } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PlatformDataSyncOverviewSchema,
  QueuedSyncRunSchema,
  type PlatformDataSyncOverview
} from '@efm/contracts';
import { adminApi, type AdminApi } from '../../lib/api';
import { SyncRunCard } from './sync-run-card';
import { useSyncRun } from './use-sync-run';

type SyncTab = 'players' | 'teams';

export function DataSyncPage({ api = adminApi }: { api?: AdminApi }) {
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const activeTab: SyncTab = requestedTab === 'teams' ? 'teams' : 'players';
  const [overview, setOverview] = useState<PlatformDataSyncOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const result = await api.request('/v1/admin/data-sync/overview', { schema: PlatformDataSyncOverviewSchema });
      setOverview(result);
      setError(null);
      return result;
    } catch {
      setError('同步状态加载失败，请稍后重试');
      return null;
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const section = overview?.[activeTab] ?? null;
  const { refreshAfterMutation } = useSyncRun({ status: section?.activeRun?.status ?? null, refresh: loadOverview });
  const start = async (mode: 'sample' | 'incremental' | 'full') => {
    if (mutating) return;
    setMutating(true); setError(null);
    try {
      await api.request(`/v1/admin/data-sync/${activeTab}/runs`, {
        method: 'POST', body: { mode, ...(mode === 'sample' ? { limit: 100 } : {}) }, schema: QueuedSyncRunSchema
      });
      await refreshAfterMutation();
    } catch { setError('同步任务启动失败，请确认没有同类任务正在执行'); }
    finally { setMutating(false); }
  };
  const resume = async () => {
    const runId = section?.activeRun?.id;
    if (!runId || mutating) return;
    setMutating(true); setError(null);
    try {
      await api.request(`/v1/admin/data-sync/${activeTab}/runs/${runId}/resume`, { method: 'POST', schema: QueuedSyncRunSchema });
      await refreshAfterMutation();
    } catch { setError('任务继续失败，请刷新后确认任务状态'); }
    finally { setMutating(false); }
  };

  const panel = <>
    {loading && !overview ? <div className="loading-block"><Spin /></div> : null}
    {section ? <SyncRunCard
      kind={activeTab === 'players' ? 'PLAYER_CARDS' : 'TEAM_SHELLS'}
      run={section.activeRun}
      pendingReview={section.pendingReview}
      failedReview={section.failedReview}
      published={section.published}
      busy={mutating}
      onStart={start}
      onResume={resume}
    /> : null}
  </>;

  return <div className="data-sync-page">
    <header className="workspace-page-title data-sync-page__title">
      <div><span className="section-kicker">平台管理 · PESDATA</span><h1>数据同步</h1><p>同步外部数据，先审核差异，再发布到正式目录。</p></div>
      <div className="data-sync-page__legend"><span><i className="is-live" />运行中自动刷新</span><span>每页仅加载当前数据</span></div>
    </header>
    {error ? <Alert role="alert" showIcon type="error" title={error} /> : null}
    <Tabs
      className="data-sync-tabs"
      activeKey={activeTab}
      onChange={(key) => setParams({ tab: key }, { replace: false })}
      items={[
        { key: 'players', label: `球员卡${overview ? ` · ${overview.players.pendingReview + overview.players.failedReview}` : ''}`, children: activeTab === 'players' ? panel : null },
        { key: 'teams', label: `球队队壳${overview ? ` · ${overview.teams.pendingReview + overview.teams.failedReview}` : ''}`, children: activeTab === 'teams' ? panel : null }
      ]}
    />
  </div>;
}

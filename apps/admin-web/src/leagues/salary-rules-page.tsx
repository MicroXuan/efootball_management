import { Alert, Button, Card, Input, InputNumber, Select, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  SalaryRulePreviewResponseSchema,
  SalaryRuleVersionListResponseSchema,
  SalaryRuleVersionSchema,
  LeagueSeasonSummarySchema,
  SalaryRefreshPreviewResponseSchema,
  SalaryRecalculationResponseSchema
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';
import { insertSalaryTier, removeSalaryTier, salaryTierError, type SalaryTierDraft } from './salary-tier-editor';
import { useMutationKey } from '../lib/mutation-key';

type Tier = SalaryTierDraft;
type EditableTier = SalaryTierDraft & { draftId: string };
const defaultTiers: Tier[] = [{ minOverall: 0, maxOverall: 120, salaryMinor: null }];

export function SalaryRulesPage({ api = adminApi, initialTiers = defaultTiers }: { api?: AdminApi; initialTiers?: Tier[] }) {
  const { leagueId = '' } = useParams();
  const nextDraftId = useRef(initialTiers.length);
  const [items, setItems] = useState<z.infer<typeof SalaryRuleVersionSchema>[]>([]);
  const [tiers, setTiers] = useState<EditableTier[]>(() => initialTiers.map((tier, index) => ({ ...tier, draftId: `tier-${index}` })));
  const [legacyCap, setLegacyCap] = useState(0);
  const [preview, setPreview] = useState<z.infer<typeof SalaryRulePreviewResponseSchema> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshSeasons, setRefreshSeasons] = useState<z.infer<typeof LeagueSeasonSummarySchema>[]>([]);
  const [refreshSeasonId, setRefreshSeasonId] = useState('');
  const [refreshPreview, setRefreshPreview] = useState<z.infer<typeof SalaryRefreshPreviewResponseSchema> | null>(null);
  const [refreshReason, setRefreshReason] = useState('');
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const refreshKey = useMutationKey();
  const load = useCallback(async () => {
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/salary-rules`, { schema: SalaryRuleVersionListResponseSchema });
      setItems(result.items);
      const current = result.items[0];
      if (current) {
        setLegacyCap(current.salaryCapMinor);
        setTiers(current.tiers.map((tier) => ({ ...tier, draftId: `tier-${nextDraftId.current++}` })));
        setPreview(null);
      }
      setLoaded(true);
      setError(null);
    } catch { setError('工资规则加载失败'); }
  }, [api, leagueId]);
  useEffect(() => { void load(); }, [load]);
  const tierError = useMemo(() => salaryTierError(tiers), [tiers]);
  const updateTier = (index: number, field: keyof Tier, value: number | null) => {
    setTiers((current) => current.map((tier, at) => at === index ? { ...tier, [field]: value } : tier));
    setPreview(null);
  };
  const addTier = (index: number) => {
    setTiers((current) => insertSalaryTier(current, index, {
      draftId: `tier-${nextDraftId.current++}`, minOverall: null, maxOverall: null, salaryMinor: null,
    }));
    setPreview(null);
  };
  const removeTier = (index: number) => { setTiers((current) => removeSalaryTier(current, index)); setPreview(null); };
  const resetTiers = () => {
    setTiers([{ draftId: `tier-${nextDraftId.current++}`, minOverall: 0, maxOverall: 120, salaryMinor: null }]);
    setPreview(null);
  };
  const ruleTiers = tiers.map(({ minOverall, maxOverall, salaryMinor }) => ({ minOverall, maxOverall, salaryMinor }));
  const runPreview = async () => {
    setBusy(true); setError(null);
    try {
      setPreview(await api.request(`/v1/admin/leagues/${leagueId}/salary-rules/preview`, { method: 'POST', schema: SalaryRulePreviewResponseSchema, body: { salaryCapMinor: legacyCap, tiers: ruleTiers } }));
    } catch { setError('工资影响预览失败，请检查档位设置'); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    setBusy(true); setError(null);
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/salary-rules`, {
        method: 'POST', schema: SalaryRuleVersionSchema,
        body: { salaryCapMinor: legacyCap, tiers: ruleTiers, effectiveAt: new Date().toISOString(), expectedCurrentVersion: items[0]?.version ?? 0 }
      });
      setPreview(null); await load();
    } catch { setError('发布失败，规则版本可能已经变化，请重新加载'); }
    finally { setBusy(false); }
  };
  const loadRefreshSeasons = async () => {
    setRefreshBusy(true); setError(null);
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/seasons`, {
        schema: z.object({ items: z.array(LeagueSeasonSummarySchema), nextCursor: z.string().nullable() })
      });
      setRefreshSeasons(result.items);
      setRefreshSeasonId((current) => current || result.items.find((season) => ['READY', 'IN_PROGRESS'].includes(season.status))?.id || result.items[0]?.id || '');
      setRefreshPreview(null);
    } catch { setError('赛季加载失败，请重试'); }
    finally { setRefreshBusy(false); }
  };
  const previewRefresh = async () => {
    const ruleId = items[0]?.id;
    if (!refreshSeasonId || !ruleId) return;
    setRefreshBusy(true); setError(null); setRefreshNotice(null);
    try {
      const result = await api.request(`/v1/admin/roster/leagues/${leagueId}/seasons/${refreshSeasonId}/salary-refresh-preview?salaryRuleVersionId=${ruleId}`, {
        schema: SalaryRefreshPreviewResponseSchema
      });
      setRefreshPreview(result);
    } catch { setRefreshPreview(null); setError('球员数值与工资预览失败，请重试'); }
    finally { setRefreshBusy(false); }
  };
  const confirmRefresh = async () => {
    if (!refreshPreview || !refreshReason.trim()) return;
    setRefreshBusy(true); setError(null);
    try {
      const result = await api.request('/v1/admin/roster/salary-recalculations', {
        method: 'POST', schema: SalaryRecalculationResponseSchema,
        body: {
          leagueId, seasonId: refreshPreview.seasonId,
          salaryRuleVersionId: refreshPreview.salaryRuleVersionId,
          expectedPreviewHash: refreshPreview.previewHash,
          confirm: true, reason: refreshReason.trim(), idempotencyKey: refreshKey.current()
        }
      });
      refreshKey.reset(); setRefreshPreview(null);
      setRefreshNotice(`已重算 ${result.recalculatedPlayers} 名现役球员的工资`);
    } catch {
      setRefreshPreview(null);
      setError('重算失败，球员数值或工资可能已变化，请重新预览');
    } finally { setRefreshBusy(false); }
  };
  return <div className="workspace-grid">
    <Card className="form-card" title="工资档位与自动加点总评">
      {error ? <Alert role="alert" type="warning" showIcon title={error} /> : null}
      {!loaded ? (error ? null : <Typography.Text type="secondary">正在加载工资规则…</Typography.Text>) : <>
      {!items.length ? <Alert type="info" showIcon title="尚未发布工资规则" /> : <Typography.Text type="secondary">当前版本 v{items[0]?.version}</Typography.Text>}
      <p>由管理员逐档填写总评起止分和工资。例如第一档 0–88 分、第二档 89–91 分；系统会按球员总评落入的档位计算工资。各档须从 0 分连续覆盖到 120 分，最后一档填至 120 表示“起始分以上”。每支球队的工资帽在球队详情中单独确认和修改。</p>
      {tierError ? <Alert role="alert" type="error" showIcon title={tierError} /> : null}
      <Table<EditableTier> className="salary-tier-table" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }} rowKey="draftId" dataSource={tiers} columns={[
        { title: '档位', render: (_, _row, index) => `第 ${index + 1} 档` },
        { title: '起始分', render: (_, row, index) => <InputNumber aria-label={`第 ${index + 1} 档起始分`} min={0} max={120} precision={0} value={row.minOverall} disabled={busy} onChange={(value) => updateTier(index, 'minOverall', value)} /> },
        { title: '结束分', render: (_, row, index) => <InputNumber aria-label={`第 ${index + 1} 档结束分`} min={0} max={120} precision={0} value={row.maxOverall} disabled={busy} onChange={(value) => updateTier(index, 'maxOverall', value)} /> },
        { title: '工资', render: (_, row, index) => <InputNumber aria-label={`第 ${index + 1} 档工资`} min={1} precision={0} value={row.salaryMinor} disabled={busy} onChange={(value) => updateTier(index, 'salaryMinor', value)} /> },
        { title: '档位操作', render: (_, _row, index) => <Space size="small"><Button size="small" disabled={busy} onClick={() => addTier(index + 1)}>下方新增</Button><Button size="small" danger disabled={busy || tiers.length === 1} onClick={() => removeTier(index)}>删除</Button></Space> },
      ]} />
      <Space wrap><Button onClick={() => addTier(tiers.length)} disabled={busy}>新增档位</Button><Button onClick={resetTiers} disabled={busy}>重新填写档位</Button><Button onClick={() => void runPreview()} loading={busy} disabled={Boolean(tierError)}>预览影响</Button><Button type="primary" onClick={() => void publish()} loading={busy} disabled={Boolean(tierError) || !preview}>发布新版本</Button></Space>
      </>}
    </Card>
    <Card title="工资影响预览">
      {preview ? <Table pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }} rowKey="leagueTeamId" dataSource={preview.teams} columns={[
        { title: '球队', dataIndex: 'teamName' }, { title: '当前工资', dataIndex: 'currentSalaryMinor' },
        { title: '预计工资', dataIndex: 'projectedSalaryMinor' },
        { title: '变化', render: (_, row) => `${row.deltaMinor >= 0 ? '+' : ''}${row.deltaMinor}` },
        { title: '状态', render: (_, row) => <Tag color={row.projectedStatus === 'COMPLIANT' ? 'success' : 'error'}>{row.projectedStatus === 'COMPLIANT' ? '合规' : '超帽'}</Tag> }
      ]} /> : <Typography.Text type="secondary">修改档位后先预览，确认各队工资变化再发布。</Typography.Text>}
    </Card>
    <Card title="球员数值更新与伯德工资" className="form-card">
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary">读取球员当前卡的最新自动加点总评，预览后确认工资与伯德标签变化。现有工资档位不变。</Typography.Text>
        <Space wrap>
          <Button onClick={() => void loadRefreshSeasons()} loading={refreshBusy}>选择重算赛季</Button>
          <Select aria-label="重算赛季" style={{ minWidth: 180 }} value={refreshSeasonId || undefined} placeholder="先加载赛季"
            options={refreshSeasons.map((season) => ({ label: season.displayName, value: season.id }))}
            onChange={(value) => { setRefreshSeasonId(value); setRefreshPreview(null); refreshKey.reset(); }} />
          <Button onClick={() => void previewRefresh()} disabled={!refreshSeasonId || !items[0]} loading={refreshBusy}>预览数值与工资</Button>
        </Space>
        {refreshPreview ? <>
          <Table rowKey="ownershipId" pagination={{ pageSize: 10 }} dataSource={refreshPreview.players} columns={[
            { title: '球员', dataIndex: 'playerName' },
            { title: '总评变化', render: (_, row) => `${row.oldOverall} → ${row.newOverall}` },
            { title: '工资变化', render: (_, row) => `${row.oldSalaryMinor} → ${row.newSalaryMinor}` },
            { title: '伯德', render: (_, row) => row.birdDiscountApplied ? '生效' : '未生效' }
          ]} />
          <Table rowKey="leagueTeamId" pagination={{ pageSize: 10 }} dataSource={refreshPreview.teams} columns={[
            { title: '球队', dataIndex: 'teamName' },
            { title: '工资变化', render: (_, row) => `${row.currentSalaryMinor} → ${row.projectedSalaryMinor}` },
            { title: '工资帽', render: (_, row) => row.salaryCapMinor ?? '未设置' },
            { title: '状态', render: (_, row) => <Tag color={row.projectedOverCap ? 'error' : 'success'}>{row.projectedOverCap ? '超帽' : '合规'}</Tag> }
          ]} />
          <Space wrap><Input aria-label="工资重算原因" style={{ width: 260 }} value={refreshReason} onChange={(event) => setRefreshReason(event.target.value)} placeholder="填写重算原因" />
            <Button type="primary" disabled={!refreshReason.trim() || refreshPreview.players.length === 0} loading={refreshBusy} onClick={() => void confirmRefresh()}>确认工资重算</Button></Space>
        </> : null}
        {refreshNotice ? <Alert type="success" title={refreshNotice} /> : null}
      </Space>
    </Card>
  </div>;
}

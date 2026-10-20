import { Alert, Button, Card, InputNumber, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  SalaryRulePreviewResponseSchema,
  SalaryRuleVersionListResponseSchema,
  SalaryRuleVersionSchema
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';
import { insertSalaryTier, removeSalaryTier, salaryTierError, type SalaryTierDraft } from './salary-tier-editor';

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
  </div>;
}

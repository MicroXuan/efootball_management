import { Alert, Button, Card, Form, InputNumber, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  SalaryRulePreviewResponseSchema,
  SalaryRuleVersionListResponseSchema,
  SalaryRuleVersionSchema
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';

type Tier = { minOverall: number; maxOverall: number; salaryMinor: number };
const defaultTiers: Tier[] = [
  { minOverall: 0, maxOverall: 92, salaryMinor: 100 },
  ...Array.from({ length: 7 }, (_, index) => ({ minOverall: 93 + index, maxOverall: 93 + index, salaryMinor: 200 + index * 100 })),
  { minOverall: 100, maxOverall: 120, salaryMinor: 900 }
];

export function SalaryRulesPage({ api = adminApi, initialTiers = defaultTiers }: { api?: AdminApi; initialTiers?: Tier[] }) {
  const { leagueId = '' } = useParams();
  const [items, setItems] = useState<z.infer<typeof SalaryRuleVersionSchema>[]>([]);
  const [tiers, setTiers] = useState<Tier[]>(initialTiers);
  const [cap, setCap] = useState(2000);
  const [preview, setPreview] = useState<z.infer<typeof SalaryRulePreviewResponseSchema> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/salary-rules`, { schema: SalaryRuleVersionListResponseSchema });
      setItems(result.items);
      const current = result.items[0];
      if (current) { setCap(current.salaryCapMinor); setTiers(current.tiers); }
    } catch { setError('工资规则加载失败'); }
  }, [api, leagueId]);
  useEffect(() => { void load(); }, [load]);
  const valid = useMemo(() => {
    let next = 0;
    for (const tier of tiers) { if (tier.minOverall !== next || tier.maxOverall < tier.minOverall) return false; next = tier.maxOverall + 1; }
    return next === 121;
  }, [tiers]);
  const updateTier = (index: number, salaryMinor: number | null) => setTiers((current) => current.map((tier, at) => at === index ? { ...tier, salaryMinor: salaryMinor ?? 0 } : tier));
  const runPreview = async () => {
    setBusy(true); setError(null);
    try {
      setPreview(await api.request(`/v1/admin/leagues/${leagueId}/salary-rules/preview`, { method: 'POST', schema: SalaryRulePreviewResponseSchema, body: { salaryCapMinor: cap, tiers } }));
    } catch { setError('工资影响预览失败，请检查档位是否连续'); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    setBusy(true); setError(null);
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/salary-rules`, {
        method: 'POST', schema: SalaryRuleVersionSchema,
        body: { salaryCapMinor: cap, tiers, effectiveAt: new Date().toISOString(), expectedCurrentVersion: items[0]?.version ?? 0 }
      });
      setPreview(null); await load();
    } catch { setError('发布失败，规则版本可能已经变化，请重新加载'); }
    finally { setBusy(false); }
  };
  return <div className="workspace-grid">
    <Card className="form-card" title="工资帽与自动加点总评档位">
      {error ? <Alert role="alert" type="warning" showIcon title={error} /> : null}
      {!items.length ? <Alert type="info" showIcon title="尚未发布工资规则" /> : <Typography.Text type="secondary">当前版本 v{items[0]?.version}</Typography.Text>}
      <Form layout="vertical">
        <Form.Item label="工资帽"><InputNumber aria-label="工资帽" min={1} precision={0} value={cap} onChange={(value) => setCap(value ?? 0)} /></Form.Item>
      </Form>
      <Table<Tier> pagination={false} rowKey={(row) => `${row.minOverall}-${row.maxOverall}`} dataSource={tiers} columns={[
        { title: '自动加点总评范围', render: (_, row) => `${row.minOverall}–${row.maxOverall}` },
        { title: '工资', render: (_, row, index) => <InputNumber aria-label={`总评 ${row.minOverall}-${row.maxOverall} 工资`} min={1} precision={0} value={row.salaryMinor} onChange={(value) => updateTier(index, value)} /> }
      ]} />
      {!valid ? <Alert type="error" showIcon title="自动加点总评档位必须无重叠、无空档并覆盖 0–120" /> : null}
      <Space><Button onClick={() => void runPreview()} loading={busy} disabled={!valid}>预览影响</Button><Button type="primary" onClick={() => void publish()} loading={busy} disabled={!valid || !preview}>发布新版本</Button></Space>
    </Card>
    <Card title="工资影响预览">
      {preview ? <Table pagination={false} rowKey="leagueTeamId" dataSource={preview.teams} columns={[
        { title: '球队', dataIndex: 'teamName' }, { title: '当前工资', dataIndex: 'currentSalaryMinor' },
        { title: '预计工资', dataIndex: 'projectedSalaryMinor' },
        { title: '变化', render: (_, row) => `${row.deltaMinor >= 0 ? '+' : ''}${row.deltaMinor}` },
        { title: '状态', render: (_, row) => <Tag color={row.projectedStatus === 'COMPLIANT' ? 'green' : 'red'}>{row.projectedStatus === 'COMPLIANT' ? '合规' : '超帽'}</Tag> }
      ]} /> : <Typography.Text type="secondary">修改档位后先预览，确认各队工资变化再发布。</Typography.Text>}
    </Card>
  </div>;
}

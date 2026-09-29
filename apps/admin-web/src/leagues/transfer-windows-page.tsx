import { Alert, Button, Card, Checkbox, Form, Input, Select, Space, Table, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LeagueSeasonSummarySchema, TransferWindowListResponseSchema, TransferWindowSchema, type TransferWindow } from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';

type Fields = { name: string; startsAt: string; endsAt: string; allowBuy: boolean; allowSell: boolean; allowTransfer: boolean; allowCardUpgrade: boolean };
const empty: Fields = { name: '', startsAt: '', endsAt: '', allowBuy: true, allowSell: true, allowTransfer: true, allowCardUpgrade: true };
const toIso = (value: string) => new Date(value).toISOString();

export function TransferWindowsPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [seasons, setSeasons] = useState<z.infer<typeof LeagueSeasonSummarySchema>[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [windows, setWindows] = useState<TransferWindow[]>([]);
  const [fields, setFields] = useState<Fields>(empty);
  const [editing, setEditing] = useState<TransferWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.request(`/v1/admin/leagues/${leagueId}/roster-seasons`, { schema: z.array(LeagueSeasonSummarySchema) }).then((items) => { setSeasons(items); setSeasonId((current) => current || items[0]?.id || ''); }).catch(() => setError('赛季加载失败')); }, [api, leagueId]);
  const load = useCallback(async () => {
    if (!seasonId) return;
    try { setWindows((await api.request(`/v1/admin/leagues/${leagueId}/seasons/${seasonId}/transfer-windows`, { schema: TransferWindowListResponseSchema })).items); }
    catch { setError('转会窗口加载失败'); }
  }, [api, leagueId, seasonId]);
  useEffect(() => { void load(); }, [load]);
  const overlap = useMemo(() => {
    if (!fields.startsAt || !fields.endsAt) return false;
    const start = Date.parse(fields.startsAt); const end = Date.parse(fields.endsAt);
    return windows.some((window) => window.id !== editing?.id && start < Date.parse(window.endsAt) && end > Date.parse(window.startsAt));
  }, [editing?.id, fields.endsAt, fields.startsAt, windows]);
  const save = async () => {
    if (!seasonId || overlap) return;
    setBusy(true); setError(null);
    try {
      await api.request(editing ? `/v1/admin/transfer-windows/${editing.id}` : `/v1/admin/seasons/${seasonId}/transfer-windows`, { method: editing ? 'PATCH' : 'POST', schema: TransferWindowSchema, body: { ...fields, startsAt: toIso(fields.startsAt), endsAt: toIso(fields.endsAt), ...(editing ? { expectedVersion: editing.version } : {}) } });
      setFields(empty); setEditing(null); await load();
    } catch { setError('创建失败，窗口不可重叠且至少允许一种操作'); }
    finally { setBusy(false); }
  };
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((current) => ({ ...current, [key]: value }));
  const edit = (window: TransferWindow) => { setEditing(window); setFields({ name: window.name, startsAt: window.startsAt.slice(0, 16), endsAt: window.endsAt.slice(0, 16), allowBuy: window.allowBuy, allowSell: window.allowSell, allowTransfer: window.allowTransfer, allowCardUpgrade: window.allowCardUpgrade }); };
  return <div className="workspace-grid">
    <Card title="赛季转会窗口">
      {error ? <Alert role="alert" type="warning" showIcon title={error} /> : null}
      <Select aria-label="选择赛季" value={seasonId || undefined} onChange={setSeasonId} options={seasons.map((season) => ({ value: season.id, label: season.displayName }))} />
      <Table pagination={false} rowKey="id" dataSource={windows} columns={[
        { title: '名称', dataIndex: 'name' }, { title: '开始', dataIndex: 'startsAt' }, { title: '结束', dataIndex: 'endsAt' },
        { title: '允许操作', render: (_, row) => [row.allowBuy && '购买', row.allowSell && '出售', row.allowTransfer && '转会', row.allowCardUpgrade && '升卡'].filter(Boolean).join(' / ') },
        { title: '操作', render: (_, row) => <Button type="link" onClick={() => edit(row)}>编辑</Button> }
      ]} />
    </Card>
    <Card title={editing ? '编辑窗口' : '新增窗口'}>
      <Form layout="vertical">
        <Form.Item label="窗口名称"><Input value={fields.name} onChange={(event) => set('name', event.target.value)} /></Form.Item>
        <Form.Item label="开始时间"><Input aria-label="开始时间" type="datetime-local" value={fields.startsAt} onChange={(event) => set('startsAt', event.target.value)} /></Form.Item>
        <Form.Item label="结束时间"><Input aria-label="结束时间" type="datetime-local" value={fields.endsAt} onChange={(event) => set('endsAt', event.target.value)} /></Form.Item>
        <Space wrap>{(['allowBuy', 'allowSell', 'allowTransfer', 'allowCardUpgrade'] as const).map((key, index) => <Checkbox key={key} checked={fields[key]} onChange={(event) => set(key, event.target.checked)}>{['购买', '出售/解约', '队间转会', '卡片升级'][index]}</Checkbox>)}</Space>
      </Form>
      {overlap ? <Alert type="error" showIcon title="该时间段与已有转会窗口重叠" /> : null}
      <Typography.Paragraph type="secondary">赛季进行期间，仅在窗口时间内开放勾选的阵容操作。</Typography.Paragraph>
      <Space><Button type="primary" loading={busy} disabled={!seasonId || !fields.name || !fields.startsAt || !fields.endsAt || overlap} onClick={() => void save()}>{editing ? '保存窗口' : '创建窗口'}</Button>{editing ? <Button onClick={() => { setEditing(null); setFields(empty); }}>取消编辑</Button> : null}</Space>
    </Card>
  </div>;
}

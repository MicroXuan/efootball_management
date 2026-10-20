import { Alert, Button, Card, Form, Input, Select, Space, Table, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ForcedOfferWindowListResponseSchema, ForcedOfferWindowSchema, LeagueSeasonSummarySchema,
  type ForcedOfferWindow,
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, ApiError, type AdminApi } from '../lib/api';

type Fields = { name: string; startsAt: string; endsAt: string };
const empty: Fields = { name: '', startsAt: '', endsAt: '' };
const beijingToIso = (value: string) => new Date(`${value}:00+08:00`).toISOString();
const isoToBeijingInput = (value: string) => new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
const displayTime = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(value));
const statusText = { UPCOMING: '未开始', OPEN: '进行中', CLOSED: '已结束' } as const;

export function ForcedOfferWindowsPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [seasons, setSeasons] = useState<z.infer<typeof LeagueSeasonSummarySchema>[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [windows, setWindows] = useState<ForcedOfferWindow[]>([]);
  const [fields, setFields] = useState<Fields>(empty);
  const [editing, setEditing] = useState<ForcedOfferWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const mutation = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void api.request(`/v1/admin/leagues/${leagueId}/roster-seasons`, { schema: z.array(LeagueSeasonSummarySchema) })
      .then((items) => { if (alive) { setSeasons(items); setSeasonId((current) => current || items[0]?.id || ''); } })
      .catch(() => { if (alive) setError('赛季加载失败'); });
    return () => { alive = false; };
  }, [api, leagueId]);

  const load = useCallback(async () => {
    if (!seasonId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.request(`/v1/admin/leagues/${leagueId}/seasons/${seasonId}/forced-offer-windows`, { schema: ForcedOfferWindowListResponseSchema });
      setWindows(response.items);
    } catch { setError('强报期加载失败'); }
    finally { setLoading(false); }
  }, [api, leagueId, seasonId]);
  useEffect(() => { void load(); }, [load]);

  const start = fields.startsAt ? Date.parse(`${fields.startsAt}:00+08:00`) : NaN;
  const end = fields.endsAt ? Date.parse(`${fields.endsAt}:00+08:00`) : NaN;
  const overlap = useMemo(() => Number.isFinite(start) && Number.isFinite(end) && windows.some((window) =>
    window.id !== editing?.id && start < Date.parse(window.endsAt) && end > Date.parse(window.startsAt)
  ), [editing?.id, end, start, windows]);
  const valid = Boolean(seasonId && fields.name.trim() && Number.isFinite(start) && Number.isFinite(end) && start < end && !overlap);

  const save = async () => {
    if (!valid) return;
    const body = { name: fields.name.trim(), startsAt: beijingToIso(fields.startsAt), endsAt: beijingToIso(fields.endsAt), ...(editing ? { expectedVersion: editing.version } : {}) };
    const signature = JSON.stringify({ seasonId, editingId: editing?.id, body });
    if (mutation.current?.signature !== signature) mutation.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/seasons/${seasonId}/forced-offer-windows${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST', schema: ForcedOfferWindowSchema, body,
        headers: { 'Idempotency-Key': mutation.current.key },
      });
      mutation.current = null;
      setEditing(null);
      setFields(empty);
      await load();
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : '';
      setError(code === 'FORCED_OFFER_WINDOW_OVERLAP' ? '与已有强报期重叠，请调整时间'
        : code === 'FORCED_OFFER_WINDOW_LOCKED' ? '已开始或已有申请的强报期不能这样修改'
          : code === 'VERSION_CONFLICT' ? '强报期已被其他管理员修改，请刷新后重试'
            : code === 'FORCED_OFFER_WINDOW_INVALID_DATES' ? '结束时间必须晚于开始时间'
              : '保存强报期失败，请重试');
    } finally { setBusy(false); }
  };

  const edit = (window: ForcedOfferWindow) => {
    mutation.current = null;
    setEditing(window);
    setFields({ name: window.name, startsAt: isoToBeijingInput(window.startsAt), endsAt: isoToBeijingInput(window.endsAt) });
  };
  const set = (key: keyof Fields, value: string) => { mutation.current = null; setFields((current) => ({ ...current, [key]: value })); };

  return <div className="workspace-grid">
    <Card title="赛季强报期">
      <Typography.Paragraph type="secondary">强报期独立于转会窗口；截止后不能新提交或修改报价，已提交申请仍可审核。所有时间均为北京时间。</Typography.Paragraph>
      {error && <Alert role="alert" type="error" showIcon title={error} action={<Button onClick={() => void load()}>重试</Button>} />}
      <Select aria-label="选择赛季" value={seasonId || undefined} onChange={(value) => { setSeasonId(value); setEditing(null); setFields(empty); }} options={seasons.map((season) => ({ value: season.id, label: season.displayName }))} />
      <Table loading={loading} pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }} rowKey="id" scroll={{ x: 620 }} dataSource={windows}
        locale={{ emptyText: '暂无强报期' }} columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '开始（北京时间）', dataIndex: 'startsAt', render: (value: string) => displayTime(value) },
          { title: '截止（北京时间）', dataIndex: 'endsAt', render: (value: string) => displayTime(value) },
          { title: '状态', dataIndex: 'status', render: (value: ForcedOfferWindow['status']) => statusText[value] },
          { title: '操作', render: (_, row) => <Button type="link" onClick={() => edit(row)}>编辑</Button> },
        ]} />
    </Card>
    <Card title={editing ? '编辑强报期' : '新增强报期'}>
      <Form layout="vertical">
        <Form.Item label="强报期名称"><Input aria-label="强报期名称" maxLength={64} value={fields.name} onChange={(event) => set('name', event.target.value)} /></Form.Item>
        <Form.Item label="开始时间（北京时间）"><Input aria-label="开始时间" type="datetime-local" value={fields.startsAt} onChange={(event) => set('startsAt', event.target.value)} /></Form.Item>
        <Form.Item label="截止时间（北京时间）"><Input aria-label="结束时间" type="datetime-local" value={fields.endsAt} onChange={(event) => set('endsAt', event.target.value)} /></Form.Item>
      </Form>
      {overlap && <Alert type="warning" showIcon title="该时间段与已有强报期重叠" />}
      <Space><Button type="primary" disabled={!valid} loading={busy} onClick={() => void save()}>{editing ? '保存强报期' : '创建强报期'}</Button>
        {editing && <Button onClick={() => { setEditing(null); setFields(empty); mutation.current = null; }}>取消编辑</Button>}</Space>
    </Card>
  </div>;
}

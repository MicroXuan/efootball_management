import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LeagueSeasonSummarySchema, NominationWindowListResponseSchema, NominationWindowSchema, type NominationWindow } from '@efm/contracts';
import { z } from 'zod';
import { adminApi, ApiError, type AdminApi } from '../lib/api';
import { formatDateTime } from '../lib/date-time';
import { useMutationKey } from '../lib/mutation-key';

type Fields = { startsAt: string; endsAt: string; perTeamLimit: number | null };
const empty: Fields = { startsAt: '', endsAt: '', perTeamLimit: null };

export function NominationWindowsPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [seasons, setSeasons] = useState<z.infer<typeof LeagueSeasonSummarySchema>[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [windows, setWindows] = useState<NominationWindow[]>([]);
  const [editing, setEditing] = useState<NominationWindow | null>(null);
  const [fields, setFields] = useState<Fields>(empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useMutationKey();

  useEffect(() => {
    void api.request(`/v1/admin/leagues/${leagueId}/roster-seasons`, { schema: z.array(LeagueSeasonSummarySchema) })
      .then((items) => { setSeasons(items); setSeasonId(items[0]?.id ?? ''); })
      .catch(() => setError('赛季加载失败'));
  }, [api, leagueId]);

  const load = useCallback(async () => {
    if (!seasonId) return;
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/seasons/${seasonId}/nomination-windows`, { schema: NominationWindowListResponseSchema });
      setWindows(result.items);
    } catch { setError('提名期加载失败'); }
  }, [api, leagueId, seasonId]);
  useEffect(() => { void load(); }, [load]);

  const valid = fields.startsAt && fields.endsAt && Date.parse(fields.startsAt) < Date.parse(fields.endsAt) &&
    Number.isInteger(fields.perTeamLimit) && Number(fields.perTeamLimit) > 0;
  const overlap = useMemo(() => valid && windows.some((window) => window.id !== editing?.id &&
    Date.parse(fields.startsAt) < Date.parse(window.endsAt) && Date.parse(fields.endsAt) > Date.parse(window.startsAt)),
  [editing?.id, fields.endsAt, fields.startsAt, valid, windows]);

  const save = async () => {
    if (!valid || overlap || !seasonId || fields.perTeamLimit === null) return;
    setBusy(true); setError(null);
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/seasons/${seasonId}/nomination-windows${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Idempotency-Key': key.current() }, schema: NominationWindowSchema,
        body: { startsAt: new Date(fields.startsAt).toISOString(), endsAt: new Date(fields.endsAt).toISOString(), perTeamLimit: fields.perTeamLimit, ...(editing ? { expectedVersion: editing.version } : {}) }
      });
      key.reset(); setEditing(null); setFields(empty); await load();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === 'NOMINATION_WINDOW_VERSION_CONFLICT'
        ? '提名期已被其他管理员修改，请刷新后重试'
        : '保存失败：请确认时间不重叠、名额为正整数');
    } finally { setBusy(false); }
  };

  return <div className="workspace-grid">
    <Card title="赛季提名期" extra={<Tag color="green">提名供管理员筛选，不会自动开拍</Tag>}>
      {error ? <Alert role="alert" showIcon type="warning" title={error} /> : null}
      <Select aria-label="选择赛季" value={seasonId || undefined} onChange={(value) => { setSeasonId(value); setEditing(null); setFields(empty); }} options={seasons.map((season) => ({ value: season.id, label: season.displayName }))} />
      <Table pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }} rowKey="id" dataSource={windows} columns={[
        { title: '开始', dataIndex: 'startsAt', render: (value: string) => formatDateTime(value) },
        { title: '结束', dataIndex: 'endsAt', render: (value: string) => formatDateTime(value) },
        { title: '每队名额', dataIndex: 'perTeamLimit' },
        { title: '操作', render: (_, row) => <Space><Button type="link" onClick={() => { setEditing(row); setFields({ startsAt: row.startsAt.slice(0, 16), endsAt: row.endsAt.slice(0, 16), perTeamLimit: row.perTeamLimit }); key.reset(); }}>编辑</Button><Link to={`/leagues/${leagueId}/nomination-windows/${row.id}/candidates`}>查看提名名单</Link></Space> }
      ]} />
    </Card>
    <Card title={editing ? '修改提名期' : '新增提名期'}>
      <Form layout="vertical">
        <Form.Item label="开始时间" required><Input aria-label="开始时间" type="datetime-local" value={fields.startsAt} onChange={(event) => setFields((current) => ({ ...current, startsAt: event.target.value }))} /></Form.Item>
        <Form.Item label="结束时间" required><Input aria-label="结束时间" type="datetime-local" value={fields.endsAt} onChange={(event) => setFields((current) => ({ ...current, endsAt: event.target.value }))} /></Form.Item>
        <Form.Item label="每队提名名额" required><InputNumber aria-label="每队提名名额" min={1} max={65535} precision={0} value={fields.perTeamLimit} onChange={(value) => setFields((current) => ({ ...current, perTeamLimit: value }))} /></Form.Item>
      </Form>
      {overlap ? <Alert type="error" showIcon title="该时间段与已有提名期重叠" /> : null}
      <Typography.Paragraph type="secondary">仅在提名期内允许球队提交候选；结束后由管理员筛选并导入拍卖草稿。</Typography.Paragraph>
      <Space><Button type="primary" loading={busy} disabled={!valid || !!overlap || !seasonId} onClick={() => void save()}>{editing ? '保存修改' : '创建提名期'}</Button>{editing ? <Button onClick={() => { setEditing(null); setFields(empty); }}>取消编辑</Button> : null}</Space>
    </Card>
  </div>;
}

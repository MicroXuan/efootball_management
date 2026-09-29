import { Alert, Button, Card, Empty, Form, Input, InputNumber, Space, Spin, Table, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LeagueTeamDetailSchema, LeagueTeamListResponseSchema, PublicUserLookupSchema, type LeagueTeamSummary, type PublicUserLookup } from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

type CreateFields = { publicUserNo: string; teamNumber: number; name: string; shortName: string };

export function TeamsPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [teams, setTeams] = useState<LeagueTeamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [owner, setOwner] = useState<PublicUserLookup | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<CreateFields>();
  const mutationKey = useMutationKey();

  const load = useCallback(async () => {
    setLoading(true); setLoadError(false);
    try {
      const response = await api.request(`/v1/admin/leagues/${leagueId}/teams`, { schema: LeagueTeamListResponseSchema });
      setTeams(response.items);
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [api, leagueId]);
  useEffect(() => { void load(); }, [load]);

  const lookup = async () => {
    const publicUserNo = form.getFieldValue('publicUserNo');
    if (!/^\d{6}$/.test(publicUserNo ?? '')) { setLookupError('请输入完整的 6 位用户编号'); return; }
    setLookupError(null); setOwner(null);
    try { setOwner(await api.request(`/v1/admin/leagues/${leagueId}/users/${publicUserNo}`, { schema: PublicUserLookupSchema })); }
    catch { setLookupError('未找到该用户'); }
  };
  const create = async (values: CreateFields) => {
    if (!owner || owner.publicUserNo !== values.publicUserNo) { setMutationError('请先查找并确认用户'); return; }
    if (submitting) return; setSubmitting(true); setMutationError(null);
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/teams`, {
        method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: LeagueTeamDetailSchema,
        body: { ownerUserId: owner.id, teamNumber: values.teamNumber, name: values.name, shortName: values.shortName, logoUrl: null, defaultGameAccountId: null }
      });
      mutationKey.reset(); form.resetFields(); setOwner(null); await load();
    } catch (error) {
      setMutationError(error instanceof ApiError && error.code === 'LEAGUE_TEAM_NUMBER_ALREADY_EXISTS'
        ? '球队编号已被占用，请选择其他编号'
        : error instanceof ApiError && error.code === 'LEAGUE_TEAM_OWNER_ALREADY_EXISTS'
          ? '该用户在此联赛中已经拥有球队'
          : '球队创建失败，请稍后重试');
    } finally { setSubmitting(false); }
  };

  return <div className="page-grid page-grid--teams">
    <Card title="联赛球队" className="data-card">
      {loadError ? <Alert role="alert" type="error" showIcon title="球队列表加载失败" action={<Button onClick={() => void load()}>重新加载</Button>} /> : null}
      {loading ? <div className="loading-block"><Spin /></div> : teams.length === 0 && !loadError ? <Empty description="暂无球队" /> : null}
      {!loading && teams.length ? <Table rowKey="id" pagination={false} dataSource={teams} columns={[
        { title: '编号', dataIndex: 'teamNumber', render: (value) => value ?? '—' },
        { title: '球队', dataIndex: 'name', render: (value, row) => <Link to={`/leagues/${leagueId}/teams/${row.id}`}>{value}</Link> },
        { title: '用户编号', dataIndex: 'ownerPublicUserNo' },
        { title: '阵容', render: (_, row) => `${row.activePlayerCount}/25` },
        { title: '状态', render: (_, row) => <Tag color={row.rosterStatus === 'COMPLIANT' ? 'green' : 'red'}>{row.rosterStatus === 'COMPLIANT' ? '合规' : '超帽'}</Tag> }
      ]} /> : null}
    </Card>
    <Card title="创建球队" className="form-card">
      {mutationError ? <Alert role="alert" type="error" showIcon title={mutationError} /> : null}
      <Form<CreateFields> form={form} layout="vertical" onValuesChange={() => mutationKey.reset()} onFinish={create}>
        <Form.Item label="用户编号" htmlFor="public-user-no" required validateStatus={lookupError ? 'error' : undefined} help={lookupError}>
          <Space.Compact block><Form.Item name="publicUserNo" noStyle rules={[{ required: true }]}><Input id="public-user-no" maxLength={6} inputMode="numeric" /></Form.Item><Button onClick={() => void lookup()}>查找用户</Button></Space.Compact>
        </Form.Item>
        {owner ? <Alert type="success" showIcon title={owner.displayName} description={`用户编号 ${owner.publicUserNo}`} /> : null}
        <Form.Item label="球队编号" name="teamNumber" rules={[{ required: true }]}><InputNumber min={0} max={9999} precision={0} /></Form.Item>
        <Form.Item label="球队名称" name="name" rules={[{ required: true }]}><Input maxLength={64} /></Form.Item>
        <Form.Item label="球队简称" name="shortName" rules={[{ required: true }]}><Input maxLength={24} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting} disabled={!owner || submitting}>创建球队</Button>
      </Form>
    </Card>
  </div>;
}

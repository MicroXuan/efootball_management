import { Alert, Button, Card, Empty, Form, Input, InputNumber, Space, Spin, Table, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LeagueTeamDetailSchema, LeagueTeamListResponseSchema, PublicUserLookupSchema, type LeagueTeamSummary, type PublicUserLookup } from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../lib/api';
import { AdminIcon } from '../design-system/icons';
import { useMutationKey } from '../lib/mutation-key';
import { TeamShellPicker } from './team-shell-picker';

type CreateFields = { publicUserNo: string; teamNumber: number; ownerAlias: string; catalogTeamId: string };

export function filterLeagueTeams(teams: LeagueTeamSummary[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN');
  if (!normalizedKeyword) return teams;

  return teams.filter((team) => [
    team.name,
    team.shortName,
    team.ownerAlias,
    team.teamNumber?.toString() ?? '',
    team.ownerDisplayName ?? '',
    team.ownerPublicUserNo
  ].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedKeyword)));
}

export function TeamsPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [teams, setTeams] = useState<LeagueTeamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [owner, setOwner] = useState<PublicUserLookup | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [form] = Form.useForm<CreateFields>();
  const mutationKey = useMutationKey();
  const filteredTeams = useMemo(() => filterLeagueTeams(teams, filterKeyword), [teams, filterKeyword]);

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
        body: {
          ownerUserId: owner.id,
          ownerAlias: values.ownerAlias,
          teamNumber: values.teamNumber,
          catalogTeamId: values.catalogTeamId
        }
      });
      mutationKey.reset(); form.resetFields(); setOwner(null); await load();
    } catch (error) {
      setMutationError(error instanceof ApiError && error.code === 'LEAGUE_TEAM_NUMBER_ALREADY_EXISTS'
        ? '球队编号已被占用，请选择其他编号'
          : error instanceof ApiError && error.code === 'LEAGUE_TEAM_OWNER_ALREADY_EXISTS'
            ? '该用户在此联赛中已经拥有球队'
            : error instanceof ApiError && error.code === 'LEAGUE_TEAM_SHELL_ALREADY_ASSIGNED'
              ? '该队壳刚刚被其他球队占用，请重新选择'
          : error instanceof ApiError && error.code === 'LEAGUE_CURRENT_SEASON_REQUIRED'
            ? '请先在赛季管理中设置当前赛季，再绑定球队'
            : '球队创建失败，请稍后重试');
    } finally { setSubmitting(false); }
  };

  return <div className="page-grid page-grid--teams">
    <Card title="联赛球队" className="data-card">
      {loadError ? <Alert role="alert" type="error" showIcon title="球队列表加载失败" action={<Button onClick={() => void load()}>重新加载</Button>} /> : null}
      {loading ? <div className="loading-block"><Spin /></div> : teams.length === 0 && !loadError ? <Empty description="暂无球队" /> : null}
      {!loading && teams.length ? <Input.Search
        aria-label="筛选球队"
        allowClear
        placeholder="搜索球队、编号或负责人"
        value={filterKeyword}
        onChange={(event) => setFilterKeyword(event.target.value)}
        style={{ marginBottom: 20 }}
      /> : null}
      {!loading && teams.length > 0 && filteredTeams.length === 0 ? <Empty description="没有符合筛选条件的球队" /> : null}
      {!loading && filteredTeams.length ? <Table rowKey="id" pagination={false} dataSource={filteredTeams} columns={[
        { title: '球队', render: (_, row) => <div className="league-team-identity">
          {row.logoUrl ? <img src={row.logoUrl} alt={`${row.name}队徽`} /> : <span aria-label={`${row.name}暂无队徽`}>{row.shortName.slice(0, 2)}</span>}
          <Link to={`/leagues/${leagueId}/teams/${row.id}`}>
            <strong>{row.teamNumber === null ? row.name : `${row.teamNumber}-${row.name}`}</strong>
            <small>（{row.ownerAlias}）</small>
          </Link>
        </div> },
        { title: '负责人', render: (_, row) => row.ownerDisplayName ? `${row.ownerDisplayName} · ${row.ownerPublicUserNo}` : row.ownerPublicUserNo },
        { title: '阵容', render: (_, row) => `${row.activePlayerCount}/25` },
        { title: '状态', render: (_, row) => <Tag color={row.rosterStatus === 'COMPLIANT' ? 'success' : 'error'}>{row.rosterStatus === 'COMPLIANT' ? '合规' : '超帽'}</Tag> },
        { title: '操作', key: 'actions', render: (_, row) => <Link aria-label="管理阵容" to={`/leagues/${leagueId}/teams/${row.id}/roster`}>
          <Button icon={<AdminIcon name="teams" />}>管理阵容</Button>
        </Link> }
      ]} /> : null}
    </Card>
    <Card title="创建球队" className="form-card">
      {mutationError ? <Alert role="alert" type="error" showIcon title={mutationError} /> : null}
      <Form<CreateFields> form={form} layout="vertical" onValuesChange={() => mutationKey.reset()} onFinish={create}>
        <Form.Item label="用户编号" htmlFor="public-user-no" required validateStatus={lookupError ? 'error' : undefined} help={lookupError}>
          <Space.Compact block><Form.Item name="publicUserNo" noStyle rules={[{ required: true }]}><Input id="public-user-no" maxLength={6} inputMode="numeric" /></Form.Item><Button onClick={() => void lookup()}>查找用户</Button></Space.Compact>
        </Form.Item>
        {owner ? <Alert type="success" showIcon title={owner.displayName} description={`用户编号 ${owner.publicUserNo}`} /> : null}
        <Form.Item label="球队编号" name="teamNumber" rules={[{ required: true, message: '请输入球队编号' }]}><InputNumber min={0} max={9999} precision={0} /></Form.Item>
        <Form.Item label="联赛称呼" name="ownerAlias" extra="仅在当前联赛中显示，可填写微信昵称或常用称呼。" rules={[{ required: true, message: '请输入联赛称呼' }, { max: 32 }]}><Input maxLength={32} /></Form.Item>
        <Form.Item label="球队队壳" name="catalogTeamId" rules={[{ required: true, message: '请选择球队队壳' }]}>
          <TeamShellPicker api={api} leagueId={leagueId} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting} disabled={submitting}>创建球队</Button>
      </Form>
    </Card>
  </div>;
}

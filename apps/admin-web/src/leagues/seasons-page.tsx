import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Spin,
  Table,
  Tag
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  LeagueDetailSchema,
  LeagueSeasonSummarySchema,
  LeagueTeamListResponseSchema,
  type LeagueDetail,
  type LeagueSeasonSummary,
  type LeagueTeamSummary
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

const SeasonListSchema = z.object({ items: z.array(LeagueSeasonSummarySchema), nextCursor: z.string().nullable() });
const SetCurrentResponseSchema = z.object({ leagueId: z.string(), currentSeasonId: z.string(), version: z.number().int() });
const EnrollResponseSchema = z.object({ seasonId: z.string(), enrolledCount: z.number().int(), approvedEntryCount: z.number().int(), version: z.number().int() });

type Fields = {
  seasonNumber: number;
  displayName: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  startsAt: string;
  endsAt: string;
  superCapacity?: number;
  championCapacity?: number;
  promotionCount?: number;
};

const asInputTime = (value: string) => value.slice(0, 16);
const asIso = (value: string) => new Date(value).toISOString();

export function SeasonsPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [seasons, setSeasons] = useState<LeagueSeasonSummary[]>([]);
  const [teams, setTeams] = useState<LeagueTeamSummary[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<LeagueSeasonSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<Fields>();
  const mutationKey = useMutationKey();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [leagueResult, seasonResult, teamResult] = await Promise.all([
        api.request(`/v1/leagues/${leagueId}`, { schema: LeagueDetailSchema }),
        api.request(`/v1/admin/leagues/${leagueId}/seasons`, { schema: SeasonListSchema }),
        api.request(`/v1/admin/leagues/${leagueId}/teams`, { schema: LeagueTeamListResponseSchema })
      ]);
      setLeague(leagueResult); setSeasons(seasonResult.items); setTeams(teamResult.items);
      setSelectedTeamIds([]);
      if (!form.getFieldValue('displayName')) form.setFieldValue('seasonNumber', (seasonResult.items[0]?.seasonNumber ?? 0) + 1);
    } catch { setError('赛季数据加载失败，请稍后重试'); }
    finally { setLoading(false); }
  }, [api, form, leagueId]);

  useEffect(() => { void load(); }, [load]);

  const save = async (values: Fields) => {
    if (submitting) return;
    setSubmitting(true); setError(null);
    const timeline = {
      displayName: values.displayName,
      registrationOpensAt: asIso(values.registrationOpensAt),
      registrationClosesAt: asIso(values.registrationClosesAt),
      startsAt: asIso(values.startsAt),
      endsAt: asIso(values.endsAt),
      superCapacity: values.superCapacity,
      championCapacity: values.championCapacity,
      promotionCount: values.promotionCount
    };
    try {
      await api.request(
        editing
          ? `/v1/admin/leagues/${leagueId}/seasons/${editing.id}`
          : `/v1/admin/leagues/${leagueId}/seasons`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Idempotency-Key': mutationKey.current() },
          schema: LeagueSeasonSummarySchema,
          body: editing
            ? { ...timeline, expectedVersion: editing.version }
            : { ...timeline, seasonNumber: values.seasonNumber }
        }
      );
      mutationKey.reset(); setEditing(null); form.resetFields(); await load();
    } catch { setError(editing ? '赛季保存失败，请刷新后重试' : '赛季创建失败，请检查时间和赛季编号'); }
    finally { setSubmitting(false); }
  };

  const beginEdit = (season: LeagueSeasonSummary) => {
    mutationKey.reset(); setEditing(season);
    form.setFieldsValue({
      seasonNumber: season.seasonNumber,
      displayName: season.displayName,
      registrationOpensAt: asInputTime(season.registrationOpensAt),
      registrationClosesAt: asInputTime(season.registrationClosesAt),
      startsAt: asInputTime(season.startsAt),
      endsAt: asInputTime(season.endsAt),
      superCapacity: season.superCapacity,
      championCapacity: season.championCapacity,
      promotionCount: season.promotionCount
    });
  };

  const setCurrent = async (season: LeagueSeasonSummary) => {
    if (!league || submitting) return;
    setSubmitting(true); setError(null);
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/seasons/${season.id}/set-current`, {
        method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: SetCurrentResponseSchema,
        body: { expectedVersion: league.version }
      });
      mutationKey.reset(); await load();
    } catch { setError('当前赛季设置失败，联赛可能已被其他管理员修改'); }
    finally { setSubmitting(false); }
  };

  const enroll = async () => {
    const current = seasons.find((season) => season.id === league?.currentSeason?.id);
    if (!current || selectedTeamIds.length === 0 || submitting) return;
    setSubmitting(true); setError(null);
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/seasons/${current.id}/teams`, {
        method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: EnrollResponseSchema,
        body: { leagueTeamIds: selectedTeamIds, expectedSeasonVersion: current.version }
      });
      mutationKey.reset(); await load();
    } catch { setError('球队加入赛季失败，请刷新后重试'); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="loading-block"><Spin /></div>;
  return <div className="page-grid page-grid--seasons">
    <Card title="赛季管理" className="data-card">
      {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
      {seasons.length === 0 ? <Empty description="暂无赛季" /> : <Table rowKey="id" pagination={false} dataSource={seasons} columns={[
        { title: '赛季', dataIndex: 'displayName' },
        { title: '时间', render: (_, row) => `${row.startsAt.slice(0, 10)} 至 ${row.endsAt.slice(0, 10)}` },
        { title: '参赛球队', dataIndex: 'approvedEntryCount' },
        { title: '状态', render: (_, row) => league?.currentSeason?.id === row.id ? <Tag color="green">当前赛季</Tag> : <Tag>{row.status}</Tag> },
        { title: '操作', render: (_, row) => <>
          {row.status === 'DRAFT' ? <Button type="link" disabled={submitting} onClick={() => beginEdit(row)}>编辑</Button> : null}
          {league?.currentSeason?.id !== row.id ? <Button type="link" disabled={submitting} onClick={() => void setCurrent(row)}>设为当前赛季</Button> : null}
        </> }
      ]} />}
    </Card>

    <Card title={editing ? `编辑赛季 · ${editing.displayName}` : '新建赛季'} className="form-card">
      <Form<Fields> form={form} layout="vertical" onValuesChange={() => mutationKey.reset()} onFinish={save}>
        <Form.Item label="赛季编号" name="seasonNumber" rules={[{ required: true }]}><InputNumber min={1} disabled={Boolean(editing)} /></Form.Item>
        <Form.Item label="赛季名称" name="displayName" rules={[{ required: true }]}><Input maxLength={64} /></Form.Item>
        <Form.Item label="报名开始" name="registrationOpensAt" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
        <Form.Item label="报名截止" name="registrationClosesAt" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
        <Form.Item label="赛季开始" name="startsAt" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
        <Form.Item label="赛季结束" name="endsAt" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
        <div className="inline-fields">
          <Form.Item label="超级组人数" name="superCapacity"><InputNumber min={2} max={64} placeholder="沿用联赛" /></Form.Item>
          <Form.Item label="冠军组人数" name="championCapacity"><InputNumber min={2} max={64} placeholder="沿用联赛" /></Form.Item>
          <Form.Item label="升级建议数" name="promotionCount"><InputNumber min={0} max={32} placeholder="沿用联赛" /></Form.Item>
        </div>
        <Button type="primary" htmlType="submit" loading={submitting}>{editing ? '保存赛季' : '创建赛季'}</Button>
        {editing ? <Button onClick={() => { setEditing(null); form.resetFields(); }}>取消编辑</Button> : null}
      </Form>
    </Card>

    <Card title="当前赛季球队" className="data-card season-enrollment-card">
      {!league?.currentSeason ? <Alert type="warning" showIcon title="请先设置当前赛季" /> : <>
        <p>选择需要加入 {league.currentSeason.displayName} 的球队。系统不会自动全选，重复加入会安全跳过。</p>
        <Checkbox.Group
          className="season-team-options"
          options={teams.map((team) => ({ label: `${team.teamNumber ?? '—'} · ${team.name}（${team.ownerPublicUserNo}）`, value: team.id }))}
          value={selectedTeamIds}
          onChange={(values) => setSelectedTeamIds(values as string[])}
        />
        <Button type="primary" disabled={selectedTeamIds.length === 0 || submitting} loading={submitting} onClick={() => void enroll()}>加入当前赛季</Button>
      </>}
    </Card>
  </div>;
}

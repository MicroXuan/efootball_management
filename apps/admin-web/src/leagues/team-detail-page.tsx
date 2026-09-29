import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Select, Spin } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LeagueTeamDetailSchema, type LeagueTeamDetail } from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

type Fields = { teamNumber: number; name: string; shortName: string; status: 'ACTIVE' | 'ARCHIVED' };

export function TeamDetailPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '', teamId = '' } = useParams();
  const [detail, setDetail] = useState<LeagueTeamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<Fields>();
  const mutationKey = useMutationKey();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.request(`/v1/admin/leagues/${leagueId}/teams/${teamId}`, { schema: LeagueTeamDetailSchema });
      setDetail(next);
      form.setFieldsValue({ teamNumber: next.teamNumber ?? 0, name: next.name, shortName: next.shortName, status: next.status === 'NEEDS_NUMBER' ? 'ACTIVE' : next.status });
    } catch { setError('球队详情加载失败'); }
    finally { setLoading(false); }
  }, [api, form, leagueId, teamId]);
  useEffect(() => { void load(); }, [load]);
  const save = async (values: Fields) => {
    if (!detail || submitting) return;
    setSubmitting(true); setError(null);
    try {
      const updated = await api.request(`/v1/admin/leagues/${leagueId}/teams/${teamId}`, {
        method: 'PATCH', headers: { 'Idempotency-Key': mutationKey.current() }, schema: LeagueTeamDetailSchema,
        body: { ...values, expectedVersion: detail.version }
      });
      setDetail(updated);
      mutationKey.reset();
      form.setFieldsValue({
        teamNumber: updated.teamNumber ?? 0,
        name: updated.name,
        shortName: updated.shortName,
        status: updated.status === 'NEEDS_NUMBER' ? 'ACTIVE' : updated.status
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        await load(); mutationKey.reset(); setError('数据已被其他管理员更新，已为你加载最新版本');
      } else setError('保存失败，请稍后重试');
    } finally { setSubmitting(false); }
  };
  if (loading && !detail) return <div className="loading-block"><Spin /></div>;
  return <Card className="form-card detail-card" title={<><Link to={`/leagues/${leagueId}/teams`}>球队列表</Link><span> / 球队详情</span></>}>
    {error ? <Alert role="alert" type="warning" showIcon title={error} /> : null}
    {detail ? <>
      <Descriptions column={3} items={[
        { key: 'owner', label: '所属用户', children: `${detail.ownerDisplayName} · ${detail.ownerPublicUserNo}` },
        { key: 'roster', label: '阵容', children: `${detail.activePlayerCount}/25` },
        { key: 'salary', label: '工资', children: `${detail.salaryTotalMinor} / ${detail.salaryCapMinor}` }
      ]} />
      <Form<Fields> form={form} layout="vertical" onValuesChange={() => mutationKey.reset()} onFinish={save}>
        <Form.Item label="球队编号" name="teamNumber" rules={[{ required: true }]}><InputNumber min={0} max={9999} precision={0} /></Form.Item>
        <Form.Item label="球队名称" name="name" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item label="球队简称" name="shortName" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item label="球队状态" name="status"><Select options={[{ value: 'ACTIVE', label: '启用' }, { value: 'ARCHIVED', label: '归档' }]} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting} disabled={submitting}>保存球队</Button>
      </Form>
    </> : null}
  </Card>;
}

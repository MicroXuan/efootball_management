import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Spin, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { LeagueTeamDetailSchema, type LeagueTeamDetail } from '@efm/contracts';
import { AdminIcon } from '../design-system/icons';
import { ApiError, adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';
import { TeamShellActions } from './team-shell-actions';

type Fields = {
  teamNumber: number;
  ownerAlias: string;
  shellValueMinor: number;
};

export function TeamDetailPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '', teamId = '' } = useParams();
  const { hash } = useLocation();
  const [detail, setDetail] = useState<LeagueTeamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<'archive' | 'restore' | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [form] = Form.useForm<Fields>();
  const mutationKey = useMutationKey();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.request(`/v1/admin/leagues/${leagueId}/teams/${teamId}`, { schema: LeagueTeamDetailSchema });
      setDetail(next);
      form.setFieldsValue({ teamNumber: next.teamNumber ?? 0, ownerAlias: next.ownerAlias, shellValueMinor: next.shellValueMinor });
    } catch { setError('球队详情加载失败'); }
    finally { setLoading(false); }
  }, [api, form, leagueId, teamId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const targetId = hash.slice(1);
    if (!detail || !['team-settings', 'team-shell'].includes(targetId)) return;
    document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
  }, [detail, hash]);
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
        ownerAlias: updated.ownerAlias,
        shellValueMinor: updated.shellValueMinor
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        await load(); mutationKey.reset(); setError('数据已被其他管理员更新，已为你加载最新版本');
      } else setError('保存失败，请稍后重试');
    } finally { setSubmitting(false); }
  };
  const changeLifecycle = async () => {
    if (!detail || !lifecycleAction || !lifecycleReason.trim() || submitting) return;
    setSubmitting(true); setError(null);
    try {
      const updated = await api.request(`/v1/admin/leagues/${leagueId}/teams/${teamId}/${lifecycleAction}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': mutationKey.current() },
        schema: LeagueTeamDetailSchema,
        body: { expectedVersion: detail.version, reason: lifecycleReason.trim() }
      });
      setDetail(updated); setLifecycleAction(null); setLifecycleReason(''); mutationKey.reset();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        await load(); mutationKey.reset(); setError('数据已被其他管理员更新，已为你加载最新版本');
      } else setError(lifecycleAction === 'archive' ? '退出联赛失败，请稍后重试' : '恢复球队失败，请稍后重试');
    } finally { setSubmitting(false); }
  };
  if (loading && !detail) return <div className="loading-block"><Spin /></div>;
  return <div className="team-detail-page">
    <nav className="team-detail-breadcrumb" aria-label="球队详情面包屑"><Link to={`/leagues/${leagueId}/teams`}>球队列表</Link><span> / 球队详情</span></nav>
    {error ? <Alert role="alert" type="warning" showIcon title={error} /> : null}
    {detail ? <>
      <Card className="detail-card team-detail-card" title={<h2>球队概览</h2>}>
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} items={[
          { key: 'owner', label: '所属用户', children: `${detail.ownerDisplayName} · ${detail.ownerPublicUserNo}` },
          { key: 'identity', label: '球队身份', children: `${detail.teamNumber}-${detail.name}（${detail.ownerAlias}）` },
          { key: 'roster', label: '阵容', children: `${detail.activePlayerCount}/25` },
          { key: 'salary', label: '工资', children: `${detail.salaryTotalMinor} / ${detail.salaryCapMinor}` },
          { key: 'shell', label: '队壳价值', children: detail.shellValueMinor },
          { key: 'lifecycle', label: '联赛状态', children: detail.status === 'ARCHIVED' ? <Tag>已退赛</Tag> : <Tag color="success">现役</Tag> }
        ]} />
        <Button danger={detail.status !== 'ARCHIVED'} onClick={() => setLifecycleAction(detail.status === 'ARCHIVED' ? 'restore' : 'archive')}>
          {detail.status === 'ARCHIVED' ? '恢复球队' : '退出联赛'}
        </Button>
      </Card>
      {detail.status !== 'ARCHIVED' ? <><Card
        className="detail-card team-detail-card team-detail-roster-card"
        title={<h2>阵容管理</h2>}
        extra={<Link aria-label="管理阵容" to={`/leagues/${leagueId}/teams/${teamId}/roster`}><Button type="primary" icon={<AdminIcon name="teams" />}>管理阵容</Button></Link>}
      >
        <p>管理球员加入、移出、卡片升级和转会操作。当前阵容 {detail.activePlayerCount}/25 人。</p>
      </Card>
      <Card id="team-settings" className="form-card detail-card team-detail-card" title={<h2>球队设置</h2>}>
        <Form<Fields> form={form} layout="vertical" onValuesChange={() => mutationKey.reset()} onFinish={save}>
          <Form.Item label="球队编号" name="teamNumber" rules={[{ required: true }]}><InputNumber min={0} max={9999} precision={0} /></Form.Item>
          <Form.Item label="联赛称呼" name="ownerAlias" rules={[{ required: true }]}><Input maxLength={32} /></Form.Item>
          <Form.Item label="队壳价值" name="shellValueMinor" rules={[{ required: true, message: '请输入队壳价值' }]} extra="使用系统最小金额单位记录">
            <InputNumber min={0} max={4_294_967_295} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} disabled={submitting}>保存设置</Button>
        </Form>
      </Card>
      <Card id="team-shell" className="detail-card team-detail-card" title={<h2>队壳管理</h2>}>
        <p className="team-detail-section-copy">队名、简称和队徽属于队壳；更换或转让不会改变球队阵容、财务和比赛成绩。</p>
        <TeamShellActions api={api} leagueId={leagueId} team={detail} onCompleted={load} />
      </Card>
      </> : <Alert type="info" showIcon title="该球队已退出联赛" description="历史阵容、财务与比赛记录仍会保留；恢复球队后才可继续业务操作。" />}
      <Modal
        open={lifecycleAction !== null}
        title={lifecycleAction === 'archive' ? '确认退出联赛' : '确认恢复球队'}
        okText={lifecycleAction === 'archive' ? '确认退出' : '确认恢复'}
        okButtonProps={{ danger: lifecycleAction === 'archive', disabled: !lifecycleReason.trim(), loading: submitting }}
        cancelButtonProps={{ disabled: submitting }}
        onOk={() => void changeLifecycle()}
        onCancel={() => { if (!submitting) { setLifecycleAction(null); setLifecycleReason(''); mutationKey.reset(); } }}
      >
        <Input.TextArea aria-label="操作原因" maxLength={512} value={lifecycleReason} onChange={(event) => { setLifecycleReason(event.target.value); mutationKey.reset(); }} placeholder="请填写操作原因" />
      </Modal>
    </> : null}
  </div>;
}

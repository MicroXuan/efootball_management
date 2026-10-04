import { Alert, Button, Card, Descriptions, Empty, Input, Modal, Space, Table, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LeagueSeasonSummarySchema, LeagueTeamListResponseSchema, RosterLifecycleUpdateResponseSchema, RosterMutationResponseSchema, TeamRosterViewSchema, type RosterEntry } from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';
import { AcquirePlayerDrawer } from './acquire-player-drawer';
import { TransferPlayerDrawer } from './transfer-player-drawer';
import { UpgradeCardDrawer } from './upgrade-card-drawer';

export function RosterPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '', teamId = '' } = useParams(); const [params, setParams] = useSearchParams();
  const [view, setView] = useState<z.infer<typeof TeamRosterViewSchema> | null>(null); const [teams, setTeams] = useState<{ id: string; name: string }[]>([]); const [selected, setSelected] = useState<RosterEntry | null>(null); const [error, setError] = useState<string | null>(null); const [drawer, setDrawer] = useState<'acquire' | 'transfer' | 'upgrade' | null>(null); const [lifecycleStatus, setLifecycleStatus] = useState<'ACTIVE' | 'DISAPPEARED' | 'RETIRED' | null>(null); const [lifecycleReason, setLifecycleReason] = useState(''); const [lifecycleSubmitting, setLifecycleSubmitting] = useState(false); const releaseKey = useMutationKey(); const lifecycleKey = useMutationKey();
  const seasonId = params.get('seasonId') ?? '';
  useEffect(() => { void Promise.all([
    api.request(`/v1/admin/leagues/${leagueId}/roster-seasons`, { schema: z.array(LeagueSeasonSummarySchema) }),
    api.request(`/v1/admin/leagues/${leagueId}/teams`, { schema: LeagueTeamListResponseSchema })
  ]).then(([seasons, result]) => { setTeams(result.items.map((team) => ({ id: team.id, name: team.name }))); if (!seasonId && seasons[0]) setParams({ seasonId: seasons[0].id }, { replace: true }); }).catch(() => setError('赛季或球队数据加载失败')); }, [api, leagueId, seasonId, setParams]);
  const load = useCallback(async () => { if (!seasonId) return; try { setView(await api.request(`/v1/admin/roster/leagues/${leagueId}/teams/${teamId}/roster?seasonId=${seasonId}`, { schema: TeamRosterViewSchema })); setSelected(null); } catch { setError('阵容加载失败'); } }, [api, leagueId, seasonId, teamId]);
  useEffect(() => { void load(); }, [load]);
  const release = () => { if (!selected) return; Modal.confirm({ title: `确认出售/解约 ${selected.playerName}？`, content: '该操作会写入不可修改的交易历史。', okText: '确认', cancelText: '取消', onOk: async () => { try { await api.request('/v1/admin/roster/releases', { method: 'POST', schema: RosterMutationResponseSchema, body: { seasonId, ownershipId: selected.id, amountMinor: null, reason: '管理员解约', expectedVersion: selected.version, idempotencyKey: releaseKey.current() } }); releaseKey.reset(); await load(); } catch { setError('出售/解约失败，请检查窗口权限'); } } }); };
  const openLifecycle = (status: 'ACTIVE' | 'DISAPPEARED' | 'RETIRED') => { setLifecycleReason(''); lifecycleKey.reset(); setLifecycleStatus(status); };
  const updateLifecycle = async () => {
    if (!selected || !lifecycleStatus || !lifecycleReason.trim()) return;
    setLifecycleSubmitting(true);
    try {
      await api.request('/v1/admin/roster/lifecycle-status', {
        method: 'POST', schema: RosterLifecycleUpdateResponseSchema,
        body: { seasonId, ownershipId: selected.id, status: lifecycleStatus, reason: lifecycleReason.trim(), expectedVersion: selected.version, idempotencyKey: lifecycleKey.current() }
      });
      lifecycleKey.reset(); setLifecycleStatus(null); await load();
    } catch { setError('球员状态更新失败，请刷新后重试'); }
    finally { setLifecycleSubmitting(false); }
  };
  if (!view) return <Card>{error ? <Alert role="alert" type="warning" title={error} /> : '正在加载阵容…'}</Card>;
  return <Card title={<><Link to={`/leagues/${leagueId}/teams/${teamId}`}>球队详情</Link><span> / {view.teamName}阵容</span></>}>
    {error ? <Alert role="alert" type="warning" title={error} /> : null}
    <Descriptions column={4} items={[{ key: 'count', label: '人数', children: `${view.summary.rosterCount}/25` }, { key: 'salary', label: '工资', children: `${view.summary.salaryMinor}/${view.summary.salaryCapMinor}` }, { key: 'window', label: '当前窗口', children: view.activeWindowName ? <Tag color="success">{view.activeWindowName}</Tag> : <Tag>关闭</Tag> }, { key: 'season', label: '赛季 ID', children: seasonId }]} />
    <Space wrap><Button type="primary" disabled={!view.operations.BUY} onClick={() => setDrawer('acquire')}>购买球员</Button><Button disabled={!view.operations.SELL || !selected || selected.status !== 'ACTIVE'} onClick={release}>出售/解约</Button><Button aria-label="转会" disabled={!view.operations.TRANSFER || !selected || selected.status !== 'ACTIVE'} onClick={() => setDrawer('transfer')}>转会</Button><Button disabled={!view.operations.CARD_UPGRADE || !selected || selected.status !== 'ACTIVE'} onClick={() => setDrawer('upgrade')}>卡片升级</Button><Button disabled={!selected || selected.status === 'DISAPPEARED'} onClick={() => openLifecycle('DISAPPEARED')}>标记消失</Button><Button disabled={!selected || selected.status === 'RETIRED'} onClick={() => openLifecycle('RETIRED')}>标记退役</Button><Button disabled={!selected || selected.status === 'ACTIVE'} onClick={() => openLifecycle('ACTIVE')}>恢复有效</Button></Space>
    <Table locale={{ emptyText: <Empty description="暂无阵容球员" /> }} pagination={false} rowKey="id" dataSource={view.entries} rowSelection={{ type: 'radio', selectedRowKeys: selected ? [selected.id] : [], onChange: (_, rows) => { setSelected(rows[0] ?? null); releaseKey.reset(); lifecycleKey.reset(); } }} columns={[{ title: '球员', dataIndex: 'playerName' }, { title: '状态', dataIndex: 'status', render: (status: RosterEntry['status']) => <Tag color={status === 'ACTIVE' ? 'success' : status === 'DISAPPEARED' ? 'warning' : 'default'}>{{ ACTIVE: '有效', DISAPPEARED: '已消失', RETIRED: '已退役', RELEASED: '已解约', TRANSFERRED: '已转会' }[status]}</Tag> }, { title: '卡片', dataIndex: 'cardName' }, { title: '自动加点总评', dataIndex: 'maxOverall' }, { title: 'DT', dataIndex: 'dtRating' }, { title: '工资', dataIndex: 'salaryMinor' }]} />
    <Modal open={lifecycleStatus !== null} title="更新球员状态" okText="确认更新" cancelText="取消" confirmLoading={lifecycleSubmitting} okButtonProps={{ disabled: !lifecycleReason.trim() }} onOk={() => void updateLifecycle()} onCancel={() => setLifecycleStatus(null)}>
      <p>目标状态：{lifecycleStatus === 'ACTIVE' ? '有效' : lifecycleStatus === 'DISAPPEARED' ? '已消失' : '已退役'}</p>
      <Input.TextArea aria-label="状态变更原因" value={lifecycleReason} onChange={(event) => { setLifecycleReason(event.target.value); lifecycleKey.reset(); }} placeholder="请填写状态变更原因" maxLength={512} showCount />
    </Modal>
    <AcquirePlayerDrawer open={drawer === 'acquire'} leagueId={leagueId} teamId={teamId} seasonId={seasonId} summary={view.summary} api={api} onClose={() => setDrawer(null)} onCompleted={() => void load()} />
    <TransferPlayerDrawer open={drawer === 'transfer'} entry={selected} seasonId={seasonId} teams={teams} api={api} onClose={() => setDrawer(null)} onCompleted={() => void load()} />
    <UpgradeCardDrawer open={drawer === 'upgrade'} leagueId={leagueId} seasonId={seasonId} entry={selected} currentSalaryMinor={view.summary.salaryMinor} salaryCapMinor={view.summary.salaryCapMinor} api={api} onClose={() => setDrawer(null)} onCompleted={() => void load()} />
  </Card>;
}

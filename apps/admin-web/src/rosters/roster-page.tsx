import { Alert, Button, Card, Descriptions, Empty, Modal, Space, Table, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LeagueSeasonSummarySchema, LeagueTeamListResponseSchema, RosterMutationResponseSchema, TeamRosterViewSchema, type RosterEntry } from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';
import { AcquirePlayerDrawer } from './acquire-player-drawer';
import { TransferPlayerDrawer } from './transfer-player-drawer';
import { UpgradeCardDrawer } from './upgrade-card-drawer';

export function RosterPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '', teamId = '' } = useParams(); const [params, setParams] = useSearchParams();
  const [view, setView] = useState<z.infer<typeof TeamRosterViewSchema> | null>(null); const [teams, setTeams] = useState<{ id: string; name: string }[]>([]); const [selected, setSelected] = useState<RosterEntry | null>(null); const [error, setError] = useState<string | null>(null); const [drawer, setDrawer] = useState<'acquire' | 'transfer' | 'upgrade' | null>(null); const releaseKey = useMutationKey();
  const seasonId = params.get('seasonId') ?? '';
  useEffect(() => { void Promise.all([
    api.request(`/v1/admin/leagues/${leagueId}/roster-seasons`, { schema: z.array(LeagueSeasonSummarySchema) }),
    api.request(`/v1/admin/leagues/${leagueId}/teams`, { schema: LeagueTeamListResponseSchema })
  ]).then(([seasons, result]) => { setTeams(result.items.map((team) => ({ id: team.id, name: team.name }))); if (!seasonId && seasons[0]) setParams({ seasonId: seasons[0].id }, { replace: true }); }).catch(() => setError('赛季或球队数据加载失败')); }, [api, leagueId, seasonId, setParams]);
  const load = useCallback(async () => { if (!seasonId) return; try { setView(await api.request(`/v1/admin/roster/leagues/${leagueId}/teams/${teamId}/roster?seasonId=${seasonId}`, { schema: TeamRosterViewSchema })); setSelected(null); } catch { setError('阵容加载失败'); } }, [api, leagueId, seasonId, teamId]);
  useEffect(() => { void load(); }, [load]);
  const release = () => { if (!selected) return; Modal.confirm({ title: `确认出售/解约 ${selected.playerName}？`, content: '该操作会写入不可修改的交易历史。', okText: '确认', cancelText: '取消', onOk: async () => { try { await api.request('/v1/admin/roster/releases', { method: 'POST', schema: RosterMutationResponseSchema, body: { seasonId, ownershipId: selected.id, amountMinor: null, reason: '管理员解约', expectedVersion: selected.version, idempotencyKey: releaseKey.current() } }); releaseKey.reset(); await load(); } catch { setError('出售/解约失败，请检查窗口权限'); } } }); };
  if (!view) return <Card>{error ? <Alert role="alert" type="warning" title={error} /> : '正在加载阵容…'}</Card>;
  return <Card title={<><Link to={`/leagues/${leagueId}/teams/${teamId}`}>球队详情</Link><span> / {view.teamName}阵容</span></>}>
    {error ? <Alert role="alert" type="warning" title={error} /> : null}
    <Descriptions column={4} items={[{ key: 'count', label: '人数', children: `${view.summary.rosterCount}/25` }, { key: 'salary', label: '工资', children: `${view.summary.salaryMinor}/${view.summary.salaryCapMinor}` }, { key: 'window', label: '当前窗口', children: view.activeWindowName ? <Tag color="green">{view.activeWindowName}</Tag> : <Tag>关闭</Tag> }, { key: 'season', label: '赛季 ID', children: seasonId }]} />
    <Space wrap><Button type="primary" disabled={!view.operations.BUY} onClick={() => setDrawer('acquire')}>购买球员</Button><Button disabled={!view.operations.SELL || !selected} onClick={release}>出售/解约</Button><Button aria-label="转会" disabled={!view.operations.TRANSFER || !selected} onClick={() => setDrawer('transfer')}>转会</Button><Button disabled={!view.operations.CARD_UPGRADE || !selected} onClick={() => setDrawer('upgrade')}>卡片升级</Button></Space>
    <Table locale={{ emptyText: <Empty description="暂无阵容球员" /> }} pagination={false} rowKey="id" dataSource={view.entries} rowSelection={{ type: 'radio', selectedRowKeys: selected ? [selected.id] : [], onChange: (_, rows) => { setSelected(rows[0] ?? null); releaseKey.reset(); } }} columns={[{ title: '球员', dataIndex: 'playerName' }, { title: '卡片', dataIndex: 'cardName' }, { title: '自动加点总评', dataIndex: 'maxOverall' }, { title: '工资', dataIndex: 'salaryMinor' }]} />
    <AcquirePlayerDrawer open={drawer === 'acquire'} leagueId={leagueId} teamId={teamId} seasonId={seasonId} summary={view.summary} api={api} onClose={() => setDrawer(null)} onCompleted={() => void load()} />
    <TransferPlayerDrawer open={drawer === 'transfer'} entry={selected} seasonId={seasonId} teams={teams} api={api} onClose={() => setDrawer(null)} onCompleted={() => void load()} />
    <UpgradeCardDrawer open={drawer === 'upgrade'} leagueId={leagueId} seasonId={seasonId} entry={selected} currentSalaryMinor={view.summary.salaryMinor} salaryCapMinor={view.summary.salaryCapMinor} api={api} onClose={() => setDrawer(null)} onCompleted={() => void load()} />
  </Card>;
}

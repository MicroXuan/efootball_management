import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { NominationCandidateListSchema, type NominationCandidate } from '@efm/contracts';
import { adminApi, type AdminApi } from '../lib/api';

export function NominationShortlistPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '', windowId = '' } = useParams();
  const [items, setItems] = useState<NominationCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const response = await api.request(`/v1/admin/leagues/${leagueId}/nomination-windows/${windowId}/candidates`, { schema: NominationCandidateListSchema });
      setItems(response.items); setError(null);
    } catch { setError('提名候选加载失败，请检查联赛管理权限'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [api, leagueId, windowId]);
  return <Card title="提名候选名单" extra={<Space><Button onClick={() => void load()} loading={busy}>刷新</Button><Link to={`/leagues/${leagueId}/nomination-windows`}>返回提名期</Link></Space>}>
    {error ? <Alert role="alert" showIcon type="error" title={error} /> : null}
    <Typography.Paragraph type="secondary">同一球员只显示一次；提名球队和当前归属资格以实时数据为准。后续可从这里选择球员导入拍卖草稿。</Typography.Paragraph>
    <Table rowKey="playerId" pagination={false} dataSource={items} locale={{ emptyText: '暂无球队提名' }} columns={[
      { title: '球员', dataIndex: 'playerName' },
      { title: '提名球队数', dataIndex: 'nominatorCount' },
      { title: '提名球队', render: (_, row) => row.nominators.map((team) => `${team.teamNumber ?? '—'}号 ${team.teamName}（${team.ownerAlias}）`).join('、') },
      { title: '资格', render: (_, row) => row.eligible ? <Tag color="success">可导入</Tag> : <Tag color="error">已被签约/不可导入</Tag> }
    ]} />
  </Card>;
}

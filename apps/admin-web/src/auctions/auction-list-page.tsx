import { Alert, Button, Card, Empty, Spin, Table, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PlayerAuctionBatchListItemSchema, PlayerAuctionBatchListResponseSchema } from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';
import { formatDateTime } from '../lib/date-time';

type PlayerAuctionBatchListItem = z.infer<typeof PlayerAuctionBatchListItemSchema>;

const statusLabel: Record<string, string> = {
  DRAFT: '草稿', READY: '待开始', ACTIVE: '进行中', PAUSED: '已暂停',
  COMPLETED: '已结束', CANCELLED: '已取消', RECOVERY_REQUIRED: '需要人工恢复'
};

export function AuctionListPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [items, setItems] = useState<PlayerAuctionBatchListItem[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try {
      const response = await api.request(`/v1/admin/leagues/${leagueId}/player-auctions`, { schema: PlayerAuctionBatchListResponseSchema });
      setItems(response.items);
    } catch { setError(true); }
  }, [api, leagueId]);
  useEffect(() => { void load(); }, [load]);

  if (!items && !error) return <div className="loading-block"><Spin /><span>正在读取球员拍卖…</span></div>;
  return <div className="auction-page">
    <header className="auction-page__header"><div><span className="section-kicker">联赛拍卖台</span><h2>球员拍卖</h2><p>每个批次选择微信群或小程序出价，系统按顺序自动推进球员。</p></div><Link className="ant-btn ant-btn-primary auction-create-button" to={`/leagues/${leagueId}/auctions/new`}><span className="auction-create-button__icon" aria-hidden="true">＋</span><span>创建拍卖批次</span></Link></header>
    {error ? <Alert role="alert" type="error" showIcon title="拍卖列表加载失败" action={<Button onClick={() => void load()}>重试</Button>} /> : null}
    {items?.length === 0 ? <Card className="auction-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>还没有球员拍卖</strong><span>创建草稿后配置球员、起拍价和最低加价。</span></>} /><Link className="ant-btn ant-btn-primary auction-create-button auction-create-button--compact" to={`/leagues/${leagueId}/auctions/new`}><span className="auction-create-button__icon" aria-hidden="true">＋</span><span>创建拍卖批次</span></Link></Card> : null}
    {items?.length ? <Card className="data-card" title="拍卖批次"><Table rowKey="id" pagination={false} dataSource={items} columns={[
      { title: '批次', dataIndex: 'name', render: (_: unknown, row) => <Link to={`/leagues/${leagueId}/auctions/${row.id}`}><strong>{row.name}</strong><small className="auction-table-subline">{row.groupDisplayName}</small></Link> },
      { title: '状态', dataIndex: 'status', render: (status: string) => <Tag color={status === 'ACTIVE' ? 'processing' : status === 'RECOVERY_REQUIRED' ? 'error' : status === 'COMPLETED' ? 'success' : 'default'}>{statusLabel[status] ?? status}</Tag> },
      { title: '出价渠道', dataIndex: 'bidChannel', render: (channel: string) => channel === 'MINIPROGRAM' ? '小程序大厅' : '微信群' },
      { title: '球员', dataIndex: 'lotCount', render: (count: number) => `${count} 位` },
      { title: '更新时间', dataIndex: 'updatedAt', render: (value: string) => formatDateTime(value) },
      { title: '操作', render: (_: unknown, row) => row.status === 'DRAFT' ? <Link to={`/leagues/${leagueId}/auctions/${row.id}/edit`}>继续配置</Link> : <Link to={`/leagues/${leagueId}/auctions/${row.id}`}>查看拍卖台</Link> }
    ]} /></Card> : null}
  </div>;
}

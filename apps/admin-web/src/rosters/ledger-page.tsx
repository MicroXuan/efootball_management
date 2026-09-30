import { Alert, Card, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FinanceLedgerListResponseSchema, type FinanceLedgerListResponse } from '@efm/contracts';
import { adminApi, type AdminApi } from '../lib/api';

export function LedgerPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams(); const [data, setData] = useState<FinanceLedgerListResponse>({ items: [], nextCursor: null }); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api.request(`/v1/admin/roster/leagues/${leagueId}/ledger`, { schema: FinanceLedgerListResponseSchema }).then(setData).catch(() => setError('财务流水加载失败')); }, [api, leagueId]);
  return <Card title="财务流水与阵容交易历史">{error ? <Alert role="alert" type="warning" title={error} /> : null}<Alert type="info" showIcon title="流水记录写入后不可修改或删除" /><Typography.Paragraph type="secondary">这里仅提供审计查询，不提供编辑或删除入口。</Typography.Paragraph><Table pagination={false} rowKey="id" dataSource={data.items} columns={[{ title: '时间', dataIndex: 'createdAt' }, { title: '球队', dataIndex: 'teamName' }, { title: '方向', render: (_, row) => <Tag color={row.direction === 'CREDIT' ? 'green' : 'gold'}>{row.direction === 'CREDIT' ? '收入' : '支出'}</Tag> }, { title: '类型', dataIndex: 'type' }, { title: '金额', dataIndex: 'amountMinor' }, { title: '说明', dataIndex: 'note' }]} /></Card>;
}

import { Alert, Button, Card, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AdminTransferProposalListSchema, AdminTransferProposalSchema } from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';
import { formatDateTime } from '../lib/date-time';
import { useMutationKey } from '../lib/mutation-key';

type Proposal = z.infer<typeof AdminTransferProposalSchema>;

export function TransferProposalsPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [items, setItems] = useState<Proposal[]>([]);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useMutationKey();
  const load = useCallback(async () => {
    try { const result = await api.request(`/v1/admin/leagues/${leagueId}/transfer-proposals`, { schema: AdminTransferProposalListSchema }); setItems(result.items); }
    catch { setError('转会申请加载失败'); }
  }, [api, leagueId]);
  useEffect(() => { void load(); }, [load]);
  const review = async () => {
    if (!selected || !reason.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/transfer-proposals/${selected.id}/review`, {
        method: 'POST', headers: { 'Idempotency-Key': key.current() },
        body: { decision, reason: reason.trim(), expectedVersion: selected.version }, schema: AdminTransferProposalSchema
      });
      key.reset(); setSelected(null); setReason(''); await load();
    } catch { setError('审核失败：请检查转会期、球员归属、目标队人数和工资帽，然后刷新重试'); await load(); }
    finally { setBusy(false); }
  };
  return <div className="workspace-grid"><Card title="协商转会审核" extra={<Tag color="blue">双方确认后由管理员终审</Tag>}>
    {error ? <Alert type="error" role="alert" showIcon title={error} /> : null}
    <Typography.Paragraph type="secondary">报价、双方球队在确认后锁定。批准时系统会重新检查转会窗口、球员归属、人数与目标球队工资帽，失败不会产生交易或财务记录。</Typography.Paragraph>
    <Table rowKey="id" dataSource={items} pagination={{ pageSize: 10 }} columns={[
      { title: '球员', dataIndex: 'playerName' },
      { title: '转出', render: (_, item) => `${item.sourceTeamNumber ?? '—'}号 · ${item.sourceTeamName}` },
      { title: '转入', render: (_, item) => `${item.targetTeamNumber ?? '—'}号 · ${item.targetTeamName}` },
      { title: '报价', dataIndex: 'amountMinor' },
      { title: '对方确认', render: (_, item) => item.counterpartyConfirmed ? '已确认' : '待确认' },
      { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'PENDING_ADMIN' ? 'gold' : value === 'APPROVED' ? 'green' : 'default'}>{({ PENDING_COUNTERPARTY: '待对方确认', PENDING_ADMIN: '待管理员审核', APPROVED: '已批准', REJECTED: '已驳回', WITHDRAWN: '已撤回', EXPIRED: '已过期', INVALIDATED: '已失效' } as Record<string, string>)[value] ?? value}</Tag> },
      { title: '操作', render: (_, item) => <Button onClick={() => { setSelected(item); setDecision('APPROVE'); setReason(''); key.reset(); }}>查看{item.status === 'PENDING_ADMIN' ? '并审核' : ''}</Button> }
    ]} />
  </Card><Modal title="转会终审" open={!!selected} onCancel={() => setSelected(null)} onOk={() => void review()} okText="确认审核" okButtonProps={{ disabled: !selected || selected.status !== 'PENDING_ADMIN' || !reason.trim(), loading: busy }}>
    {selected ? <Space orientation="vertical" style={{ width: '100%' }}>
      <Typography.Text strong>{selected.playerName}</Typography.Text>
      <Typography.Text>{selected.sourceTeamNumber ?? '—'}号 {selected.sourceTeamName} → {selected.targetTeamNumber ?? '—'}号 {selected.targetTeamName}</Typography.Text>
      <Typography.Text>约定报价：{selected.amountMinor}</Typography.Text>
      <Typography.Text>对方确认：{selected.counterpartyConfirmed ? '已确认' : '未确认'}</Typography.Text>
      {selected.events.map((event) => <Typography.Text key={event.id} type="secondary">{formatDateTime(event.createdAt)} · {event.toStatus} · {event.reason ?? '无'}</Typography.Text>)}
      {selected.status === 'PENDING_ADMIN' ? <><Space><Button type={decision === 'APPROVE' ? 'primary' : 'default'} onClick={() => setDecision('APPROVE')}>批准转会</Button><Button danger type={decision === 'REJECT' ? 'primary' : 'default'} onClick={() => setDecision('REJECT')}>驳回</Button></Space><Input.TextArea aria-label="审核理由" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={512} placeholder="填写审核理由（必填）" /></> : <Typography.Text>审核说明：{selected.reviewReason ?? '无'}</Typography.Text>}
    </Space> : null}
  </Modal></div>;
}

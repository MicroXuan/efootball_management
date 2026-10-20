import { Alert, Button, Card, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AdminDisappearanceRequestListSchema, AdminDisappearanceRequestSchema, type ReviewDisappearanceRequest } from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';
import { formatDateTime } from '../lib/date-time';
import { useMutationKey } from '../lib/mutation-key';

type Request = z.infer<typeof AdminDisappearanceRequestSchema>;

export function DisappearanceReviewPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [items, setItems] = useState<Request[]>([]);
  const [selected, setSelected] = useState<Request | null>(null);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useMutationKey();
  const load = useCallback(async () => {
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/disappearance-requests`, { schema: AdminDisappearanceRequestListSchema });
      setItems(result.items);
    } catch { setError('消失申请加载失败'); }
  }, [api, leagueId]);
  useEffect(() => { void load(); }, [load]);

  const review = async () => {
    if (!selected || !reason.trim()) return;
    setBusy(true); setError(null);
    const body: ReviewDisappearanceRequest = { decision, reason: reason.trim(), expectedVersion: selected.version };
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/disappearance-requests/${selected.id}/review`, {
        method: 'POST', headers: { 'Idempotency-Key': key.current() }, body, schema: AdminDisappearanceRequestSchema
      });
      key.reset(); setSelected(null); setReason(''); await load();
    } catch { setError('审核失败：申请或球员状态可能已变化，请刷新列表后重试'); await load(); }
    finally { setBusy(false); }
  };

  return <div className="workspace-grid"><Card title="球员消失申请" extra={<Tag color="blue">管理员审核后生效</Tag>}>
    {error ? <Alert type="error" role="alert" showIcon title={error} /> : null}
    <Typography.Paragraph type="secondary">申请阶段不会移出阵容。批准后球员进入已消失，驳回则保持原状。</Typography.Paragraph>
    <Table rowKey="id" dataSource={items} pagination={{ pageSize: 10 }} columns={[
      { title: '球员', dataIndex: 'playerName' },
      { title: '球队', render: (_, item) => `${item.requesterTeamNumber ?? '—'}号 · ${item.requesterTeamName}` },
      { title: '申请理由', dataIndex: 'reason' },
      { title: '提交时间', dataIndex: 'createdAt', render: (value: string) => formatDateTime(value) },
      { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'PENDING' ? 'gold' : value === 'APPROVED' ? 'green' : 'default'}>{({ PENDING: '待审核', APPROVED: '已批准', REJECTED: '已驳回', WITHDRAWN: '已撤回', INVALIDATED: '已失效' } as Record<string, string>)[value] ?? value}</Tag> },
      { title: '操作', render: (_, item) => <Space><Button onClick={() => { setSelected(item); setDecision('APPROVE'); setReason(''); key.reset(); }}>查看{item.status === 'PENDING' ? '并审核' : ''}</Button></Space> }
    ]} />
  </Card><Modal title="消失申请审核" open={!!selected} onCancel={() => setSelected(null)} onOk={() => void review()} okText="确认审核" okButtonProps={{ disabled: !selected || selected.status !== 'PENDING' || !reason.trim(), loading: busy }}>
    {selected ? <Space orientation="vertical" style={{ width: '100%' }}>
      <Typography.Text strong>{selected.playerName} · {selected.requesterTeamNumber ?? '—'}号 {selected.requesterTeamName}</Typography.Text>
      <Typography.Paragraph>申请理由：{selected.reason}</Typography.Paragraph>
      {selected.events.map((event) => <Typography.Text key={event.id} type="secondary">{formatDateTime(event.createdAt)} · {event.toStatus} · {event.reason ?? '无'}</Typography.Text>)}
      {selected.status === 'PENDING' ? <><Space><Button type={decision === 'APPROVE' ? 'primary' : 'default'} onClick={() => setDecision('APPROVE')}>批准移入已消失</Button><Button danger type={decision === 'REJECT' ? 'primary' : 'default'} onClick={() => setDecision('REJECT')}>驳回</Button></Space><Input.TextArea aria-label="审核理由" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={512} placeholder="填写审核理由（必填）" /></> : <Typography.Text>审核说明：{selected.reviewReason ?? '无'}</Typography.Text>}
    </Space> : null}
  </Modal></div>;
}

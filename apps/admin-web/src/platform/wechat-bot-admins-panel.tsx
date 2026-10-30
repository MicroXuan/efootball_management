import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Spin } from 'antd';
import { WechatAdminContactsResponseSchema } from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';
import { formatDateTime } from '../lib/date-time';
type Data = z.infer<typeof WechatAdminContactsResponseSchema>;
export function WechatBotAdminsPanel({ deviceId, api = adminApi }: { deviceId: string; api?: AdminApi }) {
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Data['items'][number] | null>(null);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const base = `/v1/admin/wechat-bot/devices/${deviceId}/private-admins`;
  const load = () => api.request(base, { schema: WechatAdminContactsResponseSchema }).then(setData).catch(() => setError('管理员绑定读取失败，请重试。'));
  useEffect(() => { let active = true; void api.request(base, { schema: WechatAdminContactsResponseSchema }).then((v) => { if (active) setData(v); }).catch(() => { if (active) setError('管理员绑定读取失败，请重试。'); }); return () => { active = false; }; }, [api, base]);
  const save = async () => {
    if (!selected || saving) return;
    setSaving(true); setError('');
    try {
      await api.request(`${base}/${selected.id}`, { method: 'PUT', schema: z.object({ saved: z.boolean() }),
        body: { adminId, expectedVersion: selected.version, reason, idempotencyKey: key } });
      setSelected(null); await load();
    } catch { setError('保存未完成，可能是绑定已变更或管理员已有其他关联。请刷新并重新核对。'); }
    finally { setSaving(false); }
  };
  return <Space orientation="vertical" style={{ width: '100%' }}>
    <p>仅平台管理员可维护。请让管理员微信先私聊机器人发送“帮助”，再核对微信标识并关联后台管理员账号。普通用户关联不会赋予管理员权限。</p>
    <Button onClick={() => void load()}>刷新管理员候选</Button>
    {error ? <Alert type="error" role="alert" title={error} /> : null}
    {!data ? <Spin /> : !data.enabled ? <Alert type="info" title="管理员私聊录分尚未启用，请先完成数据库迁移并由部署人员开启功能。" /> : <>
      {!data.items.length ? <Empty description="尚无主动私聊的管理员候选，请先私聊机器人发送“帮助”。" /> : data.items.map((item) => <Card key={item.id} size="small">
        <p>最近观测称呼：{item.observedName ?? '暂无称呼'}{item.observedNameAt ? `（${formatDateTime(item.observedNameAt)}）` : ''}</p>
        <p style={{ overflowWrap: 'anywhere' }}>微信标识：{item.wechatContactId}</p>
        <p>当前管理员：{item.adminName ?? '未关联'}</p>
        <Button onClick={() => { setSelected(item); setAdminId(item.adminId); setReason(''); setKey(crypto.randomUUID()); }}>管理关联</Button>
      </Card>)}
      <p>显示全部已关联管理员及最近 100 位未关联候选。权限以后台账号实时授权为准。</p>
    </>}
    <Modal title="核对管理员微信关联" open={!!selected} onCancel={() => { if (!saving) setSelected(null); }} onOk={() => void save()} confirmLoading={saving} okText={adminId ? '确认关联管理员' : '确认解除关联'} cancelText="取消">
      <p>最近观测称呼：{selected?.observedName ?? '暂无称呼'}{selected?.observedNameAt ? `（${formatDateTime(selected.observedNameAt)}）` : ''}</p>
      <p style={{ overflowWrap: 'anywhere' }}>{selected?.wechatContactId}</p>
      <Alert type="warning" title="关联后可私聊操作该管理员有权管理的联赛。换绑或解绑会取消尚未确认的录分操作。" />
      <label htmlFor="private-admin-account" style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>后台管理员账号</label>
      <Select id="private-admin-account" style={{ width: '100%' }} allowClear showSearch optionFilterProp="label" placeholder="选择管理员；清空表示解除关联" value={adminId ?? undefined} disabled={saving}
        options={data?.admins.map((a) => ({ value: a.id, label: `${a.displayName}（${a.username}）` }))} onChange={(v) => { setAdminId(v ?? null); setKey(crypto.randomUUID()); }} />
      <label htmlFor="private-admin-reason" style={{ display: 'block', marginTop: 16, marginBottom: 8 }}>备注（选填）</label>
      <Input.TextArea id="private-admin-reason" value={reason} disabled={saving} maxLength={512} autoSize={{ minRows: 2, maxRows: 4 }} onChange={(e) => { setReason(e.target.value); setKey(crypto.randomUUID()); }} />
    </Modal>
  </Space>;
}

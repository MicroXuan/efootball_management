import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Spin, Tag } from 'antd';
import { AdminWechatMembersResponseSchema, AdminWechatIdentityMutationResultSchema, AdminWechatObservedGroupListSchema, WechatIdentityUserResultSchema, type AdminWechatMember, type WechatIdentityUser } from '@efm/contracts';
import { adminApi, ApiError, type AdminApi } from '../lib/api';
import { formatDateTime } from '../lib/date-time';

const errors: Record<string, string> = {
  VERSION_CONFLICT: '关联已被其他管理员修改，已刷新列表，请重新核对。',
  USER_ALREADY_BOUND: '该用户已有其他微信关联，请核对原关联，不能直接覆盖。',
  WECHAT_IDENTITY_HAS_HISTORY: '原关联已有拍卖记录，不能直接换绑。请由平台管理员核实历史记录后处理。',
  WECHAT_USER_UNAVAILABLE: '用户不存在或已停用，请重新查找。',
  WECHAT_DEVICE_DISABLED: '机器人设备已停用，暂时无法修改关联。',
  WECHAT_GROUP_DISABLED: '成员所在群已停用，请检查群配置。',
};

export function WechatBotMembersPanel({ deviceId, deviceName, leagueId, api = adminApi }: { deviceId?: string; deviceName?: string; leagueId?: string; api?: AdminApi }) {
  const readOnly = !deviceId;
  const base = deviceId ? `/v1/admin/wechat-bot/devices/${deviceId}` : `/v1/admin/leagues/${leagueId}/wechat-bot`;
  const baseRef = useRef(base);
  baseRef.current = base;
  const [items, setItems] = useState<AdminWechatMember[]>([]);
  const [groups, setGroups] = useState<{ label: string; value: string }[]>([]);
  const [group, setGroup] = useState<string>();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<AdminWechatMember | null>(null);
  const [remove, setRemove] = useState(false);
  const [number, setNumber] = useState('');
  const [candidate, setCandidate] = useState<WechatIdentityUser | null>(null);
  const [reason, setReason] = useState('');
  const [modalError, setModalError] = useState('');
  const [finding, setFinding] = useState(false);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const lookupGeneration = useRef(0);
  const active = useRef(true);
  const busy = useRef(false);
  const operationKey = useRef('');
  const cursor = cursors.at(-1);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError('');
    const query = new URLSearchParams({ limit: '30', ...(group ? { wechatGroupId: group } : {}), ...(cursor ? { cursor } : {}) });
    try {
      const result = await api.request(`${base}/members?${query}`, { schema: AdminWechatMembersResponseSchema });
      if (request !== generation.current || !active.current) return;
      setItems(result.items ?? []); setNextCursor(result.nextCursor ?? null);
    } catch { if (request === generation.current && active.current) setError('成员列表读取失败，请重试。'); }
    finally { if (request === generation.current && active.current) setLoading(false); }
  }, [api, base, group, cursor]);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; generation.current++; lookupGeneration.current++; };
  }, []);
  useEffect(() => { setSelected(null); setCandidate(null); setGroup(undefined); setCursors([undefined]); lookupGeneration.current++; }, [base]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    let cancelled = false;
    setGroups([]);
    if (deviceId) void api.request(`${base}/observed-groups`, { schema: AdminWechatObservedGroupListSchema })
      .then((result) => { if (!cancelled) setGroups(result.items.map((g) => ({ label: g.displayName, value: g.wechatGroupId }))); }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, base, deviceId]);

  const open = (member: AdminWechatMember, unbind = false) => {
    lookupGeneration.current++; setFinding(false); setSelected(member); setRemove(unbind); setNumber(''); setCandidate(null);
    setReason(''); setModalError(''); operationKey.current = crypto.randomUUID();
  };
  const lookup = async () => {
    const request = ++lookupGeneration.current;
    setFinding(true); setCandidate(null); setModalError('');
    try {
      const result = await api.request(`${base}/user-candidates?publicUserNo=${encodeURIComponent(number)}`, { schema: WechatIdentityUserResultSchema });
      if (request !== lookupGeneration.current || !active.current) return;
      setCandidate(result.user);
      if (!result.user) setModalError('没有找到可关联的有效用户，请检查六位用户编号。');
    } catch { if (request === lookupGeneration.current && active.current) setModalError('用户查找失败，请重试。'); }
    finally { if (request === lookupGeneration.current && active.current) setFinding(false); }
  };
  const save = async () => {
    if (!selected || busy.current || (!remove && !candidate)) return;
    busy.current = true; setSaving(true); setModalError('');
    const currentBase = base;
    try {
      await api.request(`${base}/identity-bindings`, { method: 'PUT', schema: AdminWechatIdentityMutationResultSchema, body: {
        observedMemberId: selected.id, userId: remove ? null : candidate!.id,
        expectedBindingId: selected.binding?.id ?? null, expectedVersion: selected.binding?.version ?? null,
        reason: reason.trim(), idempotencyKey: operationKey.current,
      } });
      if (!active.current || baseRef.current !== currentBase) return;
      setSelected(null); setNotice('关联已更新，成员下一次查询或报价将使用新状态。');
      await load();
    } catch (caught) {
      if (!active.current || baseRef.current !== currentBase) return;
      const message = caught instanceof ApiError ? errors[caught.code] : undefined;
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        setSelected(null); await load(); setError(message!);
      } else setModalError(message ?? '保存未确认，请重试；重复提交不会重复执行。');
    } finally { busy.current = false; if (active.current) setSaving(false); }
  };

  return <Card title="群成员与用户关联">
    <p>这里显示机器人已观察到的群成员，并非完整群成员名单。昵称只辅助辨认，关联以微信标识为准。</p>
    {readOnly ? <p>由平台管理员维护身份关联；成员无需验证码或私聊机器人。</p> : <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="筛选微信群" placeholder="全部已启用群" allowClear style={{ minWidth: 220 }} options={groups} value={group} onChange={(value) => { setGroup(value); setCursors([undefined]); }} />
    </Space>}
    <Button onClick={() => void load()} disabled={loading}>刷新成员</Button>
    {error ? <Alert role="alert" type="error" title={error} /> : null}
    {notice ? <Alert role="status" type="success" title={notice} /> : null}
    {loading ? <Spin aria-label="读取成员" /> : items.length === 0 ? <Empty description="尚未观察到成员。请确认设备在线、群已启用，成员正常发言后会出现在这里。" /> : <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
      {items.map((member) => <Card key={member.id} size="small">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0, flex: '1 1 240px', overflowWrap: 'anywhere' }}>
            <strong>{member.displayName ?? '昵称暂不可用'}</strong> <Tag>{member.groupName}</Tag>
            <div><code>{member.wechatContactId}</code></div>
            <div>最近观察：{formatDateTime(member.lastObservedAt)}</div>
            <div>{member.binding?.status === 'ACTIVE' ? `已关联：${member.binding.publicUserNo ?? '无公开编号'} · ${member.binding.userName}` : member.binding ? `已解绑：${member.binding.userName}` : '尚未关联用户'}</div>
          </div>
          {!readOnly ? <Space wrap><Button onClick={() => open(member)}>{member.binding?.status === 'ACTIVE' ? '换绑用户' : '关联用户'}</Button>
            {member.binding?.status === 'ACTIVE' ? <Button danger onClick={() => open(member, true)}>解除关联</Button> : null}</Space> : null}
        </div>
      </Card>)}
    </div>}
    <Space style={{ marginTop: 16 }}><Button disabled={loading || cursors.length === 1} onClick={() => setCursors((v) => v.slice(0, -1))}>上一页</Button><span>第 {cursors.length} 页</span><Button disabled={loading || !nextCursor} onClick={() => setCursors((v) => [...v, nextCursor!])}>下一页</Button></Space>
    <Modal title={remove ? '核对并解除关联' : '核对微信成员与用户'} open={selected !== null} okText={remove ? '确认解除' : '确认关联'} cancelText="取消" confirmLoading={saving}
      okButtonProps={{ disabled: (!remove && !candidate) || finding }} onOk={() => void save()} onCancel={() => { if (!busy.current) { setSelected(null); lookupGeneration.current++; } }}>
      <p>机器人：{deviceName ?? deviceId}；群：{selected?.groupName}</p>
      <p style={{ overflowWrap: 'anywhere' }}>微信成员：{selected?.displayName ?? '昵称暂不可用'} · {selected?.wechatContactId}</p>
      <p>原关联：{selected?.binding ? `${selected.binding.publicUserNo ?? '无编号'} · ${selected.binding.userName}` : '无'}</p>
      <Alert type="warning" title="关联对该机器人服务的所有群生效，请确认微信成员与用户为同一人。" />
      {!remove ? <>
        <label style={{ display: 'block', marginTop: 16, marginBottom: 8 }} htmlFor="wechat-member-user-no">用户编号</label>
        <Space.Compact style={{ width: '100%' }}><Input disabled={saving} id="wechat-member-user-no" value={number} maxLength={6} inputMode="numeric" placeholder="六位用户编号，例如 001234" onChange={(e) => { setNumber(e.target.value); setCandidate(null); setFinding(false); lookupGeneration.current++; operationKey.current = crypto.randomUUID(); }} /><Button disabled={!/^\d{6}$/.test(number) || finding} loading={finding} onClick={() => void lookup()}>查找用户</Button></Space.Compact>
        {candidate ? <p>新关联：{candidate.publicUserNo} · {candidate.displayName}<br />{candidate.teams.map((t) => `${t.leagueName} / ${t.name}`).join('；') || '当前没有现役球队；关联不会授予球队权限'}</p> : null}
      </> : null}
      <label style={{ display: 'block', marginTop: 16, marginBottom: 8 }} htmlFor="wechat-member-reason">核实说明（选填）</label>
      <Input.TextArea disabled={saving} id="wechat-member-reason" value={reason} maxLength={512} autoSize={{ minRows: 3, maxRows: 6 }} placeholder={remove ? '可补充解除关联的原因，留空也可提交' : '可补充身份核实情况，留空也可提交'} onChange={(e) => { setReason(e.target.value); operationKey.current = crypto.randomUUID(); }} />
      {modalError ? <Alert role="alert" type="error" title={modalError} /> : null}
    </Modal>
  </Card>;
}

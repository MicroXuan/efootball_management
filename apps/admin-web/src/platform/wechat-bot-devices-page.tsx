import {
  AdminWechatBotDeviceListSchema,
  UpdateWechatBotDeviceStatusRequestSchema,
  WechatBotDeviceCredentialResponseSchema,
  type AdminWechatBotDevice,
} from '@efm/contracts';
import { Alert, Button, Card, Input, Modal, Space, Spin, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminApi } from '../lib/api';

const loginLabels = {
  LOGGED_IN: { text: '在线', color: 'success' },
  LOGGED_OUT: { text: '离线', color: 'error' },
  UNKNOWN: { text: '状态未知', color: 'default' },
} as const;

function formatTime(value: string | null) {
  if (!value) return '尚未收到';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value));
}

export function WechatBotDevicesPage({ api = adminApi }: { api?: AdminApi }) {
  const [devices, setDevices] = useState<AdminWechatBotDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [credential, setCredential] = useState<{ deviceName: string; token: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await api.request('/v1/admin/wechat-bot/devices', {
        schema: AdminWechatBotDeviceListSchema,
      });
      setDevices(response.items);
    } catch {
      setDevices([]);
      setError('设备状态加载失败，请稍后重试');
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const createDevice = async () => {
    const trimmed = name.trim();
    if (!trimmed || busyId) return;
    setBusyId('create');
    setError(null);
    try {
      const response = await api.request('/v1/admin/wechat-bot/devices', {
        method: 'POST',
        schema: WechatBotDeviceCredentialResponseSchema,
        body: { name: trimmed },
      });
      setDevices((current) => [response.device, ...(current ?? [])]);
      setCreateOpen(false);
      setName('');
      setCredential({ deviceName: response.device.name, token: response.token });
    } catch {
      setError('设备创建失败，请稍后重试');
    } finally {
      setBusyId(null);
    }
  };

  const rotateToken = async (device: AdminWechatBotDevice) => {
    if (busyId) return;
    setBusyId(device.id);
    setError(null);
    try {
      const response = await api.request(`/v1/admin/wechat-bot/devices/${device.id}/token/rotate`, {
        method: 'POST',
        schema: WechatBotDeviceCredentialResponseSchema,
      });
      setDevices((current) => current?.map((item) => item.id === device.id ? response.device : item) ?? []);
      setCredential({ deviceName: response.device.name, token: response.token });
    } catch {
      setError('令牌轮换失败，原令牌仍可继续使用');
    } finally {
      setBusyId(null);
    }
  };

  const updateStatus = async (device: AdminWechatBotDevice) => {
    if (busyId) return;
    const status = device.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setBusyId(device.id);
    setError(null);
    try {
      const next = await api.request(`/v1/admin/wechat-bot/devices/${device.id}/status`, {
        method: 'PATCH',
        schema: AdminWechatBotDeviceListSchema.shape.items.element,
        body: UpdateWechatBotDeviceStatusRequestSchema.parse({
          status,
          ...(status === 'DISABLED' ? { reason: '平台管理员手动停用' } : {}),
        }),
      });
      setDevices((current) => current?.map((item) => item.id === device.id ? next : item) ?? []);
      setNotice(status === 'ACTIVE' ? '设备已启用' : '设备已停用');
    } catch {
      setError('设备状态更新失败，请稍后重试');
    } finally {
      setBusyId(null);
    }
  };

  const resetCircuit = async (device: AdminWechatBotDevice) => {
    if (busyId) return;
    setBusyId(device.id);
    setError(null);
    try {
      const next = await api.request(`/v1/admin/wechat-bot/devices/${device.id}/circuit/reset`, {
        method: 'POST',
        schema: AdminWechatBotDeviceListSchema.shape.items.element,
      });
      setDevices((current) => current?.map((item) => item.id === device.id ? next : item) ?? []);
      setNotice('熔断已复位，设备可恢复发送');
    } catch {
      setError('熔断复位失败，请先检查 Windows 端登录状态');
    } finally {
      setBusyId(null);
    }
  };

  return <div className="page-stack wechat-device-page">
    <header className="workspace-page-title wechat-page-heading">
      <div>
        <span className="section-kicker">平台管理 · WINDOWS 桥接</span>
        <h1>微信机器人设备</h1>
        <p>管理长期在线的 Windows 机器人电脑。令牌只在创建或轮换时展示一次。</p>
      </div>
      <Button type="primary" onClick={() => setCreateOpen(true)}>创建设备</Button>
    </header>
    {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
    {notice ? <Alert role="status" type="success" showIcon title={notice} closable onClose={() => setNotice(null)} /> : null}
    {devices === null ? <div className="loading-block"><Spin /><span>正在读取设备状态…</span></div> : null}
    {devices?.length === 0 && !error ? <Card className="wechat-empty-card">
      <span className="wechat-empty-card__index">BOT / 00</span>
      <h2>还没有机器人设备</h2>
      <p>先创建一个设备，然后只在准备好的 Windows 电脑上保存一次性令牌并启动桥接程序。</p>
      <Button type="primary" onClick={() => setCreateOpen(true)}>创建第一台设备</Button>
    </Card> : null}
    {devices?.length ? <div className="wechat-device-grid">{devices.map((device, index) => {
      const login = loginLabels[device.loginStatus];
      const healthy = device.status === 'ACTIVE' && device.loginStatus === 'LOGGED_IN' && device.circuitStatus === 'CLOSED';
      return <Card key={device.id} className={`wechat-device-card${healthy ? ' is-healthy' : ''}`}>
        <div className="wechat-device-card__top">
          <span>BOT / {String(index + 1).padStart(2, '0')}</span>
          <Space size={6} wrap>
            {device.status === 'DISABLED' ? <Tag>已停用</Tag> : null}
            <Tag color={login.color}>{login.text}</Tag>
            {device.circuitStatus === 'OPEN' ? <Tag color="error">熔断已开启</Tag> : <Tag color="success">发送正常</Tag>}
          </Space>
        </div>
        <h2>{device.name}</h2>
        <div className={`wechat-device-signal${healthy ? ' is-active' : ''}${device.circuitStatus === 'OPEN' ? ' is-open' : ''}`} aria-label={healthy ? '设备信号正常' : '设备信号异常'}>
          {Array.from({ length: 12 }, (_, signalIndex) => <i key={signalIndex} />)}
        </div>
        <dl className="wechat-device-metrics">
          <div><dt>最后心跳</dt><dd>{formatTime(device.lastHeartbeatAt)}</dd></div>
          <div><dt>微信版本</dt><dd>{device.wechatVersion ?? '未上报'}</dd></div>
          <div><dt>发送队列</dt><dd>{device.outboundQueueDepth} 条</dd></div>
          <div><dt>熔断原因</dt><dd>{device.circuitReason ?? '无'}</dd></div>
        </dl>
        <div className="wechat-device-card__actions">
          <Button loading={busyId === device.id} onClick={() => void rotateToken(device)}>轮换令牌</Button>
          {device.circuitStatus === 'OPEN' ? <Button loading={busyId === device.id} onClick={() => void resetCircuit(device)}>复位熔断</Button> : null}
          <Button danger={device.status === 'ACTIVE'} loading={busyId === device.id} onClick={() => void updateStatus(device)}>
            {device.status === 'ACTIVE' ? '停用设备' : '启用设备'}
          </Button>
        </div>
      </Card>;
    })}</div> : null}
    <Modal
      title="创建机器人设备"
      open={createOpen}
      okText="确认创建"
      cancelText="取消"
      confirmLoading={busyId === 'create'}
      okButtonProps={{ disabled: !name.trim() }}
      onOk={() => void createDevice()}
      onCancel={() => { if (!busyId) { setCreateOpen(false); setName(''); } }}
    >
      <label className="wechat-field-label" htmlFor="wechat-device-name">设备名称</label>
      <Input id="wechat-device-name" value={name} maxLength={128} placeholder="例如：联赛机器人 A" onChange={(event) => setName(event.target.value)} />
      <p className="wechat-modal-note">创建后请立即将令牌配置到对应的 Windows 桥接程序。</p>
    </Modal>
    <Modal
      title="保存设备令牌"
      open={credential !== null}
      footer={<Button type="primary" onClick={() => setCredential(null)}>我已安全保存</Button>}
      closable={false}
      mask={{ closable: false }}
    >
      <Alert type="warning" showIcon title="关闭后无法再次查看" description="请仅保存在对应 Windows 电脑的环境变量中，不要发送到微信群。" />
      <div className="wechat-credential" aria-label={`${credential?.deviceName ?? ''} 的设备令牌`}><code>{credential?.token}</code></div>
    </Modal>
  </div>;
}

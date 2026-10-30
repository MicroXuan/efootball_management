import type { AdminWechatBotDevice } from '@efm/contracts';

export function deviceHealth(device: AdminWechatBotDevice, now = Date.now()) {
  if (device.status === 'DISABLED') return { text: '已停用', healthy: false };
  const heartbeat = device.lastHeartbeatAt ? Date.parse(device.lastHeartbeatAt) : 0;
  if (!heartbeat || now - heartbeat > 60_000) return { text: '心跳超时', healthy: false };
  if (device.screenLocked) return { text: 'Windows 已锁屏', healthy: false };
  if (device.loginStatus !== 'LOGGED_IN') return { text: '微信状态异常', healthy: false };
  const receiver = device.receiverHealth;
  if (!receiver) return { text: '接收状态未上报', healthy: false };
  if (receiver.status === 'RECOVERING') return { text: '接收异常，自动恢复中', healthy: false };
  if (receiver.status === 'STARTING') return { text: '接收检查中', healthy: false };
  if (!receiver.lastSuccessAt || now - Date.parse(receiver.lastSuccessAt) > 60_000) return { text: '接收检查超时', healthy: false };
  if (device.circuitStatus === 'OPEN') return { text: '发送已熔断', healthy: false };
  return { text: '接收正常', healthy: true };
}

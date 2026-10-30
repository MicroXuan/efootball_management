import { deviceHealth } from './wechat-device-health';
import type { AdminWechatBotDevice } from '@efm/contracts';
const now = Date.now();
const fresh = new Date(now).toISOString();
const device = { status: 'ACTIVE', loginStatus: 'LOGGED_IN', circuitStatus: 'CLOSED', lastHeartbeatAt: fresh,
  receiverHealth: { status: 'HEALTHY', errorCode: null, lastSuccessAt: fresh } } as AdminWechatBotDevice;
it('does not equate process heartbeat with receiver health', () => {
  expect(deviceHealth(device, now).healthy).toBe(true);
  expect(deviceHealth({ ...device, receiverHealth: null }, now).healthy).toBe(false);
  expect(deviceHealth({ ...device, receiverHealth: { status: 'RECOVERING', errorCode: 'WECHAT_DATABASE_UNAVAILABLE', lastSuccessAt: fresh } }, now).healthy).toBe(false);
  expect(deviceHealth(device, now + 61_000).text).toBe('心跳超时');
  expect(deviceHealth({ ...device, receiverHealth: { ...device.receiverHealth!, lastSuccessAt: new Date(now - 61_000).toISOString() } }, now).text).toBe('接收检查超时');
  expect(deviceHealth({ ...device, screenLocked: true }, now).healthy).toBe(false);
});

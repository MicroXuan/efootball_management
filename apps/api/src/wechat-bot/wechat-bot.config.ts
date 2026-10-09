export const WECHAT_BOT_CONFIG = Symbol('WECHAT_BOT_CONFIG');

export type WechatBotRuntimeConfig = {
  outboxLeaseMs: number;
  outboxMaxAttempts: number;
  heartbeatTimeoutMs: number;
  commandRetentionHours: number;
};

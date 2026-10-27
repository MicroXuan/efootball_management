export const WECHAT_BOT_CONFIG = Symbol('WECHAT_BOT_CONFIG');

export type WechatBotRuntimeConfig = {
  privateScoreEnabled?: boolean;
  outboxLeaseMs: number;
  outboxMaxAttempts: number;
  heartbeatTimeoutMs: number;
  commandRetentionHours: number;
  bindingCodePepper: string;
};

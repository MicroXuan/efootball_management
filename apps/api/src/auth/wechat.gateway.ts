export const WECHAT_GATEWAY = Symbol('WECHAT_GATEWAY');

export type WechatIdentity = {
  openId: string;
  unionId?: string;
};

export interface WechatGateway {
  exchangeCode(code: string): Promise<WechatIdentity>;
}

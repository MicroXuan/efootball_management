import type { WechatBindingStatus } from '@efm/contracts'

export function bindingView(input: { status: WechatBindingStatus; errorMessage?: string }) {
  const bound = input.status.status === 'BOUND'
  return {
    stateTitle: bound ? '已关联群机器人' : '尚未关联群机器人',
    stateCopy: input.status.status === 'BOUND'
      ? `${input.status.deviceName}：可直接在群内查询个人赛程、参与拍卖。`
      : '请联系管理员在后台关联账号。关联后直接在群里使用，无需验证码或私聊机器人。',
    showUnbind: bound,
    errorMessage: input.errorMessage ?? '',
  }
}

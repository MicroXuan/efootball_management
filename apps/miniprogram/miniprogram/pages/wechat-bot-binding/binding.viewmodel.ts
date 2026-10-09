import type { WechatBindingCodeResponse, WechatBindingStatus } from '@efm/contracts'

type BindingViewInput = {
  status: WechatBindingStatus
  issuedCode?: WechatBindingCodeResponse
  now: number
  requesting?: boolean
  errorMessage?: string
}

export type BindingView = {
  stateTitle: string
  stateCopy: string
  codeDisplay: string
  countdownCopy: string
  expiresAtCopy: string
  instruction: string
  codeExpired: boolean
  generateDisabled: boolean
  generateLabel: string
  showUnbind: boolean
  errorMessage: string
}

export function bindingView(input: BindingViewInput): BindingView {
  const requesting = input.requesting ?? false
  const remainingSeconds = input.issuedCode
    ? Math.max(0, Math.ceil((Date.parse(input.issuedCode.expiresAt) - input.now) / 1000))
    : 0
  const codeExpired = Boolean(input.issuedCode) && remainingSeconds === 0
  const activeCode = input.issuedCode && !codeExpired ? input.issuedCode : undefined
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60

  if (input.status.status === 'BOUND') {
    return {
      stateTitle: '已绑定',
      stateCopy: input.status.deviceName,
      codeDisplay: '',
      countdownCopy: '',
      expiresAtCopy: '',
      instruction: '',
      codeExpired: false,
      generateDisabled: true,
      generateLabel: '已完成绑定',
      showUnbind: true,
      errorMessage: input.errorMessage ?? '',
    }
  }

  return {
    stateTitle: codeExpired ? '验证码已过期' : activeCode ? '验证码已生成' : '尚未绑定群机器人',
    stateCopy: codeExpired
      ? '请重新生成验证码。'
      : activeCode
        ? '请在有效期内私聊机器人完成绑定。'
        : '生成验证码后，私聊机器人即可关联你的小程序账号。',
    codeDisplay: activeCode ? `${activeCode.code.slice(0, 3)} ${activeCode.code.slice(3)}` : '',
    countdownCopy: activeCode
      ? `有效期 ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : '',
    expiresAtCopy: activeCode ? `截止 ${chinaTime(activeCode.expiresAt)}` : '',
    instruction: activeCode ? `私聊机器人发送：绑定 ${activeCode.code}` : '',
    codeExpired,
    generateDisabled: requesting || Boolean(activeCode),
    generateLabel: requesting ? '正在生成…' : codeExpired ? '重新生成验证码' : '生成绑定验证码',
    showUnbind: false,
    errorMessage: input.errorMessage ?? '',
  }
}

function chinaTime(value: string): string {
  const shifted = new Date(Date.parse(value) + 8 * 60 * 60 * 1000)
  return [shifted.getUTCHours(), shifted.getUTCMinutes(), shifted.getUTCSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

import type { WechatBindingStatus } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { bindingView } from './binding.viewmodel'

const unbound: WechatBindingStatus = { status: 'UNBOUND' }
const bound: WechatBindingStatus = {
  status: 'BOUND',
  deviceName: '联赛机器人',
  boundAt: '2026-10-09T12:00:00.000Z',
}

describe('WeChat bot binding view model', () => {
  it('presents unbound and active binding states without internal contact identifiers', () => {
    expect(bindingView({ status: unbound, now: Date.parse('2026-10-09T12:00:00.000Z') })).toMatchObject({
      stateTitle: '尚未绑定群机器人',
      generateDisabled: false,
      showUnbind: false,
    })
    const active = bindingView({ status: bound, now: Date.parse('2026-10-09T12:00:00.000Z') })
    expect(active).toMatchObject({ stateTitle: '已绑定', stateCopy: '联赛机器人', showUnbind: true })
    expect(JSON.stringify(active)).not.toContain('wxid')
  })

  it('formats a generated code, countdown, and exact private-message instruction', () => {
    const view = bindingView({
      status: unbound,
      issuedCode: { code: '012345', expiresAt: '2026-10-09T12:05:00.000Z' },
      now: Date.parse('2026-10-09T12:00:01.000Z'),
    })
    expect(view).toMatchObject({
      codeDisplay: '012 345',
      countdownCopy: '有效期 04:59',
      instruction: '私聊机器人发送：绑定 012345',
      codeExpired: false,
      generateDisabled: true,
    })
  })

  it('marks expired codes reusable and keeps request errors visible', () => {
    const view = bindingView({
      status: unbound,
      issuedCode: { code: '123456', expiresAt: '2026-10-09T12:05:00.000Z' },
      now: Date.parse('2026-10-09T12:05:01.000Z'),
      errorMessage: '网络连接失败',
    })
    expect(view).toMatchObject({
      stateTitle: '验证码已过期',
      codeExpired: true,
      generateDisabled: false,
      errorMessage: '网络连接失败',
    })
  })

  it('disables code generation while a request is in flight', () => {
    expect(bindingView({ status: unbound, now: Date.now(), requesting: true })).toMatchObject({
      generateDisabled: true,
      generateLabel: '正在生成…',
    })
  })
})

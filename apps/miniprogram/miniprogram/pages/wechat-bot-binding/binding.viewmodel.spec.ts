import { describe, expect, it } from 'vitest'
import { bindingView } from './binding.viewmodel'

describe('admin managed WeChat identity status', () => {
  it('directs unbound members to the administrator without asking for private messages', () => {
    const view = bindingView({ status: { status: 'UNBOUND' } })
    expect(view.showUnbind).toBe(false)
    expect(view.stateCopy).toContain('管理员')
    expect(view.stateCopy).not.toContain('生成验证码')
  })
  it('keeps existing bindings usable and preserves visible errors', () => {
    const view = bindingView({ status: { status: 'BOUND', deviceName: '联赛机器人', boundAt: '2026-10-26T00:00:00Z' }, errorMessage: '网络异常' })
    expect(view.showUnbind).toBe(true)
    expect(view.stateCopy).toContain('联赛机器人')
    expect(view.errorMessage).toBe('网络异常')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('action center native page', () => {
  it('registers one lightweight page with grouped deep-link tasks', () => {
    const root = resolve(process.cwd(), 'miniprogram')
    const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')) as { pages: string[] }
    const template = readFileSync(resolve(root, 'pages/action-center/index.wxml'), 'utf8')

    expect(app.pages).toContain('pages/action-center/index')
    expect(template).toContain('待我处理')
    expect(template).toContain('状态更新')
    expect(template).toContain('近期记录')
    expect(template).toContain('bindtap="openTask"')
    expect(template).toContain('wx:if="{{item.unread}}"')
  })
})

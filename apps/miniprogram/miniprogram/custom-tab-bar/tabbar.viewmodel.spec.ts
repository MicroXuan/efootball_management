import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { attentionBadgeLabel, tabIndexForRoute, tabRouteForIndex } from './tabbar.viewmodel'

describe('原生底栏路由映射', () => {
  it('根据当前主页面返回稳定的选中项', () => {
    expect(tabIndexForRoute('pages/players/index')).toBe(0)
    expect(tabIndexForRoute('/pages/leagues/index')).toBe(1)
    expect(tabIndexForRoute('pages/profile/index')).toBe(2)
    expect(tabIndexForRoute('pages/competition-detail/index')).toBe(0)
  })

  it('只为有效的底栏序号返回可切换页面', () => {
    expect(tabRouteForIndex(0)).toBe('/pages/players/index')
    expect(tabRouteForIndex(1)).toBe('/pages/leagues/index')
    expect(tabRouteForIndex(2)).toBe('/pages/profile/index')
    expect(tabRouteForIndex(3)).toBeNull()
  })

  it('keeps the profile badge compact and bounded', () => {
    expect(attentionBadgeLabel(0)).toBe('')
    expect(attentionBadgeLabel(7)).toBe('7')
    expect(attentionBadgeLabel(120)).toBe('99+')
  })

  it('renders the badge only on the profile tab and refreshes it safely', () => {
    const root = resolve(process.cwd(), 'miniprogram/custom-tab-bar')
    const template = readFileSync(resolve(root, 'index.wxml'), 'utf8')
    const page = readFileSync(resolve(root, 'index.ts'), 'utf8')

    expect(template).toContain("index === 2 && attentionBadge")
    expect(template).toContain('class="attention-badge"')
    expect(page).toContain('refreshActionCenterBadge')
    expect(page).toContain('.catch(() =>')
  })
})

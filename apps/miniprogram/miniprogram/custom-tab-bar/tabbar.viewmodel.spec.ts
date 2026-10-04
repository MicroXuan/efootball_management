import { describe, expect, it } from 'vitest'
import { tabIndexForRoute, tabRouteForIndex } from './tabbar.viewmodel'

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
})

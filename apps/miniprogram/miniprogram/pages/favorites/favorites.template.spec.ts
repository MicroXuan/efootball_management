import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'miniprogram/pages/favorites')
const markup = readFileSync(resolve(root, 'index.wxml'), 'utf8')
const styles = readFileSync(resolve(root, 'index.wxss'), 'utf8')

describe('favorite group layout', () => {
  it('shows one dropdown with all groups and a separate create action', () => {
    const filterMarkup = markup.slice(markup.indexOf('class="group-controls"'), markup.indexOf('<loading-state'))
    expect(filterMarkup).toContain('data-group-id="ungrouped" bindtap="onSelectGroup"><text>未分组</text>')
    expect(filterMarkup).not.toContain('收藏分组</text>')
    expect(markup).not.toContain('class="head-title"')
    expect(markup).toMatch(/class="group-create"[^>]*bindtap="onCreateGroup"/)
    expect(markup).toContain('class="group-dropdown__trigger {{showGroupDropdown ? \'is-open\' : \'\'}}"')
    expect(markup).toContain('class="group-dropdown__value">{{activeGroupName}}')
    expect(markup).toContain('catchtap="onDeleteGroup"')
    expect(styles).toMatch(/\.group-dropdown__value\s*\{[^}]*min-width:0;[^}]*text-overflow:ellipsis/s)
    expect(styles).toMatch(/\.group-dropdown__menu\s*\{[^}]*position:absolute/s)
    expect(styles).toMatch(/\.group-controls\s*\{[^}]*display:flex;[^}]*align-items:stretch/s)
    expect(styles).toMatch(/\.group-dropdown\s*\{[^}]*flex:1;[^}]*min-width:0/s)
  })

  it('keeps the group action inside each card and uses shrink-safe views', () => {
    expect(markup).toMatch(/<view class="favorite-group" role="button"[^>]*bindtap="onOpenGroupPicker"/)
    expect(styles).toMatch(/\.favorite-group\s*\{[^}]*min-width:0;[^}]*box-sizing:border-box/s)
    expect(markup).toContain('class="group-picker__sheet"')
    const pickerMarkup = markup.slice(markup.indexOf('class="group-picker__sheet"'))
    expect(pickerMarkup).not.toContain('>未分组</view>')
    expect(pickerMarkup).toContain('wx:if="{{movingPlayerHasGroup}}" class="group-picker__item group-picker__remove" role="button" data-group-id="" bindtap="onPickGroup">移出分组')
    expect(pickerMarkup).toContain('bindtap="onPickGroup">{{item.name}}')
  })
})

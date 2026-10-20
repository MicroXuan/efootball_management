import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('player card detail template', () => {
  it('presents automatic-build overall without DT business copy', () => {
    const template = readFileSync(resolve(process.cwd(), 'miniprogram/pages/player-card-detail/index.wxml'), 'utf8')

    expect(template).toContain('方案总评')
    expect(template).not.toContain('DT 评分')
    expect(template).not.toContain('card.autoBuild.dtRating')
  })

  it('places ability labels around the radar and positions on a football pitch', () => {
    const template = readFileSync(resolve(process.cwd(), 'miniprogram/pages/player-card-detail/index.wxml'), 'utf8')

    expect(template).toContain('radar-label radar-label--{{index}}')
    expect(template).toContain('{{item.label}}')
    expect(template).not.toContain('class="radar-legend"')
    expect(template).toContain('class="position-pitch"')
    expect(template).toContain('position-cell--{{item.code}}')
    expect(template).toContain('tone-{{item.tone}}')
  })

  it('binds PESDATA ability and suitability tones without replacing the primary outline', () => {
    const template = readFileSync(resolve(process.cwd(), 'miniprogram/pages/player-card-detail/index.wxml'), 'utf8')
    const styles = readFileSync(resolve(process.cwd(), 'miniprogram/pages/player-card-detail/index.wxss'), 'utf8')

    expect(template).toContain('class="attribute-value tone-{{item.tone}}"')
    expect(template).toContain('class="attribute-fill tone-{{item.tone}}"')
    expect(template).toContain('PESDATA 色阶')
    expect(template).not.toContain('90+ 高亮')
    expect(template).toContain("tone-{{item.tone}} {{item.isPrimary ? 'is-primary' : ''}}")

    expect(styles).toContain('.attribute-value.tone-red { color: #ff0000; }')
    expect(styles).toContain('.attribute-value.tone-yellow { color: #ffe600; }')
    expect(styles).toContain('.attribute-value.tone-green { color: #22ff00; }')
    expect(styles).toContain('.attribute-value.tone-cyan { color: #00efff; }')
    expect(styles).toContain('.position-cell.tone-strong')
    expect(styles).toContain('background: #07c160;')
    expect(styles).toContain('.position-cell.tone-partial')
    expect(styles).toContain('background: rgba(7, 193, 96, .4);')
    expect(styles.match(/\.position-cell\.is-primary\s*\{([^}]*)\}/)?.[1]).not.toContain('background')
  })
})

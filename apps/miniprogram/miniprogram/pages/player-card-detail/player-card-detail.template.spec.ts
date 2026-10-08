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
})

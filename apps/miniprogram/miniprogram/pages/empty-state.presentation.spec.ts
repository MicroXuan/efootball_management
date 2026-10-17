import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readPage = (page: string) => readFileSync(resolve(process.cwd(), `miniprogram/pages/${page}/index.wxml`), 'utf8')

describe('member-page empty states', () => {
  it.each(['my-matches', 'player-auctions', 'favorites'])('%s uses the shared compact empty-state presentation', (page) => {
    expect(readPage(page)).toContain('class="state-card efm-empty-state"')
  })

  it('defines one shared visual hierarchy for empty-state copy', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'miniprogram/app.wxss'), 'utf8')

    expect(stylesheet).toContain('.efm-empty-state {')
    expect(stylesheet).toContain('.efm-empty-state__kicker')
    expect(stylesheet).toContain('.efm-empty-state__title')
    expect(stylesheet).toContain('.efm-empty-state__copy')
  })
})

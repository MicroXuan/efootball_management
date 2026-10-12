import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(process.cwd(), 'miniprogram/pages/season-standings/index.wxml'), 'utf8')

describe('season standings template', () => {
  it('renders the season title and complete team identity', () => {
    expect(markup).toContain('{{seasonTitle}}')
    expect(markup).toContain('<entity-artwork')
    expect(markup).toContain('{{item.teamIdentityLabel}}')
    expect(markup).toContain('{{item.ownerDisplayName}}')
  })

  it('renders podium medals and an aligned green fourth-place rank', () => {
    expect(markup).toContain('{{item.medalLabel}}')
    expect(markup).toContain("item.rankAccent ? 'is-accent' : ''")
    expect(markup).not.toContain('item.showRise')
    expect(markup).not.toContain('class="rise"')
  })

  it('keeps played matches and points visible in the compact standings columns', () => {
    expect(markup).toContain('<text class="played">场次</text>')
    expect(markup).toContain('<text class="record">胜/平/负</text>')
    expect(markup).toContain('<text class="goals">进/失/净</text>')
    expect(markup).toContain('{{item.played}}')
    expect(markup).toContain('{{item.wins}}/{{item.draws}}/{{item.losses}}')
    expect(markup).toContain('{{item.goalsFor}}/{{item.goalsAgainst}}/{{item.goalDifference}}')
    expect(markup).toContain('{{item.totalPoints}}')
  })
})

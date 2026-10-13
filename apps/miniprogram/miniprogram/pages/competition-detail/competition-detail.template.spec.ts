import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')

describe('competition detail template', () => {
  it('shows registered cup teams with crest, number, team name, and owner', () => {
    expect(markup).toContain('已报名球队')
    expect(markup).toContain('cupParticipants')
    expect(markup).toContain('item.teamLogoUrl')
    expect(markup).toContain('item.teamNumber')
    expect(markup).toContain('item.teamName')
    expect(markup).toContain('item.ownerDisplayName')
  })

  it('uses cup format instead of platform and region for cup details', () => {
    expect(markup).toContain("isCup ? (detail.competitionType === 'GROUP_KNOCKOUT_CUP'")
    expect(markup).not.toContain('<text class="score-label">平台 / 区服</text>')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const styles = readFileSync(resolve(__dirname, 'index.wxss'), 'utf8')

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

  it('keeps the registration action with the eligible team before the participant roster', () => {
    const action = markup.indexOf('class="registration-actions"')
    const roster = markup.indexOf('class="panel cup-participants-panel"')

    expect(action).toBeGreaterThan(-1)
    expect(action).toBeLessThan(roster)
  })

  it('uses one registration heading and keeps the cup team inside the registration action card', () => {
    expect(markup.match(/>报名信息<\/text>/g)).toHaveLength(1)
    const registrationCard = markup.match(/<view class="registration-actions">([\s\S]*?)<view wx:if="{{isCup}}" class="panel cup-participants-panel">/)?.[1]
    expect(registrationCard).toContain('使用本赛季球队报名')
    expect(registrationCard).toContain('报名状态 · 已通过')
    expect(markup).not.toContain('class="panel registered-team"')
  })

  it('centers every registration button vertically and horizontally', () => {
    expect(styles).toMatch(/\.registration-actions button\s*{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/)
  })

  it('hides points rules for cups and renders the complete bracket board', () => {
    expect(markup).toContain('wx:if="{{!isCup}}" class="panel"')
    expect(markup).toContain('bracketRounds')
    expect(markup).toContain('item.topOffset')
    expect(markup).toContain('item.pairingGap')
  })

  it('renders a stage-switching matchday board with team crests and numbered rounds', () => {
    expect(markup).toContain('bindtap="selectScheduleStage"')
    expect(markup).toContain("selectedStageId === item.stageId")
    expect(markup).toContain('activeCupSchedule.rounds')
    expect(markup).toContain('match.homeParticipant.teamLogoUrl')
    expect(markup).toContain('match.awayParticipant.teamLogoUrl')
    expect(markup).toContain('第 {{round.roundNumber}} 轮')
  })

  it('keeps all four group selectors visible in one row without horizontal scrolling', () => {
    expect(markup).not.toContain('class="schedule-stage-scroll"')
    expect(markup).toContain('class="schedule-stage-switcher"')
    expect(styles).toMatch(/\.schedule-stage-switcher\s*{[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/)
    expect(styles).toMatch(/\.schedule-stage-button\s*{[^}]*width:\s*0;[^}]*flex:\s*1\s+1\s+0;[^}]*overflow:\s*hidden;/)
  })
})

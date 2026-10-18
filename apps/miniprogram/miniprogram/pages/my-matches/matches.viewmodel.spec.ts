import type { CompetitionParticipantSummary, LeagueSeasonSummary, MyMatchResponse } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { matchCard, seasonOptions } from './matches.viewmodel'
import { resultTime } from '../match-result/result.viewmodel'

const participant = (overrides: Partial<CompetitionParticipantSummary> = {}): CompetitionParticipantSummary => ({
  id: 'participant-1', displayName: '历史上海申花', participantType: 'TEAM', teamLifecycleStatus: 'ACTIVE',
  teamNumber: 25, teamName: '上海申花', teamLogoUrl: 'https://static.example.com/shenhua.png',
  ownerDisplayName: '梅西（小宣）', ...overrides
})

const response = (finished: boolean): MyMatchResponse => ({
  match: {
    id: 'match-1', competitionId: 'competition-1', stageId: 'stage-1', stageCode: 'CHAMPION_A',
    stageDisplayName: '冠军 A 组', roundNumber: 2, matchNumber: 8,
    homeParticipant: participant(),
    awayParticipant: participant({ id: 'participant-2', displayName: '北京国安', teamNumber: 9, teamName: '北京国安', teamLogoUrl: null, ownerDisplayName: '国安经理' }),
    plannedAt: null, status: finished ? 'CONFIRMED' : 'AWAITING_RESULT', version: 1, resultConfirmationDeadlineAt: null,
    officialResult: finished ? { resultVersionId: 'result-1', version: 1, homeScore: 3, awayScore: 1, status: 'OFFICIAL' } : null,
    resultVersions: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z'
  },
  competition: {
    id: 'competition-1', seasonId: 'season-1', competitionType: 'DIVISION_LEAGUE', name: 'S20 分级联赛', description: '',
    platform: 'MOBILE', serverRegion: 'GLOBAL', participantType: 'TEAM', format: 'ROUND_ROBIN', status: 'IN_PROGRESS',
    registrationOpensAt: '2026-01-01T00:00:00.000Z', registrationClosesAt: '2026-01-02T00:00:00.000Z', startsAt: '2026-01-03T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z',
    participantLimit: 30, participantCount: 30, version: 1, activeRuleVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  },
  myParticipantId: 'participant-1', action: finished ? 'DONE' : 'SUBMIT', actionableResultVersion: null,
  confirmationDeadlineAt: null, evidenceRequired: false, disputeSummary: null, timeline: []
})

describe('read-only season fixture view model', () => {
  it('sorts season choices newest first and keeps the passed current season selected', () => {
    const season = (seasonNumber: number): LeagueSeasonSummary => ({ id: `season-${seasonNumber}`, leagueId: 'league-1', seasonNumber, displayName: `S${seasonNumber}`, previousSeasonId: null, isFirstSeason: seasonNumber === 1, registrationOpensAt: '2026-01-01T00:00:00.000Z', registrationClosesAt: '2026-01-02T00:00:00.000Z', startsAt: '2026-01-03T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z', superCapacity: 15, championCapacity: 15, promotionCount: 3, status: seasonNumber === 3 ? 'IN_PROGRESS' : 'COMPLETED', entryCount: 30, approvedEntryCount: 30, version: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(seasonOptions([season(1), season(3), season(2)], 'season-3')).toEqual({
      items: [{ id: 'season-3', label: 'S3（当前）' }, { id: 'season-2', label: 'S2' }, { id: 'season-1', label: 'S1' }],
      selectedIndex: 0,
      selectedSeasonId: 'season-3'
    })
  })

  it('presents pending and completed matches with symmetric team identities and a centered result', () => {
    expect(matchCard(response(false))).toMatchObject({
      resultCopy: '对阵', stateCopy: '待比赛', scheduleMeta: '第 2 轮 · 主场', plannedLabel: '时间待定',
      home: { identityCopy: '25-上海申花', ownerCopy: '梅西（小宣）', badgeUrl: 'https://static.example.com/shenhua.png' },
      away: { identityCopy: '09-北京国安', ownerCopy: '国安经理', badgeText: '北京' }
    })
    expect(matchCard(response(true))).toMatchObject({ resultCopy: '3 : 1', stateCopy: '已结束' })
  })

  it('shows the participant next action and confirmation deadline', () => {
    expect(matchCard(
      { ...response(false), action: 'CONFIRM', confirmationDeadlineAt: '2026-10-17T13:30:00.000Z' },
      Date.parse('2026-10-17T12:00:00.000Z')
    )).toMatchObject({
      nextActionCopy: '确认或拒绝比分', deadlineCopy: `确认截止 ${resultTime('2026-10-17T13:30:00.000Z')}`
    })
    expect(matchCard({ ...response(false), action: 'WAIT', myEvidenceRole: 'SUBMITTER', confirmationDeadlineAt: '2026-10-17T13:30:00.000Z',
      match: { ...response(false).match, resultVersions: [{ submittedByMe: true }] } } as MyMatchResponse, Date.parse('2026-10-18T00:00:00.000Z'))).toMatchObject({
      nextActionCopy: '上传证据并申请争议'
    })
  })
})

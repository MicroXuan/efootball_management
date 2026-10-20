import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { competitionListPath, competitionsApi, myMatchesPath, seasonFixturesPath } from './competitions'

describe('competition service query', () => {
  it('encodes a season-scoped cup query without leaking undefined values', () => {
    expect(competitionListPath({
      cursor: 'next/page',
      limit: 12,
      seasonId: 'season 1',
      category: 'CUP',
    })).toBe('/competitions?cursor=next%2Fpage&limit=12&seasonId=season%201&category=CUP')
    expect(competitionListPath()).toBe('/competitions?limit=20')
  })

  it('builds a complete season history query without the upcoming-only filter', () => {
    expect(myMatchesPath({ seasonId: 'season 1', limit: 100 }))
      .toBe('/me/matches?limit=100&seasonId=season%201')
  })

  it('builds an encoded season fixture query with filters and pagination', () => {
    expect(seasonFixturesPath('league/1', 'season 1', {
      team: ' AC 米兰 ', status: 'FINISHED', cursor: 'next/page', limit: 50,
    })).toBe('/me/leagues/league%2F1/seasons/season%201/fixtures?team=AC%20%E7%B1%B3%E5%85%B0&status=FINISHED&cursor=next%2Fpage&limit=50')
    expect(seasonFixturesPath('league-1', 'season-1'))
      .toBe('/me/leagues/league-1/seasons/season-1/fixtures?status=ALL&limit=20')
    expect(seasonFixturesPath('league-1', 'season-1', { scope: 'MINE', leagueTeamId: 'team/1' }))
      .toBe('/me/leagues/league-1/seasons/season-1/fixtures?status=ALL&scope=MINE&leagueTeamId=team%2F1&limit=20')
  })

  it('does not expose participant result or evidence operations', () => {
    for (const operation of [
      ['submit', 'Result'], ['confirm', 'Result'], ['reject', 'Result'], ['result', 'Dispute'],
      ['openTimeout', 'Dispute'], ['attachResult', 'Evidence'],
    ].map((parts) => parts.join(''))) expect(competitionsApi).not.toHaveProperty(operation)
  })

  it('does not register the removed result workflow page', () => {
    const app = JSON.parse(readFileSync(resolve(process.cwd(), 'miniprogram/app.json'), 'utf8')) as { pages: string[] }
    expect(app.pages).not.toContain(['pages/match', 'result/index'].join('-'))
  })
})

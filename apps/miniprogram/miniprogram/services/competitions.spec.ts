import { describe, expect, it } from 'vitest'
import { competitionListPath } from './competitions'

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
})

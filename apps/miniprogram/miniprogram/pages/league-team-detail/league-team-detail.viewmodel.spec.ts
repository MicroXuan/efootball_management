import { describe, expect, it } from 'vitest'
import * as viewmodel from './league-team-detail.viewmodel'

const { ledgerAmount, rosterState, readonlyActions } = viewmodel

describe('league team detail viewmodel', () => {
  it('renders a deliberate empty roster state', () => {
    expect(rosterState([], 'COMPLIANT')).toEqual({ empty: true, overCap: false })
  })

  it('marks an over-cap roster', () => {
    expect(rosterState([{ id: 'entry' }], 'OVER_CAP')).toEqual({ empty: false, overCap: true })
  })

  it('formats immutable ledger directions with signs', () => {
    expect(ledgerAmount('DEBIT', 1200)).toBe('-1200')
    expect(ledgerAmount('CREDIT', 500)).toBe('+500')
  })

  it('exposes no roster mutation actions', () => {
    expect(readonlyActions()).toEqual([])
  })

  it('presents player position, height and salary without card-pack copy', () => {
    const rosterPlayerView = (viewmodel as unknown as { rosterPlayerView?: (entry: Record<string, unknown>) => Record<string, unknown> }).rosterPlayerView
    expect(rosterPlayerView).toBeTypeOf('function')
    expect(rosterPlayerView?.({
      id: 'entry-1', playerName: '铃木彩艳', position: 'GK', heightCm: 190, salaryMinor: 800
    })).toEqual({
      id: 'entry-1', playerName: '铃木彩艳', position: 'GK', positionTone: 'keeper',
      heightCopy: '190cm', positionCopy: 'GK', salaryCopy: '800'
    })
    expect(rosterPlayerView?.({
      id: 'entry-2', playerName: '资料待补球员', position: 'CB', heightCm: null, salaryMinor: 400
    })).toMatchObject({ positionTone: 'defender', heightCopy: '身高未知' })
  })

  it('builds four consistent team workspace entries', () => {
    const teamDetailActions = (viewmodel as unknown as { teamDetailActions?: (teamId: string, leagueId: string) => unknown }).teamDetailActions
    expect(teamDetailActions).toBeTypeOf('function')
    expect(teamDetailActions?.('team-1', 'league-1')).toEqual([
      { key: 'assets', marker: '资', label: '球队资产', description: '阵容与总价值', url: '/pages/team-assets/index?teamId=team-1' },
      { key: 'valuations', marker: '价', label: '身价管理', description: '调整球员身价', url: '/pages/valuation-manage/index?teamId=team-1' },
      { key: 'transactions', marker: '交', label: '交易记录', description: '查看转会明细', url: '/pages/league-transactions/index?leagueId=league-1' },
      { key: 'finance', marker: '财', label: '财务流水', description: '工资与收支', url: '/pages/team-finance/index?teamId=team-1' }
    ])
  })
})

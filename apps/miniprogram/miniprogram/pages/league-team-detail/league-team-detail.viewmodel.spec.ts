import { describe, expect, it } from 'vitest'
import { ledgerAmount, rosterState, readonlyActions } from './league-team-detail.viewmodel'

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
})

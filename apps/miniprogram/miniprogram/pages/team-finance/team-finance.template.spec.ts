import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')

describe('team finance template', () => {
  it('shows the administrator settlement summary before immutable ledger entries', () => {
    const settlement = markup.indexOf('结算金额')
    const ledger = markup.indexOf('收支明细')

    expect(settlement).toBeGreaterThan(-1)
    expect(markup).toContain('finance.settlementItems')
    expect(markup).toContain('{{item.label}}')
    expect(markup).toContain('{{item.amountCopy}}')
    expect(markup).toContain('{{finance.settlementTotalCopy}}')
    expect(settlement).toBeLessThan(ledger)
  })
})

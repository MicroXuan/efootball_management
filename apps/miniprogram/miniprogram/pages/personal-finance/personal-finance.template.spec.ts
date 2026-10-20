import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const styles = readFileSync(resolve(__dirname, 'index.wxss'), 'utf8')

describe('personal finance template', () => {
  it('keeps the private ledger form and edit actions on its own page', () => {
    expect(markup).toContain('仅自己可见')
    expect(markup).toContain('bindtap="savePersonal"')
    expect(markup).toContain('bindtap="editPersonal"')
    expect(markup).toContain('bindtap="deletePersonal"')
  })
  it('lays out the date text and chevron as separate aligned elements', () => {
    expect(markup).toContain('personal-date__chevron')
    expect(styles).toContain('.personal-date { display:flex; align-items:center; justify-content:space-between;')
  })
})

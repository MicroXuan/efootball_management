import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const loginMarkup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const profileMarkup = readFileSync(resolve(__dirname, '../profile/index.wxml'), 'utf8')

describe('player profile labels', () => {
  it('does not append a decorative sequence number to player profile labels', () => {
    expect(loginMarkup).toContain('球员档案')
    expect(loginMarkup).not.toContain('球员档案 · 01')
    expect(profileMarkup).not.toContain('球员档案 · 01')
  })
})

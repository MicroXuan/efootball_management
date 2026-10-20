import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps release disabled outside the window and exposes review-based lifecycle actions', () => {
  const template = readFileSync('miniprogram/pages/team-assets/index.wxml', 'utf8')
  expect(template).toContain('disabled="{{!item.releaseEnabled || !!releasingOwnershipId}}"')
  expect(template).toContain("'标记消失'")
  expect(template).toContain('协商转会')
  expect(template).toContain('发起强报')
  expect(template).toContain('item.pendingDisappearance')
})

it('registers the counterparty confirmation page', () => {
  const app = JSON.parse(readFileSync('miniprogram/app.json', 'utf8')) as { pages: string[] }
  expect(app.pages).toContain('pages/transfer-proposals/index')
})

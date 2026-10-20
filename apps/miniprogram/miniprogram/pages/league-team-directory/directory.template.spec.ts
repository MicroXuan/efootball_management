import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const page = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')
const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const assetsPage = readFileSync(resolve(__dirname, '../team-assets/index.ts'), 'utf8')
const manifest = readFileSync(resolve(__dirname, '../../app.json'), 'utf8')

it('opens another team through the public, read-only asset route', () => {
  expect(manifest).toContain('pages/league-team-directory/index')
  expect(markup).toContain('data-team-id="{{item.teamId}}"')
  expect(markup).toContain('搜索编号、球队或负责人')
  expect(page).toContain('view=public')
  expect(assetsPage).toContain('economyApi.publicAssets')
  expect(assetsPage).toContain('this.data.publicView')
  expect(assetsPage).toContain('if (!assets?.isOwner')
})

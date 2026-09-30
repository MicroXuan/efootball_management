import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const miniRoot = resolve(process.cwd(), 'miniprogram')

describe('active mini-program legacy route boundary', () => {
  it('has no registered page that calls legacy game-account or self-service team-profile APIs', () => {
    const app = JSON.parse(readFileSync(resolve(miniRoot, 'app.json'), 'utf8')) as { pages: string[] }
    expect(app.pages).not.toContain('pages/game-account-edit/index')
    expect(app.pages).not.toContain('pages/team-profile/index')
    expect(app.pages).not.toContain('pages/league-editor/index')
    expect(app.pages).not.toContain('pages/season-manage/index')

    const currentProductPages = [
      'pages/leagues/index',
      'pages/league-detail/index',
      'pages/profile/index',
      'pages/my-league-teams/index',
      'pages/league-team-detail/index',
    ]
    const activeSources = currentProductPages
      .map((page) => resolve(miniRoot, `${page}.ts`))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(activeSources).not.toContain('/me/game-accounts')
    expect(activeSources).not.toContain('/me/team-profile')
  })
})

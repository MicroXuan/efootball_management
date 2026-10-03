import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const miniRoot = resolve(process.cwd(), 'miniprogram')
const browsingPages = [
  'players',
  'player-card-detail',
  'favorites',
  'competitions',
  'competition-detail',
  'my-matches',
  'match-result',
  'my-league-teams',
  'league-team-detail',
]

describe('registered browsing pages visual boundary', () => {
  it('keeps every registered page free from deprecated neon-era colors', () => {
    const app = JSON.parse(readFileSync(resolve(miniRoot, 'app.json'), 'utf8')) as { pages: string[] }

    for (const page of app.pages) {
      const styles = readFileSync(resolve(miniRoot, `${page}.wxss`), 'utf8').toLowerCase()
      const config = JSON.parse(readFileSync(resolve(miniRoot, `${page}.json`), 'utf8')) as {
        backgroundColor?: string
      }

      expect(styles, page).not.toMatch(/#0a0a0a|#b0ff00|#d9e342|999rpx/)
      if (config.backgroundColor) expect(config.backgroundColor, page).toBe('#0E1417')
    }
  })

  it.each(browsingPages)('%s uses premium dark surfaces and readable neutral text', (page) => {
    const styles = readFileSync(resolve(miniRoot, `pages/${page}/index.wxss`), 'utf8').toLowerCase()

    expect(styles).toContain('#0e1417')
    expect(styles).toContain('#344047')
    expect(styles).toContain('#aab5ba')
    expect(styles).not.toContain('#0a0a0a')
    expect(styles).not.toContain('#b0ff00')
    expect(styles).not.toContain('#d9e342')
  })

  it.each(['competition-manage', 'competition-editor', 'login', 'profile'])(
    '%s exposes premium form contrast without legacy neon copy',
    (page) => {
      const styles = readFileSync(resolve(miniRoot, `pages/${page}/index.wxss`), 'utf8').toLowerCase()

      expect(styles).toContain('#0e1417')
      expect(styles).toContain('#344047')
      expect(styles).toContain('#aab5ba')
      expect(styles).toContain('border-radius: 16rpx')
      expect(styles).not.toContain('#0a0a0a')
      expect(styles).not.toContain('#b0ff00')
      expect(styles).not.toContain('#d9e342')
    },
  )

  it('keeps loading feedback stable and neutral on every dark page', () => {
    const styles = readFileSync(resolve(miniRoot, 'components/loading-state/index.wxss'), 'utf8').toLowerCase()

    expect(styles).toContain('min-height: 420rpx')
    expect(styles).toContain('#aab5ba')
    expect(styles).toContain('#344047')
    expect(styles).not.toContain('rgba(85, 239, 139')
  })
})

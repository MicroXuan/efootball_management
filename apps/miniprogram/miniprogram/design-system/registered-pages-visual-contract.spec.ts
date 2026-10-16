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
  'season-standings',
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

  it('keeps the ability radar in the normal page layer during navigation', () => {
    const markup = readFileSync(
      resolve(miniRoot, 'pages/player-card-detail/index.wxml'),
      'utf8',
    )

    expect(markup).toContain('class="radar-stage"')
    expect(markup).toContain('presentation.radarChart')
    expect(markup).not.toContain('<canvas')
  })

  it('loads original player artwork lazily and reveals it only after decoding', () => {
    const markup = readFileSync(resolve(miniRoot, 'components/player-card/index.wxml'), 'utf8')

    expect(markup).toContain('lazy-load="{{true}}"')
    expect(markup).toContain('bindload="onImageLoad"')
    expect(markup).toContain("imageLoaded ? 'is-loaded' : ''")
  })

  it('uses a configurable image-led league banner without the retired masthead copy', () => {
    const markup = readFileSync(resolve(miniRoot, 'pages/leagues/index.wxml'), 'utf8')

    expect(markup).toContain('class="league-banner')
    expect(markup).toContain("background-image: url('{{bannerDisplayUrl}}')")
    expect(markup).not.toContain('<image')
    expect(markup).not.toContain('联赛中心')
    expect(markup).not.toContain('发现公开联赛')
  })

  it.each(['my-league-teams', 'profile', 'league-team-detail'])(
    '%s renders team crests through the shared artwork fallback',
    (page) => {
      const markup = readFileSync(resolve(miniRoot, `pages/${page}/index.wxml`), 'utf8')
      const config = JSON.parse(readFileSync(resolve(miniRoot, `pages/${page}/index.json`), 'utf8')) as {
        usingComponents?: Record<string, string>
      }

      expect(markup).toContain('<entity-artwork')
      expect(config.usingComponents?.['entity-artwork']).toBe('/components/entity-artwork/index')
    },
  )

  it('keeps fixed tab groups equal-width and inside the page gutter', () => {
    const styles = readFileSync(resolve(miniRoot, 'app.wxss'), 'utf8')

    expect(styles).toContain('.efm-equal-tabs > button')
    expect(styles).toMatch(/\.efm-equal-tabs\s*>\s*button\s*\{[^}]*width:\s*100%/s)
    expect(styles).toMatch(/\.efm-equal-tabs\s*>\s*button\s*\{[^}]*min-width:\s*0/s)
    expect(styles).toMatch(/\.efm-equal-tabs\s*>\s*button\s*\{[^}]*height:\s*72rpx/s)
    expect(styles).toMatch(/\.efm-equal-tabs\s*>\s*button\s*\{[^}]*box-sizing:\s*border-box/s)

    for (const page of ['leagues', 'competition-detail', 'league-transactions', 'team-assets', 'player-market-detail', 'valuation-manage']) {
      const markup = readFileSync(resolve(miniRoot, `pages/${page}/index.wxml`), 'utf8')
      expect(markup, page).toContain('efm-equal-tabs')
    }
  })

  it.each(['leagues', 'players'])('%s keeps scroll content above the floating tab bar', (page) => {
    const styles = readFileSync(resolve(miniRoot, `pages/${page}/index.wxss`), 'utf8')

    expect(styles).toMatch(/padding:[^;]*calc\(env\(safe-area-inset-bottom\) \+ 190rpx\)/s)
  })

  it('keeps the league discovery surface compact enough to preview multiple leagues', () => {
    const styles = readFileSync(resolve(miniRoot, 'pages/leagues/index.wxss'), 'utf8')

    expect(styles).toMatch(/\.league-banner\s*{[^}]*height:\s*160rpx/s)
    expect(styles).toMatch(/\.league-card__identity\s*{[^}]*min-height:\s*136rpx/s)
    expect(styles).toMatch(/\.season-strip\s*{[^}]*min-height:\s*88rpx/s)
  })

  it('keeps the favorite control as a compact badge inside the player card', () => {
    const styles = readFileSync(resolve(miniRoot, 'pages/favorites/index.wxss'), 'utf8')

    expect(styles).toMatch(/\.remove-button\s*\{[^}]*top:\s*8rpx/s)
    expect(styles).toMatch(/\.remove-button\s*\{[^}]*right:\s*8rpx/s)
    expect(styles).toMatch(/\.remove-button\s*\{[^}]*width:\s*44rpx/s)
    expect(styles).toMatch(/\.remove-button\s*\{[^}]*min-width:\s*44rpx/s)
    expect(styles).toMatch(/\.remove-button\s*\{[^}]*max-width:\s*44rpx/s)
    expect(styles).toMatch(/\.remove-button\s*\{[^}]*height:\s*44rpx/s)
    expect(styles).toMatch(/\.remove-button\s*\{[^}]*border-radius:\s*50%/s)
  })
})

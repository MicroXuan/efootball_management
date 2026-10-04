import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const miniRoot = resolve(process.cwd(), 'miniprogram')

describe('premium mini-program visual contract', () => {
  it('exposes the approved dark semantic palette and layered radii', () => {
    const styles = readFileSync(resolve(miniRoot, 'app.wxss'), 'utf8')

    expect(styles).toContain('--efm-bg: #0e1417')
    expect(styles).toContain('--efm-surface: #151d21')
    expect(styles).toContain('--efm-surface-raised: #1c262b')
    expect(styles).toContain('--efm-border-strong: #344047')
    expect(styles).toContain('--efm-border-weak: #2d393f')
    expect(styles).toContain('--efm-text: #f4f7f8')
    expect(styles).toContain('--efm-text-secondary: #aab5ba')
    expect(styles).toContain('--efm-text-muted: #7e8b91')
    expect(styles).toContain('--efm-accent: #b6f13a')
    expect(styles).toContain('--efm-on-accent: #111810')
    expect(styles).toContain('--efm-radius-card: 24rpx')
    expect(styles).toContain('--efm-radius-control: 16rpx')
    expect(styles).not.toContain('border-radius: 999rpx !important')
  })

  it('keeps native chrome and the floating tab bar aligned with safe areas', () => {
    const app = JSON.parse(readFileSync(resolve(miniRoot, 'app.json'), 'utf8')) as {
      window: { navigationBarBackgroundColor: string; backgroundColor: string }
      tabBar: { selectedColor: string; backgroundColor: string }
    }
    const tabStyles = readFileSync(resolve(miniRoot, 'custom-tab-bar/index.wxss'), 'utf8')

    expect(app.window.navigationBarBackgroundColor).toBe('#0E1417')
    expect(app.window.backgroundColor).toBe('#0E1417')
    expect(app.tabBar.selectedColor).toBe('#B6F13A')
    expect(app.tabBar.backgroundColor).toBe('#151D21')
    expect(tabStyles).toContain('env(safe-area-inset-bottom)')
    expect(tabStyles).toContain('#b6f13a')
    expect(tabStyles).toContain('#aab5ba')
  })
})

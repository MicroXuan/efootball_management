import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('WeChat preview compiler contract', () => {
  it('transforms modern TypeScript output before previewing on a device', () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), 'project.config.json'), 'utf8'),
    ) as { setting?: { es6?: boolean; minified?: boolean } }

    expect(config.setting?.es6).toBe(true)
    expect(config.setting?.minified).toBe(true)
  })
})

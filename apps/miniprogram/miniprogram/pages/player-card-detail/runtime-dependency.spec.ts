import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

describe('player card detail runtime dependencies', () => {
  it('does not request card data before login and preserves the exact detail return route', () => {
    const source = readFileSync(resolve(process.cwd(), 'miniprogram/pages/player-card-detail/index.ts'), 'utf8')
    expect(source).toContain('if (!session.getAccessToken())')
    expect(source).toContain('`/pages/player-card-detail/index?id=${encodeURIComponent(this.data.cardId)}`')
    expect(source.indexOf('if (!session.getAccessToken())')).toBeLessThan(source.indexOf('await catalogApi.getPlayerCard'))
  })

  it('does not emit a workspace package require that WeChat cannot load', () => {
    const sourcePath = resolve(process.cwd(), 'miniprogram/pages/player-card-detail/detail.viewmodel.ts')
    const output = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText

    expect(output).not.toContain('require("@efm/contracts")')
  })
})

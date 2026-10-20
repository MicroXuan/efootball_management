import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { playerAuctionSalesPath } from './player-auctions'

describe('player auction service runtime dependencies', () => {
  it('trims and encodes confirmed-sale search parameters', () => {
    expect(playerAuctionSalesPath({ keyword: '  01 申花  ', cursor: 'next / 1', limit: 10 }))
      .toBe('/me/player-auction-sales?keyword=01%20%E7%94%B3%E8%8A%B1&cursor=next%20%2F%201&limit=10')
  })

  it('does not emit a workspace package require that WeChat cannot load', () => {
    const sourcePath = resolve(process.cwd(), 'miniprogram/services/player-auctions.ts')
    const output = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText

    expect(output).not.toContain('require("@efm/contracts")')
  })
})

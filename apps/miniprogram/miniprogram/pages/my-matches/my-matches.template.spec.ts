import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
const pageConfig = JSON.parse(readFileSync(resolve(__dirname, 'index.json'), 'utf8')) as {
  usingComponents?: Record<string, string>
}

describe('my matches template', () => {
  it('renders a season picker and a symmetric read-only three-column fixture', () => {
    expect(markup).toContain('bindchange="changeSeason"')
    expect(markup).toContain('class="fixture-team fixture-home"')
    expect(markup).toContain('class="fixture-center"')
    expect(markup).toContain('class="fixture-team fixture-away"')
    expect(markup).toContain('<entity-artwork')
    expect(markup).toContain('{{item.resultCopy}}')
    expect(markup).not.toContain('提交比分')
    expect(markup).not.toContain('确认对手比分')
    expect(markup).toContain('bindtap="openMatch"')
    expect(markup).toContain('{{item.nextActionCopy}}')
    expect(markup).toContain('{{item.deadlineCopy}}')
  })

  it('registers the team badge component used by each fixture', () => {
    expect(pageConfig.usingComponents?.['entity-artwork']).toBe('/components/entity-artwork/index')
  })
})

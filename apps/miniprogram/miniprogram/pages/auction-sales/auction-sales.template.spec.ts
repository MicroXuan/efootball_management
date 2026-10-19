import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'miniprogram')

describe('auction sales page', () => {
  it('is registered and reachable from the auction list', () => {
    const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')) as { pages: string[] }
    const auctions = readFileSync(resolve(root, 'pages/player-auctions/index.wxml'), 'utf8')
    expect(app.pages).toContain('pages/auction-sales/index')
    expect(auctions).toContain('成交纪录')
    expect(auctions).toContain('bindtap="openSales"')
  })

  it('renders artwork, player/card, team number/name, bidder, price and confirmed time', () => {
    const markup = readFileSync(resolve(root, 'pages/auction-sales/index.wxml'), 'utf8')
    expect(markup).toContain('<entity-artwork')
    expect(markup).toContain('{{item.player.cardId}}')
    expect(markup).toContain('{{item.teamLabel}}')
    expect(markup).toContain('{{item.winner.bidderDisplayName}}')
    expect(markup).toContain('{{item.price}}')
    expect(markup).toContain('{{item.confirmedTimeLabel}}')
    expect(markup).toContain('bindtap="openCard"')
  })
})

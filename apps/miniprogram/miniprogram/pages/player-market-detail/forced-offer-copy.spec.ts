import type { PlayerAcquisitionApplication } from '@efm/contracts'
import { expect, it } from 'vitest'
import { activeForcedOfferCopy, forcedOfferCopy } from './forced-offer-copy'

const application = { id: 'request-123', type: 'FORCED_TRANSFER', status: 'PENDING', playerName: '拉斐尔·瓦拉内', amountMinor: 15000,
  applicantTeam: { teamId: 'team-4', teamNumber: 4, name: '巴塞罗那', ownerAlias: '小新（潇洒）', logoUrl: null },
  sourceTeam: { teamId: 'team-3', teamNumber: 3, name: '阿贾克斯', ownerAlias: '嗷呜凶一个（tidus）', logoUrl: null } } as PlayerAcquisitionApplication

it('copies the bid amount, both teams, and both player names without internal ID or review text', () => {
  const text = forcedOfferCopy(application, 'Raphaël Varane')
  expect(text).not.toContain('request-123')
  expect(text).toContain('4号（巴塞罗那-小新（潇洒））')
  expect(text).toContain('3号（阿贾克斯-嗷呜凶一个（tidus））')
  expect(text).toContain('Raphaël Varane（拉斐尔·瓦拉内）')
  expect(text).toContain('本次强报报价 15000')
  expect(text).not.toContain('待管理员审核')
  expect(text).not.toContain('此金额是本次报价')
  expect(text).not.toContain('新标价')
})

it('shows no copy before a real pending forced application and falls back without English name', () => {
  expect(activeForcedOfferCopy(null, null)).toBeNull()
  expect(activeForcedOfferCopy({ ...application, type: 'NORMAL_PURCHASE' }, null)).toBeNull()
  expect(activeForcedOfferCopy({ ...application, status: 'WITHDRAWN' }, null)).toBeNull()
  expect(forcedOfferCopy(application, null)).toContain('球员 拉斐尔·瓦拉内')
})

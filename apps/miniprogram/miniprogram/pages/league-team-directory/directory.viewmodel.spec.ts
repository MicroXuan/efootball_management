import { expect, it } from 'vitest'
import { directoryRows } from './directory.viewmodel'

const directory = { items: [
  { teamId: 'team-1', teamNumber: 3, teamName: '阿贾克斯', teamLogoUrl: null, ownerAlias: 'tidus', activePlayerCount: 21 },
  { teamId: 'team-2', teamNumber: 4, teamName: '巴塞罗那', teamLogoUrl: null, ownerAlias: '小新', activePlayerCount: 23 }
] }

it('shows full team identity and searches by number, team, or manager alias', () => {
  expect(directoryRows(directory, '')[0]).toMatchObject({ identity: '03号 · 阿贾克斯', activePlayerCount: 21 })
  expect(directoryRows(directory, '小新')).toHaveLength(1)
  expect(directoryRows(directory, '3')).toHaveLength(1)
  expect(directoryRows(directory, '巴塞')).toHaveLength(1)
})

import type { PlayerAcquisitionApplication } from '@efm/contracts';
import { buildReviewGroups, reviewBlocker } from './player-market-review.model';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const application = (overrides: Partial<PlayerAcquisitionApplication> = {}): PlayerAcquisitionApplication => ({
  id: id(1), leagueId: id(2), seasonId: id(3), transferWindowId: id(4), forcedOfferWindowId: null,
  type: 'NORMAL_PURCHASE', applicantTeam: { teamId: id(5), teamNumber: 5, name: '海港竞技', logoUrl: null, ownerAlias: '小宣' },
  playerId: id(6), playerName: '测试球员', playerCard: { playerCardId: id(7), cardName: '精选', imageUrl: null, position: 'CF', maxOverall: 96, salaryMinor: 500 },
  sourceTeam: null, ownershipId: null, ownershipVersionSnapshot: null, amountMinor: 1200,
  valuationMinorSnapshot: 1000, valuationVersionSnapshot: 1, status: 'PENDING', queuePosition: null,
  firstValidSubmittedAt: '2026-10-14T12:00:00.000Z', lastSubmittedAt: '2026-10-14T12:00:00.000Z',
  reviewedAt: null, reviewReason: null, version: 1, events: [], ...overrides
});

it('groups normal applications by player for side-by-side selection', () => {
  const groups = buildReviewGroups([
    application({ id: id(11), applicantTeam: { teamId: id(12), teamNumber: 8, name: '蓉城', logoUrl: null, ownerAlias: 'Jeremy' } }),
    application({ id: id(13), applicantTeam: { teamId: id(14), teamNumber: 4, name: '巴塞罗那', logoUrl: null, ownerAlias: '小新' } }),
    application({ id: id(15), playerId: id(16), playerName: '另一名球员' })
  ]);
  expect(groups).toHaveLength(2);
  expect(groups[0]?.applications).toHaveLength(2);
});

it('orders forced transfers by first valid time and only unlocks the queue head', () => {
  const later = application({ id: id(22), type: 'FORCED_TRANSFER', firstValidSubmittedAt: '2026-10-14T12:01:00.000Z', queuePosition: 2 });
  const earlier = application({ id: id(21), type: 'FORCED_TRANSFER', firstValidSubmittedAt: '2026-10-14T12:00:00.000Z', queuePosition: 1 });
  const group = buildReviewGroups([later, earlier])[0]!;
  expect(group.applications.map((item) => item.id)).toEqual([earlier.id, later.id]);
  expect(group.applications.map((item) => item.canReview)).toEqual([true, false]);
});

it('shows applications awaiting review before finished applications and groups', () => {
  const finished = application({ id: id(31), status: 'WITHDRAWN', type: 'FORCED_TRANSFER', firstValidSubmittedAt: '2026-10-14T11:00:00.000Z' });
  const pending = application({ id: id(32), type: 'FORCED_TRANSFER', firstValidSubmittedAt: '2026-10-14T12:00:00.000Z' });
  const finishedGroup = application({ id: id(33), playerId: id(34), status: 'REJECTED', type: 'FORCED_TRANSFER' });
  const groups = buildReviewGroups([finishedGroup, finished, pending]);
  expect(groups.map((group) => group.playerId)).toEqual([pending.playerId, finishedGroup.playerId]);
  expect(groups[0]?.applications.map((item) => item.id)).toEqual([pending.id, finished.id]);
  expect(groups[0]?.applications[0]?.canReview).toBe(true);
});

it.each([
  ['REQUOTE_REQUIRED', '官方身价已变化，需要申请队补价'],
  ['OWNERSHIP_CHANGED', '球员归属已变化'],
  ['INELIGIBLE', '球队阵容已满'],
  ['EXPIRED', '转会窗口已关闭']
] as const)('explains %s applications', (status, expected) => {
  expect(reviewBlocker(application({ status, reviewReason: status === 'INELIGIBLE' ? 'TEAM_ROSTER_FULL' : null }))).toContain(expected);
});

import type { PlayerAcquisitionApplication } from '@efm/contracts';

export type ReviewApplication = PlayerAcquisitionApplication & { canReview: boolean };
export type ReviewGroup = {
  playerId: string;
  playerName: string;
  applications: ReviewApplication[];
};

const byQueue = (left: PlayerAcquisitionApplication, right: PlayerAcquisitionApplication) =>
  left.firstValidSubmittedAt.localeCompare(right.firstValidSubmittedAt) || left.id.localeCompare(right.id);

export function buildReviewGroups(items: PlayerAcquisitionApplication[]): ReviewGroup[] {
  const groups = new Map<string, PlayerAcquisitionApplication[]>();
  for (const item of items) groups.set(item.playerId, [...(groups.get(item.playerId) ?? []), item]);
  return [...groups.values()].map((applications) => {
    const sorted = applications[0]?.type === 'FORCED_TRANSFER' ? [...applications].sort(byQueue) : [...applications];
    const pendingHead = sorted.findIndex((item) => item.status === 'PENDING');
    return {
      playerId: sorted[0]!.playerId,
      playerName: sorted[0]!.playerName,
      applications: sorted.map((item, index) => ({
        ...item,
        canReview: item.status === 'PENDING' && (item.type === 'NORMAL_PURCHASE' || index === pendingHead)
      })).sort((left, right) => Number(right.status === 'PENDING') - Number(left.status === 'PENDING'))
    };
  }).sort((left, right) => Number(right.applications.some((item) => item.status === 'PENDING')) - Number(left.applications.some((item) => item.status === 'PENDING')));
}

export function reviewBlocker(item: PlayerAcquisitionApplication): string | null {
  if (item.status === 'REQUOTE_REQUIRED') return '官方身价已变化，需要申请队补价后再审核';
  if (item.status === 'OWNERSHIP_CHANGED') return '球员归属已变化，本次申请不能继续成交';
  if (item.status === 'EXPIRED') return '转会窗口已关闭，本次申请已过期';
  if (item.status === 'INELIGIBLE') {
    if (item.reviewReason === 'TEAM_ROSTER_FULL' || item.reviewReason === 'ROSTER_CAPACITY_REACHED') return '球队阵容已满，必须先下放球员';
    if (item.reviewReason === 'TEAM_OVER_SALARY_CAP' || item.reviewReason === 'SALARY_CAP_EXCEEDED') return '球队工资状态不合规';
    return item.reviewReason || '球队当前不符合成交条件';
  }
  if (item.status !== 'PENDING') return '该申请已结束，不能再次审核';
  return null;
}

import type { LeagueSeasonStatus } from '@efm/contracts';

export type SeasonRailItem = {
  key: 'registration' | 'confirmation' | 'schedule' | 'settlement';
  label: string;
  state: 'complete' | 'current' | 'upcoming' | 'cancelled';
};

const stages = [
  { key: 'registration', label: '报名' },
  { key: 'confirmation', label: '名单确认' },
  { key: 'schedule', label: '赛程进行' },
  { key: 'settlement', label: '赛季结算' }
] as const;

export function createSeasonRail(status: LeagueSeasonStatus): SeasonRailItem[] {
  if (status === 'CANCELLED') return stages.map((stage) => ({ ...stage, state: 'cancelled' }));
  if (status === 'COMPLETED') return stages.map((stage) => ({ ...stage, state: 'complete' }));

  const currentIndex = status === 'ALLOCATION_REVIEW' ? 1 : status === 'READY' || status === 'IN_PROGRESS' ? 2 : 0;
  return stages.map((stage, index) => ({
    ...stage,
    state: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming'
  }));
}

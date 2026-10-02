import type { LeagueSeasonStatus } from '@efm/contracts';
import { createSeasonRail } from './season-rail.model';

export function SeasonRail({ status, compact = false }: { status: LeagueSeasonStatus; compact?: boolean }) {
  const items = createSeasonRail(status);
  return <ol className={`season-rail${compact ? ' season-rail--compact' : ''}`} aria-label="赛季进程">
    {items.map((item, index) => <li key={item.key} className={`season-rail__item season-rail__item--${item.state}`}>
      <span className="season-rail__marker" aria-hidden="true">{item.state === 'complete' ? '✓' : index + 1}</span>
      <span className="season-rail__label" aria-current={item.state === 'current' ? 'step' : undefined}>{item.label}</span>
    </li>)}
  </ol>;
}

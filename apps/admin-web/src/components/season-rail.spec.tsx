import { render, screen } from '@testing-library/react';
import { createSeasonRail } from './season-rail.model';
import { SeasonRail } from './season-rail';

describe('season rail model', () => {
  it.each([
    ['DRAFT', 0],
    ['REGISTRATION_OPEN', 0],
    ['ALLOCATION_REVIEW', 1],
    ['READY', 2],
    ['IN_PROGRESS', 2]
  ] as const)('marks the expected current stage for %s', (status, currentIndex) => {
    expect(createSeasonRail(status).map((item) => item.state)).toEqual(
      ['registration', 'confirmation', 'schedule', 'settlement'].map((_, index) =>
        index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming'
      )
    );
  });

  it('marks every stage complete for a completed season', () => {
    expect(createSeasonRail('COMPLETED').every((item) => item.state === 'complete')).toBe(true);
  });

  it('keeps cancellation distinct from completion', () => {
    expect(createSeasonRail('CANCELLED').every((item) => item.state === 'cancelled')).toBe(true);
  });
});

it('renders an ordered journey and exposes the current stage', () => {
  render(<SeasonRail status="ALLOCATION_REVIEW" />);
  expect(screen.getByRole('list', { name: '赛季进程' })).toBeInTheDocument();
  expect(screen.getByText('名单确认')).toHaveAttribute('aria-current', 'step');
});

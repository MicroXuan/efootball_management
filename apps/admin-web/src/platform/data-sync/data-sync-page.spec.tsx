import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AdminApi } from '../../lib/api';
import { DataSyncPage } from './data-sync-page';

const overview = {
  players: { activeRun: null, pendingReview: 3, failedReview: 1, published: 20, lastCompletedAt: null },
  teams: { activeRun: null, pendingReview: 5, failedReview: 2, published: 980, lastCompletedAt: null }
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}`}</output>;
}

const api = {
  request: vi.fn().mockResolvedValue(overview)
} as unknown as AdminApi;

describe('DataSyncPage', () => {
  it('defaults to player cards and persists the selected data domain in the URL', async () => {
    render(<MemoryRouter initialEntries={['/platform/data-sync']}>
      <DataSyncPage api={api} />
      <LocationProbe />
    </MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '数据同步' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /球员卡/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /球队队壳/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /球队队壳/ }));
    await waitFor(() => expect(screen.getByLabelText('current location')).toHaveTextContent('/platform/data-sync?tab=teams'));
    expect(screen.getByRole('tab', { name: /球队队壳/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('restores the team-shell tab after a refresh URL', async () => {
    render(<MemoryRouter initialEntries={['/platform/data-sync?tab=teams']}><DataSyncPage api={api} /></MemoryRouter>);
    expect(await screen.findByRole('tab', { name: /球队队壳/ })).toHaveAttribute('aria-selected', 'true');
  });
});

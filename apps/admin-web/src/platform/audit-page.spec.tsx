import { render, screen } from '@testing-library/react';
import type { AdminApi } from '../lib/api';
import { AuditPage } from './audit-page';

it('renders audit history as an immutable view', async () => {
  const request = vi.fn().mockResolvedValue([{
    id: '11111111-1111-4111-8111-111111111111', actorAdminId: '22222222-2222-4222-8222-222222222222',
    leagueId: null, action: 'admin.account.create', resourceType: 'AdminAccount', resourceId: null,
    reason: null, metadata: {}, createdAt: '2026-09-29T00:00:00.000Z'
  }]);
  render(<AuditPage api={{ request } as unknown as AdminApi} />);

  expect(await screen.findByText('admin.account.create')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑|删除/ })).not.toBeInTheDocument();
});

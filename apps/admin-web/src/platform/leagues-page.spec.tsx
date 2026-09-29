import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { ApiError } from '../lib/api';
import { LeaguesPage } from './leagues-page';

const league = (name: string, version: number) => ({
  id: '22222222-2222-4222-8222-222222222222', name, shortName: 'CELL', description: '', logoUrl: null,
  status: 'ACTIVE' as const, defaultPlatform: 'MOBILE' as const, defaultServerRegion: 'GLOBAL',
  defaultSuperCapacity: 23, defaultChampionCapacity: 18, defaultPromotionCount: 4,
  featuredSeason: null, version, createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z'
});

it('loads the protected platform league collection and renders an empty state', async () => {
  const request = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const api = { request } as unknown as AdminApi;
  render(<MemoryRouter><LeaguesPage api={api} /></MemoryRouter>);

  expect(await screen.findByText('暂无联赛')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/v1/admin/platform/leagues', expect.any(Object));
  expect(screen.getByRole('button', { name: '创建联赛' })).toBeInTheDocument();
});

it('reloads the latest league and version after an edit conflict', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce({ items: [league('旧名称', 1)], nextCursor: null })
    .mockRejectedValueOnce(new ApiError({ status: 409, code: 'VERSION_CONFLICT' }))
    .mockResolvedValueOnce({ items: [league('其他管理员的新名称', 2)], nextCursor: null });
  render(<MemoryRouter><LeaguesPage api={{ request } as unknown as AdminApi} /></MemoryRouter>);

  await userEvent.click(await screen.findByRole('button', { name: '编辑' }));
  const name = screen.getByLabelText('联赛名称');
  await userEvent.clear(name);
  await userEvent.type(name, '我的修改');
  await userEvent.click(screen.getByRole('button', { name: '保存联赛' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('已为你加载最新版本');
  await waitFor(() => expect(screen.getByLabelText('联赛名称')).toHaveValue('其他管理员的新名称'));
  expect(request).toHaveBeenNthCalledWith(2, '/v1/admin/platform/leagues/22222222-2222-4222-8222-222222222222', expect.objectContaining({
    method: 'PATCH', body: expect.objectContaining({ expectedVersion: 1 })
  }));
});

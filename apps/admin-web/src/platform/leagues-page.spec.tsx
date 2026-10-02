import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { ApiError } from '../lib/api';
import { LeaguesPage } from './leagues-page';

const league = (name: string, version: number) => ({
  id: '22222222-2222-4222-8222-222222222222', name, shortName: 'CELL', description: '', logoUrl: null,
  status: 'ACTIVE' as const, edition: 'INTERNATIONAL' as const,
  defaultSuperCapacity: 23, defaultChampionCapacity: 18, defaultPromotionCount: 4,
  currentSeason: null, version, createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z'
});

it('loads the protected platform league collection and renders an empty state', async () => {
  const request = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const api = { request } as unknown as AdminApi;
  render(<MemoryRouter><LeaguesPage api={api} /></MemoryRouter>);

  expect(await screen.findByText('暂无联赛')).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/v1/admin/platform/leagues', expect.any(Object));
  expect(screen.getByRole('button', { name: '创建联赛' })).toBeInTheDocument();
  expect(screen.queryByLabelText('游戏平台')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('服务器区域')).not.toBeInTheDocument();
  expect(screen.getByLabelText('版本')).toBeInTheDocument();
  expect(screen.getByText('支持 JPG、PNG、WebP，图片大小不超过 2MB')).toBeInTheDocument();
});

it('uploads a validated league image before creating the league', async () => {
  const request = vi.fn().mockResolvedValueOnce({ items: [], nextCursor: null })
    .mockResolvedValueOnce({ ...league('新联赛', 1), logoUrl: 'https://media.example/league.png' })
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  const upload = vi.fn().mockResolvedValue({
    key: 'league-images/test.png', url: 'https://media.example/league.png', mimeType: 'image/png', size: 128
  });
  const api = { request, upload } as unknown as AdminApi;
  const { container } = render(<MemoryRouter><LeaguesPage api={api} /></MemoryRouter>);

  await screen.findByText('暂无联赛');
  await userEvent.type(screen.getByLabelText('联赛名称'), '新联赛');
  await userEvent.type(screen.getByLabelText('联赛简称'), 'NEW');
  await userEvent.click(screen.getByLabelText('版本'));
  await userEvent.click(await screen.findByText('国服'));
  const file = new File(['png'], 'league.png', { type: 'image/png' });
  await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file);
  await userEvent.click(screen.getByRole('button', { name: '创建联赛' }));

  await waitFor(() => expect(upload).toHaveBeenCalledWith('/v1/admin/uploads/league-images', file, expect.anything()));
  expect(request).toHaveBeenNthCalledWith(2, '/v1/admin/platform/leagues', expect.objectContaining({
    method: 'POST',
    body: expect.objectContaining({ edition: 'NATIONAL', logoUrl: 'https://media.example/league.png' })
  }));
});

it('blocks unsupported or oversized league images before upload', async () => {
  const request = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const upload = vi.fn();
  const { container } = render(<MemoryRouter><LeaguesPage api={{ request, upload } as unknown as AdminApi} /></MemoryRouter>);
  await screen.findByText('暂无联赛');
  const choose = (file: File) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const files = {
      0: file,
      length: 1,
      item: (index: number) => index === 0 ? file : null,
      *[Symbol.iterator]() { yield file; }
    };
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: files
    });
    fireEvent.change(input);
  };

  choose(new File(['text'], 'league.txt', { type: 'text/plain' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('仅支持 JPG、PNG、WebP');
  const oversized = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' });
  choose(oversized);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('图片大小不能超过 2MB'));
  expect(upload).not.toHaveBeenCalled();
});

it('keeps an image upload failure visible and does not save the league', async () => {
  const request = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const upload = vi.fn().mockRejectedValue(new Error('storage unavailable'));
  const { container } = render(<MemoryRouter><LeaguesPage api={{ request, upload } as unknown as AdminApi} /></MemoryRouter>);
  await screen.findByText('暂无联赛');
  await userEvent.type(screen.getByLabelText('联赛名称'), '新联赛');
  await userEvent.type(screen.getByLabelText('联赛简称'), 'NEW');
  await userEvent.click(screen.getByLabelText('版本'));
  await userEvent.click(await screen.findByText('国际服'));
  await userEvent.upload(
    container.querySelector('input[type="file"]') as HTMLInputElement,
    new File(['png'], 'league.png', { type: 'image/png' })
  );
  await userEvent.click(screen.getByRole('button', { name: '创建联赛' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('联赛图片上传失败');
  expect(request).toHaveBeenCalledTimes(1);
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

it('renders a resilient league card with clear season and primary actions', async () => {
  const longName = '华东地区实况足球超级冠军联赛二〇二六秋季赛';
  const request = vi.fn().mockResolvedValue({ items: [league(longName, 1)], nextCursor: null });
  render(<MemoryRouter><LeaguesPage api={{ request } as unknown as AdminApi} /></MemoryRouter>);

  expect(await screen.findByRole('heading', { name: longName })).toHaveAttribute('title', longName);
  expect(screen.getByLabelText('CELL 联赛标识')).toBeInTheDocument();
  expect(screen.getByText('尚未设置当前赛季')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '进入联赛' })).toHaveAttribute('href', '/leagues/22222222-2222-4222-8222-222222222222/teams');
  expect(screen.getByRole('link', { name: '设置首个赛季' })).toHaveAttribute('href', '/leagues/22222222-2222-4222-8222-222222222222/seasons');
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../lib/api';
import { PlatformPresentationCard } from './platform-presentation-card';

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:banner-source'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => 2400,
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get: () => 1200,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob(['cropped-banner'], { type: 'image/webp' }));
  });
});

it('shows the current league center banner managed by platform administrators', async () => {
  const request = vi.fn().mockResolvedValue({
    leagueCenterBannerUrl: 'https://media.example.com/current.webp',
    version: 4,
  });

  render(<PlatformPresentationCard api={{ request } as unknown as AdminApi} />);

  expect(await screen.findByRole('img', { name: '当前联赛中心 Banner' }))
    .toHaveAttribute('src', 'https://media.example.com/current.webp');
  expect(request).toHaveBeenCalledWith('/v1/admin/platform/presentation', expect.any(Object));
});

it('crops a replacement banner before uploading and saving it', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce({ leagueCenterBannerUrl: null, version: 0 })
    .mockResolvedValueOnce({
      leagueCenterBannerUrl: 'https://media.example.com/replacement.webp',
      version: 1,
    });
  const upload = vi.fn().mockResolvedValue({
    key: 'league-center-banners--replacement.webp',
    url: 'https://media.example.com/replacement.webp',
    mimeType: 'image/webp',
    size: 256,
  });
  const { container } = render(
    <PlatformPresentationCard api={{ request, upload } as unknown as AdminApi} />,
  );

  await screen.findByText('尚未配置图片，前台会显示默认球场背景。');
  const file = new File(['RIFF0000WEBP'], 'banner.webp', { type: 'image/webp' });
  await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file);

  expect(await screen.findByRole('dialog', { name: '裁剪 Banner' })).toBeInTheDocument();
  fireEvent.load(screen.getByAltText('待裁剪 Banner 原图'));
  await userEvent.click(screen.getByRole('button', { name: '使用裁剪结果' }));
  await userEvent.click(screen.getByRole('button', { name: '上传并保存' }));

  await waitFor(() => expect(upload).toHaveBeenCalled());
  const uploadedFile = upload.mock.calls[0]?.[1] as File;
  expect(uploadedFile).not.toBe(file);
  expect(uploadedFile.name).toBe('banner-cropped.webp');
  expect(uploadedFile.type).toBe('image/webp');
  expect(request).toHaveBeenNthCalledWith(2, '/v1/admin/platform/presentation', expect.objectContaining({
    method: 'PATCH',
    body: {
      leagueCenterBannerUrl: 'https://media.example.com/replacement.webp',
      expectedVersion: 0,
    },
  }));
  expect(await screen.findByRole('img', { name: '当前联赛中心 Banner' }))
    .toHaveAttribute('src', 'https://media.example.com/replacement.webp');
});

import { z } from 'zod';

const BannerImageUrlSchema = z.url().refine(
  (value) => {
    if (value.startsWith('https://') || value.startsWith('cloud://')) return true;
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  },
  'Banner image URL must use HTTPS, CloudBase storage, or a local loopback host',
);

export const PlatformPresentationSchema = z.object({
  leagueCenterBannerUrl: BannerImageUrlSchema.nullable(),
  version: z.number().int().nonnegative(),
});

export const UpdatePlatformPresentationRequestSchema = z.object({
  leagueCenterBannerUrl: BannerImageUrlSchema.nullable(),
  expectedVersion: z.number().int().nonnegative(),
});

export type PlatformPresentation = z.infer<typeof PlatformPresentationSchema>;
export type UpdatePlatformPresentationRequest = z.infer<typeof UpdatePlatformPresentationRequestSchema>;

import { jest } from '@jest/globals';
import { PlatformPresentationService } from './platform-presentation.service.js';

describe('PlatformPresentationService', () => {
  it('returns a stable empty presentation before the first banner is configured', async () => {
    const prisma = {
      platformPresentation: { findUnique: jest.fn(async () => null) },
    };
    const service = new PlatformPresentationService(prisma as never, {} as never);

    await expect(service.get()).resolves.toEqual({
      leagueCenterBannerUrl: null,
      version: 0,
    });
  });

  it('creates the first banner at version one and records the administrator change', async () => {
    const createdAt = new Date('2026-10-05T12:00:00.000Z');
    const transaction = {
      platformPresentation: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          version: 1,
          updatedAt: createdAt,
        })),
      },
      auditLog: { create: jest.fn(async () => undefined) },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof transaction) => Promise<unknown>) => work(transaction)),
    };
    const audit = {
      record: jest.fn(async (client: unknown, input: unknown) => {
        expect(client).toBe(transaction);
        expect(input).toMatchObject({
          actorAdminId: 'admin-1',
          action: 'admin.platform-presentation.update',
          resourceType: 'PlatformPresentation',
        });
      }),
    };
    const service = new PlatformPresentationService(prisma as never, audit as never);

    await expect(service.update('admin-1', {
      leagueCenterBannerUrl: 'https://media.example.com/banner.webp',
      expectedVersion: 0,
    })).resolves.toEqual({
      leagueCenterBannerUrl: 'https://media.example.com/banner.webp',
      version: 1,
    });
    expect(transaction.platformPresentation.create).toHaveBeenCalledWith({
      data: {
        id: 'global',
        leagueCenterBannerUrl: 'https://media.example.com/banner.webp',
      },
    });
  });

  it('rejects a stale administrator update without replacing the current banner', async () => {
    const transaction = {
      platformPresentation: {
        findUnique: jest.fn(async () => ({
          id: 'global',
          leagueCenterBannerUrl: 'https://media.example.com/current.webp',
          version: 4,
        })),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof transaction) => Promise<unknown>) => work(transaction)),
    };
    const service = new PlatformPresentationService(prisma as never, {} as never);

    await expect(service.update('admin-1', {
      leagueCenterBannerUrl: 'https://media.example.com/stale.webp',
      expectedVersion: 3,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(transaction.platformPresentation.updateMany).not.toHaveBeenCalled();
  });
});

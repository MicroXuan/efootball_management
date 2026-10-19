import { jest } from '@jest/globals';
import { CatalogReadAuthGuard } from './catalog-read-auth.guard.js';

const context = (authorization?: string) => {
  const request = { headers: { authorization } };
  return { request, context: { switchToHttp: () => ({ getRequest: () => request }) } as never };
};

describe('CatalogReadAuthGuard', () => {
  const config = { getOrThrow: jest.fn(() => 'secret') };

  it('accepts an active user token and attaches the user', async () => {
    const jwt = { verifyAsync: jest.fn(async () => ({ sub: 'user-1' })) };
    const prisma = { user: { findUnique: jest.fn(async () => ({ id: 'user-1', status: 'ACTIVE' })) }, adminAccount: { findUnique: jest.fn() } };
    const guard = new CatalogReadAuthGuard(jwt as never, config as never, prisma as never);
    const target = context('Bearer user-token');
    await expect(guard.canActivate(target.context)).resolves.toBe(true);
    expect(target.request).toMatchObject({ user: { id: 'user-1', status: 'ACTIVE' } });
  });

  it('accepts an active administrator token without querying the user table', async () => {
    const jwt = { verifyAsync: jest.fn(async () => ({ sub: 'admin-1', actor: 'ADMIN' })) };
    const prisma = { user: { findUnique: jest.fn() }, adminAccount: { findUnique: jest.fn(async () => ({ id: 'admin-1', status: 'ACTIVE', platformRole: 'PLATFORM_ADMIN' })) } };
    const guard = new CatalogReadAuthGuard(jwt as never, config as never, prisma as never);
    const target = context('Bearer admin-token');
    await expect(guard.canActivate(target.context)).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(target.request).toMatchObject({ admin: { id: 'admin-1', status: 'ACTIVE' } });
  });

  it.each([undefined, 'Bearer invalid'])('rejects missing, invalid, or disabled identities', async (authorization) => {
    const jwt = { verifyAsync: jest.fn(async () => {
      if (authorization === 'Bearer invalid') return { sub: 'user-1' };
      throw new Error('invalid');
    }) };
    const prisma = { user: { findUnique: jest.fn(async () => ({ id: 'user-1', status: 'DISABLED' })) }, adminAccount: { findUnique: jest.fn() } };
    const guard = new CatalogReadAuthGuard(jwt as never, config as never, prisma as never);
    await expect(guard.canActivate(context(authorization).context)).rejects.toMatchObject({ status: 401 });
  });
});

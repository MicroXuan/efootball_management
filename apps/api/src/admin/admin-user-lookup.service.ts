import { HttpException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AdminError } from './admin.errors.js';

export const ADMIN_LOOKUP_RATE_LIMITER = Symbol('ADMIN_LOOKUP_RATE_LIMITER');

export interface AdminLookupRateLimiter {
  consume(adminId: string): void | Promise<void>;
}

@Injectable()
export class InMemoryAdminLookupRateLimiter implements AdminLookupRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  consume(adminId: string): void {
    const cutoff = Date.now() - 60_000;
    const recent = (this.buckets.get(adminId) ?? []).filter((time) => time > cutoff);
    if (recent.length >= 30) {
      throw new HttpException({
        code: 'ADMIN_USER_LOOKUP_RATE_LIMITED',
        message: 'Too many user-number lookups'
      }, 429);
    }
    recent.push(Date.now());
    this.buckets.set(adminId, recent);
  }
}

@Injectable()
export class AdminUserLookupService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ADMIN_LOOKUP_RATE_LIMITER) private readonly limiter: AdminLookupRateLimiter
  ) {}

  async findExact(adminId: string, publicUserNo: string) {
    await this.limiter.consume(adminId);
    const user = await this.prisma.user.findUnique({ where: { publicUserNo } });
    if (!user) throw new AdminError('PUBLIC_USER_NOT_FOUND', 'User was not found', 404);
    return {
      id: user.id,
      publicUserNo: user.publicUserNo!,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl
    };
  }
}

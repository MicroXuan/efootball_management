import { Inject, Injectable } from '@nestjs/common';
import type { ScopeType } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';

export type AuthorizationScope = {
  type: ScopeType;
  id: string;
};

@Injectable()
export class AuthorizationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async can(userId: string, permission: string, scope?: AuthorizationScope): Promise<boolean> {
    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        roleBindings: {
          where: {
            startsAt: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            role: { permissions: { some: { permission: { code: permission } } } }
          },
          select: { scopeType: true, scopeId: true }
        }
      }
    });
    if (!user || user.status !== 'ACTIVE') return false;

    return user.roleBindings.some((binding) =>
      binding.scopeType === 'PLATFORM'
      || (scope !== undefined
        && binding.scopeType === scope.type
        && binding.scopeId === scope.id)
    );
  }
}

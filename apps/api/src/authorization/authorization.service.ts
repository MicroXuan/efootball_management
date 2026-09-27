import { Inject, Injectable } from '@nestjs/common';
import type { ScopeType } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';

export type AuthorizationScope = {
  type: ScopeType;
  id: string;
};

export type AuthorizationTarget = {
  exact: AuthorizationScope;
  ancestors?: AuthorizationScope[];
};

type AuthorizationSubject = AuthorizationScope | AuthorizationTarget;

@Injectable()
export class AuthorizationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async can(userId: string, permission: string, subject?: AuthorizationSubject): Promise<boolean> {
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

    const scopes = subject === undefined
      ? []
      : 'exact' in subject
        ? [subject.exact, ...(subject.ancestors ?? [])]
        : [subject];

    return user.roleBindings.some((binding) => {
      if (binding.scopeType === 'PLATFORM') return true;
      return scopes.some((scope) =>
        binding.scopeType === scope.type && binding.scopeId === scope.id
      );
    });
  }
}

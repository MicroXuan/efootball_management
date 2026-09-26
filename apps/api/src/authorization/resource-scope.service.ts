import { Inject, Injectable } from '@nestjs/common';
import type { ScopeType } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthorizationTarget } from './authorization.service.js';

@Injectable()
export class ResourceScopeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolve(type: ScopeType, id: string): Promise<AuthorizationTarget | undefined> {
    if (type !== 'SEASON') {
      return { exact: { type, id }, ancestors: [] };
    }

    const season = await this.prisma.leagueSeason.findUnique({
      where: { id },
      select: { leagueId: true }
    });
    if (!season) return undefined;

    return {
      exact: { type: 'SEASON', id },
      ancestors: [{ type: 'LEAGUE', id: season.leagueId }]
    };
  }
}

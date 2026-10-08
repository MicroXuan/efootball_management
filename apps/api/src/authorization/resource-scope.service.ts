import { Inject, Injectable } from '@nestjs/common';
import type { ScopeType } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import type { AuthorizationTarget } from './authorization.service.js';

@Injectable()
export class ResourceScopeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LeagueVisibilityService) private readonly visibility: LeagueVisibilityService
  ) {}

  async resolve(type: ScopeType, id: string): Promise<AuthorizationTarget | undefined> {
    if (type === 'LEAGUE') {
      await this.visibility.requireVisible({ type: 'LEAGUE', id });
      return { exact: { type, id }, ancestors: [] };
    }
    if (type !== 'SEASON') {
      return { exact: { type, id }, ancestors: [] };
    }

    const season = await this.prisma.leagueSeason.findUnique({
      where: { id },
      select: { leagueId: true }
    });
    if (!season) return undefined;
    await this.visibility.requireVisible({ type: 'SEASON', id });

    return {
      exact: { type: 'SEASON', id },
      ancestors: [{ type: 'LEAGUE', id: season.leagueId }]
    };
  }
}

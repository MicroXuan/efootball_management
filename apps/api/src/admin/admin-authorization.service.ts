import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AdminError } from './admin.errors.js';

@Injectable()
export class AdminAuthorizationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async requirePlatformAdmin(adminId: string) {
    const admin = await this.prisma.adminAccount.findUnique({ where: { id: adminId } });
    if (!admin || admin.status !== 'ACTIVE' || admin.platformRole !== 'PLATFORM_ADMIN') {
      throw new AdminError(
        'ADMIN_PLATFORM_ACCESS_DENIED',
        'Platform administrator access is required',
        403
      );
    }
    return admin;
  }

  async requireLeagueManager(adminId: string, leagueId: string) {
    const admin = await this.prisma.adminAccount.findUnique({
      where: { id: adminId },
      include: {
        leagueRoles: {
          where: { leagueId, role: 'LEAGUE_MANAGER', revokedAt: null },
          take: 1
        }
      }
    });
    if (!admin || admin.status !== 'ACTIVE'
      || (admin.platformRole !== 'PLATFORM_ADMIN' && admin.leagueRoles.length === 0)) {
      throw new AdminError(
        'ADMIN_LEAGUE_ACCESS_DENIED',
        'Administrator is not assigned to this league',
        403
      );
    }
    return admin;
  }
}

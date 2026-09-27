import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { GameAccountUsagePort } from '../users/game-account-usage.port.js';

@Injectable()
export class RegistrationUsageAdapter implements GameAccountUsagePort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async hasActiveReferences(accountId: string): Promise<boolean> {
    const [registrationCount, profileCount, seasonEntryCount] = await Promise.all([
      this.prisma.competitionRegistration.count({
        where: {
          gameAccountId: accountId,
          status: { in: ['PENDING', 'APPROVED'] },
          competition: { status: { notIn: ['COMPLETED', 'CANCELLED'] } }
        }
      }),
      this.prisma.teamProfile.count({
        where: { defaultGameAccountId: accountId, status: 'ACTIVE' }
      }),
      this.prisma.seasonEntry.count({
        where: {
          gameAccountId: accountId,
          status: { in: ['INVITED', 'PENDING', 'APPROVED'] },
          season: { status: { notIn: ['COMPLETED', 'CANCELLED'] } }
        }
      })
    ]);
    return registrationCount + profileCount + seasonEntryCount > 0;
  }
}

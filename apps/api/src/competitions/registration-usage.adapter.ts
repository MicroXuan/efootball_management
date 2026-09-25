import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { GameAccountUsagePort } from '../users/game-account-usage.port.js';

@Injectable()
export class RegistrationUsageAdapter implements GameAccountUsagePort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async hasActiveReferences(accountId: string): Promise<boolean> {
    const count = await this.prisma.competitionRegistration.count({
      where: {
        gameAccountId: accountId,
        status: { in: ['PENDING', 'APPROVED'] },
        competition: { status: { notIn: ['COMPLETED', 'CANCELLED'] } }
      }
    });
    return count > 0;
  }
}

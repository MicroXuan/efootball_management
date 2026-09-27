import { Inject, Injectable } from '@nestjs/common';
import type {
  ParsedCreateTeamProfileRequest,
  TeamProfileResponse,
  UpdateTeamProfileRequest
} from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { TeamProfile } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError } from './league.errors.js';

@Injectable()
export class TeamProfilesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<TeamProfileResponse | null> {
    const profile = await this.prisma.teamProfile.findUnique({
      where: { ownerUserId: userId }
    });
    return profile ? this.response(profile) : null;
  }

  async create(
    userId: string,
    input: ParsedCreateTeamProfileRequest
  ): Promise<TeamProfileResponse> {
    await this.assertOwnedAccount(userId, input.defaultGameAccountId);
    try {
      const profile = await this.prisma.teamProfile.create({
        data: {
          ownerUserId: userId,
          name: input.name,
          shortName: input.shortName,
          logoUrl: input.logoUrl,
          defaultGameAccountId: input.defaultGameAccountId
        }
      });
      return this.response(profile);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new LeagueError(
          'TEAM_PROFILE_ALREADY_EXISTS',
          'A team profile already exists for this user',
          409
        );
      }
      throw error;
    }
  }

  async update(userId: string, input: UpdateTeamProfileRequest): Promise<TeamProfileResponse> {
    if (input.defaultGameAccountId !== undefined) {
      await this.assertOwnedAccount(userId, input.defaultGameAccountId);
    }

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM team_profiles WHERE owner_user_id = ${userId} FOR UPDATE`;
      const existing = await transaction.teamProfile.findUnique({
        where: { ownerUserId: userId }
      });
      if (!existing) {
        throw new LeagueError('TEAM_PROFILE_NOT_FOUND', 'Team profile was not found', 404);
      }

      const updated = await transaction.teamProfile.updateMany({
        where: { id: existing.id, version: input.expectedVersion },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
          ...(input.defaultGameAccountId !== undefined
            ? { defaultGameAccountId: input.defaultGameAccountId }
            : {}),
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        throw new LeagueError('VERSION_CONFLICT', 'Team profile has changed', 409);
      }
      const profile = await transaction.teamProfile.findUniqueOrThrow({
        where: { id: existing.id }
      });
      return this.response(profile);
    });
  }

  private async assertOwnedAccount(userId: string, accountId: string): Promise<void> {
    const account = await this.prisma.gameAccount.findFirst({
      where: { id: accountId, userId },
      select: { id: true }
    });
    if (!account) {
      throw new LeagueError(
        'GAME_ACCOUNT_NOT_OWNED',
        'The selected game account does not belong to this user',
        400
      );
    }
  }

  private response(profile: TeamProfile): TeamProfileResponse {
    return {
      id: profile.id,
      ownerUserId: profile.ownerUserId,
      name: profile.name,
      shortName: profile.shortName,
      logoUrl: profile.logoUrl,
      defaultGameAccountId: profile.defaultGameAccountId,
      status: profile.status,
      version: profile.version,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString()
    };
  }
}

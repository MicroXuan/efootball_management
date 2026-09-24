import { Inject, Injectable } from '@nestjs/common';
import type { CurrentUserResponse, UpdateProfileRequest } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCurrent(userId: string): Promise<CurrentUserResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.response(user);
  }

  async updateCurrent(userId: string, input: UpdateProfileRequest): Promise<CurrentUserResponse> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        region: input.region
      }
    });
    return this.response(user);
  }

  private response(user: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    region: string | null;
    status: 'ACTIVE' | 'DISABLED';
  }): CurrentUserResponse {
    return {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      region: user.region,
      status: 'ACTIVE',
      profileComplete: Boolean(user.displayName && user.avatarUrl && user.region)
    };
  }
}

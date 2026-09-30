import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
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
    publicUserNo: string | null;
    displayName: string;
    avatarUrl: string | null;
    region: string | null;
    status: 'ACTIVE' | 'DISABLED';
  }): CurrentUserResponse {
    if (!user.publicUserNo) {
      throw new InternalServerErrorException({
        code: 'PUBLIC_USER_NUMBER_UNAVAILABLE',
        message: 'The current user does not have a public number'
      });
    }
    return {
      id: user.id,
      publicUserNo: user.publicUserNo,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      region: user.region,
      status: 'ACTIVE',
      profileComplete: Boolean(user.displayName && user.avatarUrl && user.region)
    };
  }
}

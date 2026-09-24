import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { GameAccountResponse, ParsedGameAccountInput } from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { GameAccount } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { GAME_ACCOUNT_USAGE_PORT } from './game-account-usage.port.js';
import type { GameAccountUsagePort } from './game-account-usage.port.js';

@Injectable()
export class GameAccountsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GAME_ACCOUNT_USAGE_PORT) private readonly usage: GameAccountUsagePort
  ) {}

  async list(userId: string): Promise<GameAccountResponse[]> {
    const accounts = await this.prisma.gameAccount.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
    });
    return accounts.map((account) => this.response(account));
  }

  async create(userId: string, input: ParsedGameAccountInput): Promise<GameAccountResponse> {
    try {
      const account = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        const count = await transaction.gameAccount.count({ where: { userId } });
        const makeDefault = input.isDefault || count === 0;
        if (makeDefault) {
          await transaction.gameAccount.updateMany({ where: { userId }, data: { isDefault: false } });
        }
        return transaction.gameAccount.create({
          data: {
            userId,
            platform: input.platform,
            serverRegion: input.serverRegion,
            gamerTag: input.gamerTag,
            gameUid: input.gameUid ?? null,
            isDefault: makeDefault
          }
        });
      });
      return this.response(account);
    } catch (error) {
      this.rethrowIdentityConflict(error);
    }
  }

  async update(
    userId: string,
    accountId: string,
    input: ParsedGameAccountInput
  ): Promise<GameAccountResponse> {
    try {
      const account = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        const existing = await transaction.gameAccount.findFirst({
          where: { id: accountId, userId }
        });
        if (!existing) throw this.notFound();

        if (input.isDefault) {
          await transaction.gameAccount.updateMany({ where: { userId }, data: { isDefault: false } });
        }
        return transaction.gameAccount.update({
          where: { id: accountId },
          data: {
            platform: input.platform,
            serverRegion: input.serverRegion,
            gamerTag: input.gamerTag,
            gameUid: input.gameUid ?? null,
            isDefault: input.isDefault ? true : existing.isDefault
          }
        });
      });
      return this.response(account);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.rethrowIdentityConflict(error);
    }
  }

  async delete(userId: string, accountId: string): Promise<{ ok: true }> {
    const existing = await this.prisma.gameAccount.findFirst({ where: { id: accountId, userId } });
    if (!existing) throw this.notFound();
    if (await this.usage.hasActiveReferences(accountId)) {
      throw new ConflictException({
        code: 'GAME_ACCOUNT_IN_USE',
        message: 'Game account is referenced by an active competition'
      });
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const selected = await transaction.gameAccount.findFirst({ where: { id: accountId, userId } });
      if (!selected) throw this.notFound();
      await transaction.gameAccount.delete({ where: { id: selected.id } });
      if (selected.isDefault) {
        const replacement = await transaction.gameAccount.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' }
        });
        if (replacement) {
          await transaction.gameAccount.update({
            where: { id: replacement.id },
            data: { isDefault: true }
          });
        }
      }
    });
    return { ok: true };
  }

  private response(account: GameAccount): GameAccountResponse {
    return {
      id: account.id,
      platform: account.platform,
      serverRegion: account.serverRegion,
      gamerTag: account.gamerTag,
      gameUid: account.gameUid,
      isDefault: account.isDefault,
      verificationStatus: account.verificationStatus,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString()
    };
  }

  private rethrowIdentityConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException({
        code: 'GAME_ACCOUNT_ALREADY_BOUND',
        message: 'This game identity is already bound'
      });
    }
    throw error;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'GAME_ACCOUNT_NOT_FOUND',
      message: 'Game account was not found'
    });
  }
}

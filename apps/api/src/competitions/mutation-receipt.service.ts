import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError } from './competition.errors.js';
import type { MutationResult, MutationWork } from './competition.types.js';

function jsonRoundTrip<T extends MutationResult>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

@Injectable()
export class MutationReceiptService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async execute<T extends MutationResult>(
    actorId: string,
    operation: string,
    key: string,
    work: MutationWork<T>
  ): Promise<T> {
    const normalizedKey = key.trim();
    if (!normalizedKey || normalizedKey.length > 128) {
      throw new CompetitionError(
        'IDEMPOTENCY_KEY_INVALID',
        'Idempotency key must contain between 1 and 128 characters',
        400
      );
    }

    const request = { actorId, operation, key: normalizedKey };
    const existing = await this.prisma.mutationReceipt.findUnique({
      where: { actorId_operation_key: request }
    });
    if (existing?.resultJson !== null && existing?.resultJson !== undefined) {
      return jsonRoundTrip(existing.resultJson as T);
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const receipt = await transaction.mutationReceipt.create({ data: request });
        const result = jsonRoundTrip(await work(transaction));
        await transaction.mutationReceipt.update({
          where: { id: receipt.id },
          data: { resultJson: result }
        });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.mutationReceipt.findUnique({
          where: { actorId_operation_key: request }
        });
        if (winner?.resultJson !== null && winner?.resultJson !== undefined) {
          return jsonRoundTrip(winner.resultJson as T);
        }
      }
      throw error;
    }
  }
}

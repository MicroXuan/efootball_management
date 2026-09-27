import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminError } from './admin.errors.js';

type JsonResult = Record<string, unknown> | unknown[];
type AdminWork<T extends JsonResult> = (transaction: Prisma.TransactionClient) => Promise<T>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

@Injectable()
export class AdminMutationReceiptService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async execute<T extends JsonResult>(
    adminId: string,
    operation: string,
    key: string,
    work: AdminWork<T>
  ): Promise<T> {
    const normalizedKey = key.trim();
    if (!normalizedKey || normalizedKey.length > 128) {
      throw new AdminError(
        'IDEMPOTENCY_KEY_INVALID',
        'Idempotency key must contain between 1 and 128 characters',
        400
      );
    }
    const unique = { adminId, operation, key: normalizedKey };
    const existing = await this.prisma.adminMutationReceipt.findUnique({
      where: { adminId_operation_key: unique }
    });
    if (existing?.resultJson !== null && existing?.resultJson !== undefined) {
      return clone(existing.resultJson as T);
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const receipt = await transaction.adminMutationReceipt.create({ data: unique });
        const result = clone(await work(transaction));
        await transaction.adminMutationReceipt.update({
          where: { id: receipt.id },
          data: { resultJson: result as Prisma.InputJsonValue }
        });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.adminMutationReceipt.findUnique({
          where: { adminId_operation_key: unique }
        });
        if (winner?.resultJson !== null && winner?.resultJson !== undefined) {
          return clone(winner.resultJson as T);
        }
      }
      throw error;
    }
  }
}

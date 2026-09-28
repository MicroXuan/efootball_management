import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminError } from './admin.errors.js';

type JsonResult = Record<string, unknown> | unknown[];
type AdminWork<T extends JsonResult> = (transaction: Prisma.TransactionClient) => Promise<T>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function hashRequest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

@Injectable()
export class AdminMutationReceiptService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async execute<T extends JsonResult>(
    adminId: string,
    operation: string,
    key: string,
    work: AdminWork<T>,
    requestPayload?: unknown
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
    const requestHash = requestPayload === undefined ? null : hashRequest(requestPayload);
    const existing = await this.prisma.adminMutationReceipt.findUnique({
      where: { adminId_operation_key: unique }
    });
    if (existing?.resultJson !== null && existing?.resultJson !== undefined) {
      this.assertMatchingRequest(existing.requestHash, requestHash);
      return clone(existing.resultJson as T);
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const receipt = await transaction.adminMutationReceipt.create({
          data: { ...unique, requestHash }
        });
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
          this.assertMatchingRequest(winner.requestHash, requestHash);
          return clone(winner.resultJson as T);
        }
      }
      throw error;
    }
  }

  private assertMatchingRequest(storedHash: string | null, requestHash: string | null) {
    if (storedHash !== requestHash) {
      throw new AdminError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was already used for a different request',
        409
      );
    }
  }
}

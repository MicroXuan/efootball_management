import type { Prisma } from '../generated/prisma/client.js';

export type CompetitionTransaction = Prisma.TransactionClient;
export type MutationResult = Prisma.InputJsonValue;
export type MutationWork<T extends MutationResult> = (
  transaction: CompetitionTransaction
) => Promise<T>;

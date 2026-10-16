import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { CompetitionTransaction } from './competition.types.js';

export type AppendMatchResultEvent = Pick<Prisma.MatchResultEventCreateManyInput,
  'matchId' | 'type' | 'eventKey' | 'actorType' | 'occurredAt'
> & Pick<Prisma.MatchResultEventCreateManyInput,
  'disputeId' | 'resultVersionId' | 'actorUserId' | 'actorAdminId' | 'metadata'
>;

@Injectable()
export class MatchResultEventsService {
  async append(transaction: CompetitionTransaction, event: AppendMatchResultEvent): Promise<void> {
    await transaction.matchResultEvent.createMany({ data: event, skipDuplicates: true });
  }
}

import { Inject, Injectable } from '@nestjs/common';
import type { CompetitionMatchResponse } from '@efm/contracts';
import type { CompetitionParticipant, CompetitionStage, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError, assertExpectedVersion } from './competition.errors.js';
import type { CompetitionTransaction } from './competition.types.js';
import type { generateRoundRobin } from './domain/round-robin.js';
import { MutationReceiptService } from './mutation-receipt.service.js';

export type PublishScheduleInput = {
  expectedCompetitionVersion: number;
  expectedStageVersion: number;
};

export type ScheduleGenerator = typeof generateRoundRobin;
export const SCHEDULE_GENERATOR = Symbol('SCHEDULE_GENERATOR');

type MatchRecord = Prisma.CompetitionMatchGetPayload<{
  include: {
    homeParticipant: true;
    awayParticipant: true;
    officialResultVersion: true;
  };
}>;

export type ScheduleMatch = CompetitionMatchResponse & { pairingKey: string };

export type SchedulePreview = {
  id: string;
  competitionId: string;
  status: CompetitionStage['status'];
  version: number;
  roundCount: number;
  matchCount: number;
  matches: ScheduleMatch[];
};

@Injectable()
export class SchedulesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService,
    @Inject(SCHEDULE_GENERATOR) private readonly generator: ScheduleGenerator
  ) {}

  generate(actorId: string, competitionId: string, key: string): Promise<SchedulePreview> {
    return this.receipts.execute(actorId, `competition.schedule.generate:${competitionId}`, key, async (transaction) => {
      await this.lockCompetition(transaction, competitionId);
      const competition = await transaction.competition.findUnique({ where: { id: competitionId } });
      if (!competition) throw this.notFound();
      const published = await transaction.competitionStage.findFirst({
        where: { competitionId, status: 'PUBLISHED' }
      });
      if (published) {
        throw new CompetitionError('SCHEDULE_ALREADY_PUBLISHED', 'Published schedule cannot be replaced', 409);
      }
      if (competition.status !== 'REGISTRATION_CLOSED') {
        throw new CompetitionError(
          'SCHEDULE_GENERATION_NOT_ALLOWED',
          'Schedule generation requires closed registration',
          409
        );
      }
      const participants = await transaction.competitionParticipant.findMany({
        where: { competitionId },
        orderBy: [{ admissionSequence: 'asc' }, { id: 'asc' }]
      });
      if (participants.length < 2) {
        throw new CompetitionError(
          'SCHEDULE_PARTICIPANTS_INSUFFICIENT',
          'At least two approved participants are required',
          409
        );
      }
      const pairings = this.generator(participants.map(({ id }) => id));
      const drafts = await transaction.competitionStage.findMany({
        where: { competitionId, status: 'DRAFT' }, select: { id: true }
      });
      const draftIds = drafts.map(({ id }) => id);
      if (draftIds.length > 0) {
        await transaction.competitionMatch.deleteMany({ where: { stageId: { in: draftIds } } });
        await transaction.competitionStage.deleteMany({ where: { id: { in: draftIds } } });
      }
      const stage = await transaction.competitionStage.create({
        data: { competitionId, sequence: 1, format: competition.format }
      });
      await transaction.competitionMatch.createMany({
        data: pairings.map((pairing) => ({ stageId: stage.id, ...pairing }))
      });
      return this.readPreview(transaction, competitionId, 'DRAFT');
    });
  }

  preview(competitionId: string): Promise<SchedulePreview> {
    return this.readPreview(this.prisma, competitionId);
  }

  publish(
    actorId: string,
    competitionId: string,
    input: PublishScheduleInput,
    key: string
  ): Promise<SchedulePreview> {
    return this.receipts.execute(actorId, `competition.schedule.publish:${competitionId}`, key, async (transaction) => {
      await this.lockCompetition(transaction, competitionId);
      const competition = await transaction.competition.findUnique({ where: { id: competitionId } });
      if (!competition) throw this.notFound();
      assertExpectedVersion(competition.version, input.expectedCompetitionVersion, 'Competition');
      if (competition.status !== 'REGISTRATION_CLOSED') {
        throw new CompetitionError('SCHEDULE_PUBLISH_NOT_ALLOWED', 'Schedule cannot be published now', 409);
      }
      const stage = await transaction.competitionStage.findFirst({ where: { competitionId, status: 'DRAFT' } });
      if (!stage) throw new CompetitionError('SCHEDULE_DRAFT_NOT_FOUND', 'Draft schedule was not found', 404);
      assertExpectedVersion(stage.version, input.expectedStageVersion, 'Schedule');

      const stageUpdate = await transaction.competitionStage.updateMany({
        where: { id: stage.id, status: 'DRAFT', version: input.expectedStageVersion },
        data: { status: 'PUBLISHED', publishedAt: new Date(), version: { increment: 1 } }
      });
      const competitionUpdate = await transaction.competition.updateMany({
        where: { id: competitionId, status: 'REGISTRATION_CLOSED', version: input.expectedCompetitionVersion },
        data: { status: 'SCHEDULED', version: { increment: 1 } }
      });
      if (stageUpdate.count !== 1 || competitionUpdate.count !== 1) {
        throw new CompetitionError('VERSION_CONFLICT', 'Schedule or competition has changed', 409);
      }
      return this.readPreview(transaction, competitionId, 'PUBLISHED');
    });
  }

  async listPublic(competitionId: string): Promise<ScheduleMatch[]> {
    const stage = await this.prisma.competitionStage.findFirst({
      where: { competitionId, status: 'PUBLISHED' }, select: { id: true }
    });
    if (!stage) return [];
    const matches = await this.matches(this.prisma, stage.id);
    return matches.map((match) => this.matchResponse(match));
  }

  private async readPreview(
    client: CompetitionTransaction | PrismaService,
    competitionId: string,
    status?: CompetitionStage['status']
  ): Promise<SchedulePreview> {
    const stage = await client.competitionStage.findFirst({
      where: { competitionId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' }
    });
    if (!stage) throw new CompetitionError('SCHEDULE_NOT_FOUND', 'Schedule was not found', 404);
    const matches = await this.matches(client, stage.id);
    const responses = matches.map((match) => this.matchResponse(match));
    return {
      id: stage.id,
      competitionId,
      status: stage.status,
      version: stage.version,
      roundCount: Math.max(0, ...matches.map(({ roundNumber }) => roundNumber)),
      matchCount: matches.length,
      matches: responses
    };
  }

  private matches(client: CompetitionTransaction | PrismaService, stageId: string): Promise<MatchRecord[]> {
    return client.competitionMatch.findMany({
      where: { stageId },
      include: { homeParticipant: true, awayParticipant: true, officialResultVersion: true },
      orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }]
    });
  }

  private matchResponse(match: MatchRecord): ScheduleMatch {
    return {
      id: match.id,
      competitionId: match.homeParticipant.competitionId,
      stageId: match.stageId,
      roundNumber: match.roundNumber,
      pairingKey: match.pairingKey,
      matchNumber: match.matchNumber,
      homeParticipant: this.participant(match.homeParticipant),
      awayParticipant: this.participant(match.awayParticipant),
      plannedAt: match.plannedAt?.toISOString() ?? null,
      status: match.status,
      version: match.version,
      officialResult: match.officialResultVersion ? {
        resultVersionId: match.officialResultVersion.id,
        version: match.officialResultVersion.version,
        homeScore: match.officialResultVersion.homeScore,
        awayScore: match.officialResultVersion.awayScore,
        status: match.officialResultVersion.status === 'SUPERSEDED' ? 'SUPERSEDED' : 'OFFICIAL'
      } : null,
      resultVersions: [],
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString()
    };
  }

  private participant(participant: CompetitionParticipant) {
    return {
      id: participant.id,
      displayName: participant.displayNameSnapshot,
      participantType: participant.participantType
    };
  }

  private lockCompetition(transaction: CompetitionTransaction, competitionId: string): Promise<unknown> {
    return transaction.$queryRaw`SELECT id FROM competitions WHERE id = ${competitionId} FOR UPDATE`;
  }

  private notFound(): CompetitionError {
    return new CompetitionError('COMPETITION_NOT_FOUND', 'Competition was not found', 404);
  }
}

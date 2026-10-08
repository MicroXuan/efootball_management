import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  CompetitionRegistrationResponse,
  RegisterCompetitionRequest,
  ReviewRegistrationRequest,
  VersionedMutationRequest
} from '@efm/contracts';
import type { CompetitionRegistration } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError, assertExpectedVersion } from './competition.errors.js';
import type { CompetitionTransaction } from './competition.types.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

export interface CompetitionClock {
  now(): Date;
}

export const COMPETITION_CLOCK = Symbol('COMPETITION_CLOCK');

@Injectable()
export class SystemCompetitionClock implements CompetitionClock {
  now(): Date {
    return new Date();
  }
}

@Injectable()
export class RegistrationsService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService,
    @Inject(COMPETITION_CLOCK) private readonly clock: CompetitionClock,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async register(
    userId: string,
    competitionId: string,
    input: RegisterCompetitionRequest,
    key: string
  ): Promise<CompetitionRegistrationResponse> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    return this.receipts.execute(userId, `competition.register:${competitionId}`, key, async (transaction) => {
      await this.lockCompetition(transaction, competitionId);
      const competition = await transaction.competition.findUnique({ where: { id: competitionId } });
      if (!competition) throw this.notFound();
      this.assertRegistrationOpen(competition.status, competition.registrationOpensAt, competition.registrationClosesAt);
      if (input.acceptedRuleVersion !== competition.boundRuleVersion) {
        throw new CompetitionError('COMPETITION_RULE_VERSION_CHANGED', 'Competition rules have changed', 409);
      }
      const account = await transaction.gameAccount.findFirst({
        where: { id: input.gameAccountId, userId }
      });
      if (!account) throw new CompetitionError('GAME_ACCOUNT_NOT_FOUND', 'Game account was not found', 404);
      if (account.platform !== competition.platform || account.serverRegion !== competition.serverRegion) {
        throw new CompetitionError('GAME_ACCOUNT_INELIGIBLE', 'Game account does not match competition eligibility', 409);
      }

      const existing = await transaction.competitionRegistration.findUnique({
        where: { competitionId_applicantId: { competitionId, applicantId: userId } }
      });
      if (existing?.status === 'PENDING' || existing?.status === 'APPROVED') return this.response(existing);

      const activeCount = await transaction.competitionRegistration.count({
        where: { competitionId, status: { in: ['PENDING', 'APPROVED'] } }
      });
      if (activeCount >= competition.participantLimit) {
        throw new CompetitionError('REGISTRATION_FULL', 'Competition registration is full', 409);
      }

      if (existing) {
        const updated = await transaction.competitionRegistration.update({
          where: { id: existing.id },
          data: {
            gameAccountId: input.gameAccountId,
            acceptedRuleVersion: input.acceptedRuleVersion,
            status: 'PENDING',
            reviewedById: null,
            reviewReason: null,
            reviewedAt: null,
            withdrawnAt: null,
            version: { increment: 1 }
          }
        });
        await this.history(transaction, updated.id, existing.status, 'PENDING', userId);
        return this.response(updated);
      }

      const created = await transaction.competitionRegistration.create({
        data: {
          competitionId,
          applicantId: userId,
          gameAccountId: input.gameAccountId,
          acceptedRuleVersion: input.acceptedRuleVersion
        }
      });
      await this.history(transaction, created.id, null, 'PENDING', userId);
      return this.response(created);
    });
  }

  async withdraw(
    userId: string,
    competitionId: string,
    input: VersionedMutationRequest,
    key: string
  ): Promise<CompetitionRegistrationResponse> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    return this.receipts.execute(userId, `competition.withdraw:${competitionId}`, key, async (transaction) => {
      await this.lockCompetition(transaction, competitionId);
      const competition = await transaction.competition.findUnique({ where: { id: competitionId } });
      if (!competition) throw this.notFound();
      this.assertRegistrationOpen(competition.status, competition.registrationOpensAt, competition.registrationClosesAt);
      const registration = await transaction.competitionRegistration.findUnique({
        where: { competitionId_applicantId: { competitionId, applicantId: userId } }
      });
      if (!registration) throw new CompetitionError('REGISTRATION_NOT_FOUND', 'Registration was not found', 404);
      assertExpectedVersion(registration.version, input.expectedVersion, 'Registration');
      if (!['PENDING', 'APPROVED'].includes(registration.status)) {
        throw new CompetitionError('REGISTRATION_STATE_INVALID', 'Registration cannot be withdrawn', 409);
      }
      await transaction.competitionParticipant.deleteMany({ where: { registrationId: registration.id } });
      const updated = await transaction.competitionRegistration.update({
        where: { id: registration.id },
        data: { status: 'WITHDRAWN', withdrawnAt: this.clock.now(), version: { increment: 1 } }
      });
      await this.history(transaction, updated.id, registration.status, 'WITHDRAWN', userId);
      return this.response(updated);
    });
  }

  async review(
    actorId: string,
    competitionId: string,
    registrationId: string,
    input: ReviewRegistrationRequest,
    key: string
  ): Promise<CompetitionRegistrationResponse> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    return this.receipts.execute(actorId, `competition.registration.review:${registrationId}`, key, async (transaction) => {
      await this.lockCompetition(transaction, competitionId);
      const registration = await transaction.competitionRegistration.findFirst({
        where: { id: registrationId, competitionId },
        include: { applicant: true }
      });
      if (!registration) throw new CompetitionError('REGISTRATION_NOT_FOUND', 'Registration was not found', 404);
      if (registration.status === 'APPROVED' && input.decision === 'APPROVE') return this.response(registration);
      assertExpectedVersion(registration.version, input.expectedVersion, 'Registration');
      if (registration.status !== 'PENDING') {
        throw new CompetitionError('REGISTRATION_STATE_INVALID', 'Registration is not pending review', 409);
      }

      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (status === 'REJECTED' && !input.reason?.trim()) {
        throw new CompetitionError('REGISTRATION_REJECTION_REASON_REQUIRED', 'Rejection reason is required', 400);
      }
      if (status === 'APPROVED') {
        const competition = await transaction.competition.findUniqueOrThrow({ where: { id: competitionId } });
        const participantCount = await transaction.competitionParticipant.count({ where: { competitionId } });
        if (participantCount >= competition.participantLimit) {
          throw new CompetitionError('REGISTRATION_FULL', 'Competition registration is full', 409);
        }
        const last = await transaction.competitionParticipant.aggregate({
          where: { competitionId }, _max: { admissionSequence: true }
        });
        await transaction.competitionParticipant.create({
          data: {
            competitionId,
            participantType: 'INDIVIDUAL',
            registrationId,
            individualUserId: registration.applicantId,
            admissionSequence: (last._max.admissionSequence ?? 0) + 1,
            displayNameSnapshot: registration.applicant.displayName
          }
        });
      }
      const updated = await transaction.competitionRegistration.update({
        where: { id: registration.id },
        data: {
          status,
          reviewedById: actorId,
          reviewReason: input.reason?.trim() || null,
          reviewedAt: this.clock.now(),
          version: { increment: 1 }
        }
      });
      await this.history(transaction, updated.id, registration.status, status, actorId, input.reason);
      return this.response(updated);
    });
  }

  async getMine(userId: string, competitionId: string): Promise<CompetitionRegistrationResponse | null> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    const registration = await this.prisma.competitionRegistration.findUnique({
      where: { competitionId_applicantId: { competitionId, applicantId: userId } }
    });
    return registration ? this.response(registration) : null;
  }

  async listForManager(competitionId: string): Promise<CompetitionRegistrationResponse[]> {
    await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    const registrations = await this.prisma.competitionRegistration.findMany({
      where: { competitionId },
      include: { applicant: true, gameAccount: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    return registrations.map((registration) => ({
      ...this.response(registration),
      applicantDisplayName: registration.applicant.displayName,
      gameAccountGamerTag: registration.gameAccount?.gamerTag
    }));
  }

  private assertRegistrationOpen(status: string, opensAt: Date, closesAt: Date): void {
    const now = this.clock.now().getTime();
    if (status !== 'REGISTRATION_OPEN' || now < opensAt.getTime() || now >= closesAt.getTime()) {
      throw new CompetitionError('REGISTRATION_CLOSED', 'Competition registration is closed', 409);
    }
  }

  private lockCompetition(transaction: CompetitionTransaction, competitionId: string): Promise<unknown> {
    return transaction.$queryRaw`SELECT id FROM competitions WHERE id = ${competitionId} FOR UPDATE`;
  }

  private history(
    transaction: CompetitionTransaction,
    registrationId: string,
    fromStatus: CompetitionRegistration['status'] | null,
    toStatus: CompetitionRegistration['status'],
    actorId: string,
    reason?: string | null
  ) {
    return transaction.competitionRegistrationStatusHistory.create({
      data: { registrationId, fromStatus, toStatus, actorId, reason: reason?.trim() || null }
    });
  }

  private response(registration: CompetitionRegistration): CompetitionRegistrationResponse {
    if (!registration.gameAccountId) {
      throw new CompetitionError('GAME_ACCOUNT_NOT_FOUND', 'Individual competition registration has no game account', 409);
    }
    return {
      id: registration.id,
      competitionId: registration.competitionId,
      applicantId: registration.applicantId,
      gameAccountId: registration.gameAccountId,
      acceptedRuleVersion: registration.acceptedRuleVersion,
      status: registration.status,
      reviewReason: registration.reviewReason,
      reviewedAt: registration.reviewedAt?.toISOString() ?? null,
      withdrawnAt: registration.withdrawnAt?.toISOString() ?? null,
      version: registration.version,
      createdAt: registration.createdAt.toISOString(),
      updatedAt: registration.updatedAt.toISOString()
    };
  }

  private notFound(): CompetitionError {
    return new CompetitionError('COMPETITION_NOT_FOUND', 'Competition was not found', 404);
  }
}

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional, StreamableFile } from '@nestjs/common';
import type { CompleteEvidenceUploadRequest, CreateEvidenceUploadRequest } from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PRISMA_TRANSACTION_OPTIONS, PrismaService } from '../database/prisma.service.js';
import { MAX_RESULT_EVIDENCE_BYTES, validateResultEvidenceImage } from '../storage/image-validation.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/object-storage.js';
import { CompetitionError, assertExpectedVersion } from './competition.errors.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { retainedEvidenceKey } from '../storage/evidence-object-keys.js';

const UPLOAD_LIFETIME_MS = 10 * 60 * 1000;
const READ_LIFETIME_SECONDS = 10 * 60;

type Match = Prisma.CompetitionMatchGetPayload<{
  include: {
    stage: { include: { competition: { include: { season: { include: { league: true } } } } } };
    homeParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } };
    awayParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } };
  };
}>;

@Injectable()
export class ResultEvidenceStorageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Optional() @Inject(AdminAuthorizationService) private readonly authorization?: AdminAuthorizationService
  ) {}

  async createAdminUpload(adminId: string, leagueId: string, matchId: string, input: CreateEvidenceUploadRequest) {
    await this.requireAdminMatch(adminId, leagueId, matchId, input.expectedVersion);
    if (input.role !== 'ADMIN' || !this.validMetadata(input.mimeType, input.byteSize)) throw this.invalid('Administrator image upload metadata is invalid');
    if (!this.storage.createDirectUpload) throw new Error('Direct storage uploads are unavailable');
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM competition_matches WHERE id = ${matchId} FOR UPDATE`;
      await this.adminMatch(transaction, leagueId, matchId, input.expectedVersion);
      const grant = await this.storage.createDirectUpload!('match-result-evidence', randomUUID(), input.mimeType);
      const expiresAt = new Date(Date.now() + UPLOAD_LIFETIME_MS);
      const upload = await transaction.matchResultEvidenceUpload.create({ data: {
        matchId, role: 'ADMIN', uploadedByAdminId: adminId, objectKey: grant.key, mimeType: input.mimeType,
        byteSize: input.byteSize, checksumSha256: input.checksumSha256.toLowerCase(), expiresAt
      } });
      return { id: upload.id, objectKey: grant.key, uploadUrl: this.adminUrl(grant.uploadUrl, leagueId), headers: grant.headers, expiresAt: expiresAt.toISOString() };
    });
  }

  async completeAdminUpload(adminId: string, leagueId: string, matchId: string, uploadId: string, input: CompleteEvidenceUploadRequest) {
    await this.requireAdminMatch(adminId, leagueId, matchId, input.expectedVersion);
    const upload = await this.prisma.matchResultEvidenceUpload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.matchId !== matchId || upload.uploadedByAdminId !== adminId || upload.role !== 'ADMIN') throw this.notFound();
    return this.completeUpload(upload);
  }

  async adminReadUrl(adminId: string, leagueId: string, matchId: string, evidenceId: string) {
    await this.requireAdminMatch(adminId, leagueId, matchId);
    const evidence = await this.prisma.matchResultEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence || evidence.matchId !== matchId || evidence.status === 'DELETED') throw this.notFound();
    if (!this.storage.temporaryReadUrl) throw new Error('Temporary storage reads are unavailable');
    return { url: this.adminUrl(await this.storage.temporaryReadUrl(evidence.objectKey, READ_LIFETIME_SECONDS), leagueId),
      expiresAt: new Date(Date.now() + READ_LIFETIME_SECONDS * 1000).toISOString() };
  }

  async writeAdminLocalObject(adminId: string, leagueId: string, key: string, body: Buffer, mimeType: string) {
    const upload = await this.prisma.matchResultEvidenceUpload.findUnique({ where: { objectKey: key } });
    if (!upload || upload.uploadedByAdminId !== adminId || upload.role !== 'ADMIN' || upload.status !== 'PENDING' || upload.expiresAt <= new Date()) throw this.notFound();
    await this.requireAdminMatch(adminId, leagueId, upload.matchId);
    if (mimeType !== upload.mimeType) throw this.invalid('Evidence MIME type does not match the session');
    validateResultEvidenceImage({ buffer: body, size: body.length, originalname: key, mimetype: mimeType });
    if (!this.storage.writePrivate) throw this.notFound();
    await this.storage.writePrivate(key, body, mimeType);
  }

  async readAdminLocalObject(adminId: string, leagueId: string, key: string, expires: string, signature: string) {
    if (!this.storage.verifyPrivateRead?.(key, expires, signature)) throw this.notFound();
    const evidence = await this.prisma.matchResultEvidence.findUnique({ where: { objectKey: key } });
    if (!evidence || evidence.status === 'DELETED') throw this.notFound();
    await this.requireAdminMatch(adminId, leagueId, evidence.matchId);
    const object = await this.storage.readPrivate?.(key);
    if (!object) throw this.notFound();
    return new StreamableFile(object.buffer, { type: object.mimeType, length: object.size, disposition: 'inline' });
  }

  private adminUrl(url: string, leagueId: string) {
    return this.storage.verifyPrivateRead ? url.replace('/v1/result-evidence/objects/', `/v1/admin/leagues/${leagueId}/result-evidence/objects/`) : url;
  }

  private async requireAdminMatch(adminId: string, leagueId: string, matchId: string, expectedVersion?: number) {
    await (this.authorization ?? new AdminAuthorizationService(this.prisma)).requireLeagueAccess(adminId, leagueId);
    return this.adminMatch(this.prisma, leagueId, matchId, expectedVersion);
  }

  private async adminMatch(client: PrismaService | Prisma.TransactionClient, leagueId: string, matchId: string, expectedVersion?: number) {
    const match = await client.competitionMatch.findUnique({ where: { id: matchId }, include: {
      stage: { include: { competition: { include: { season: { include: { league: true } } } } } },
      homeParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } },
      awayParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } }
    } });
    if (!match || match.stage.competition.season?.leagueId !== leagueId || match.stage.competition.season.league.isDeleted) throw this.notFound();
    if (match.stage.status !== 'PUBLISHED' || !['IN_PROGRESS', 'COMPLETED'].includes(match.stage.competition.status)) throw this.notFound();
    if ([match.homeParticipant, match.awayParticipant].some((p) => p.seasonEntry && p.seasonEntry.leagueTeam.status !== 'ACTIVE')) throw this.notFound();
    if (expectedVersion !== undefined) assertExpectedVersion(match.version, expectedVersion, 'Match');
    return match;
  }

  async createUserUpload(userId: string, matchId: string, input: CreateEvidenceUploadRequest) {
    await this.requireParticipant(this.prisma, userId, matchId, input.expectedVersion);
    if (input.role === 'ADMIN') throw this.invalid('Players cannot upload administrator evidence');
    const role = input.role;
    if (!this.validMetadata(input.mimeType, input.byteSize)) throw this.invalid('Evidence must be a JPEG, PNG, or WebP image of at most 1 MiB');
    if (!this.storage.createDirectUpload) throw new Error('Direct storage uploads are unavailable');
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM competition_matches WHERE id = ${matchId} FOR UPDATE`;
      const match = await this.requireParticipant(transaction, userId, matchId, input.expectedVersion);
      await this.assertUserUploadAction(transaction, match, userId, role);
      const grant = await this.storage.createDirectUpload!('match-result-evidence', randomUUID(), input.mimeType);
      const expiresAt = new Date(Date.now() + UPLOAD_LIFETIME_MS);
      const upload = await transaction.matchResultEvidenceUpload.create({ data: {
        matchId, role, uploadedByUserId: userId, objectKey: grant.key, mimeType: input.mimeType,
        byteSize: input.byteSize, checksumSha256: input.checksumSha256.toLowerCase(), status: 'PENDING', expiresAt
      } });
      return { id: upload.id, objectKey: grant.key, uploadUrl: grant.uploadUrl, headers: grant.headers, expiresAt: expiresAt.toISOString() };
    });
  }

  async completeUserUpload(userId: string, matchId: string, uploadId: string, input: CompleteEvidenceUploadRequest) {
    await this.requireParticipant(this.prisma, userId, matchId, input.expectedVersion);
    const upload = await this.prisma.matchResultEvidenceUpload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.matchId !== matchId || upload.uploadedByUserId !== userId) throw this.notFound();
    return this.completeUpload(upload);
  }

  private async completeUpload(authorized: { id: string; matchId: string }) {
    const sourceKey = await this.prisma.$transaction(async (transaction) => {
      // Orphan cleanup uses this same lock, so it cannot delete between promotion and CAS.
      await transaction.$queryRaw`SELECT id FROM competition_matches WHERE id = ${authorized.matchId} FOR UPDATE`;
      const upload = await transaction.matchResultEvidenceUpload.findUnique({ where: { id: authorized.id } });
      if (!upload || upload.matchId !== authorized.matchId) throw this.notFound();
      if (upload.status === 'UPLOADED') return null;
      if (upload.status !== 'PENDING' || upload.expiresAt <= new Date()) {
        throw new CompetitionError('EVIDENCE_UPLOAD_EXPIRED', 'Evidence upload is no longer pending', 409);
      }
      const object = await this.storage.inspect?.(upload.objectKey);
      if (!object || !this.validMetadata(object.mimeType, object.size) || object.mimeType !== upload.mimeType
        || object.size !== upload.byteSize || !object.checksumSha256 || object.checksumSha256 !== upload.checksumSha256
        || !object.buffer || object.buffer.length !== object.size) {
        throw this.invalid('Uploaded evidence type, size, or checksum does not match the session');
      }
      if (!this.storage.promoteEvidence) throw new Error('Evidence promotion is unavailable');
      const retainedKey = await this.storage.promoteEvidence(upload.objectKey, { ...object, buffer: object.buffer });
      if (retainedKey !== retainedEvidenceKey(upload.objectKey)) throw this.invalid('Evidence was not promoted to its retained key');
      const claimed = await transaction.matchResultEvidenceUpload.updateMany({
        where: { id: upload.id, matchId: upload.matchId, objectKey: upload.objectKey, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'UPLOADED', completedAt: new Date(), objectKey: retainedKey }
      });
      if (claimed.count !== 1) throw new CompetitionError('EVIDENCE_UPLOAD_EXPIRED', 'Evidence upload is no longer pending', 409);
      return upload.objectKey === retainedKey ? null : upload.objectKey;
    }, PRISMA_TRANSACTION_OPTIONS);
    // Daily source cleanup retries failures even after consumption, including legacy/Local
    // objects without a lifecycle rule. The temporary-only provider lifecycle is a fallback.
    if (sourceKey) await this.storage.delete(sourceKey).catch(() => undefined);
    return { id: authorized.id, status: 'UPLOADED' as const };
  }

  async userReadUrl(userId: string, matchId: string, evidenceId: string): Promise<{ url: string; expiresAt: string }> {
    await this.requireParticipant(this.prisma, userId, matchId);
    const evidence = await this.prisma.matchResultEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence || evidence.matchId !== matchId || evidence.uploadedByUserId !== userId || evidence.status !== 'ACTIVE') {
      throw this.notFound();
    }
    if (!this.storage.temporaryReadUrl) throw new Error('Temporary storage reads are unavailable');
    return {
      url: await this.storage.temporaryReadUrl(evidence.objectKey, READ_LIFETIME_SECONDS),
      expiresAt: new Date(Date.now() + READ_LIFETIME_SECONDS * 1000).toISOString()
    };
  }

  async writeLocalObject(userId: string, key: string, body: Buffer, mimeType: string): Promise<void> {
    const upload = await this.prisma.matchResultEvidenceUpload.findUnique({ where: { objectKey: key } });
    if (!upload || upload.uploadedByUserId !== userId || upload.status !== 'PENDING' || upload.expiresAt <= new Date()) {
      throw this.notFound();
    }
    await this.requireParticipant(this.prisma, userId, upload.matchId);
    if (mimeType !== upload.mimeType) throw this.invalid('Evidence MIME type does not match the session');
    validateResultEvidenceImage({ buffer: body, size: body.length, originalname: key, mimetype: mimeType });
    if (!this.storage.writePrivate) throw this.notFound();
    try {
      await this.storage.writePrivate(key, body, mimeType);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new CompetitionError('EVIDENCE_ALREADY_UPLOADED', 'Evidence bytes already uploaded', 409);
      }
      throw error;
    }
  }

  async readLocalObject(userId: string, key: string, expires: string, signature: string): Promise<StreamableFile> {
    if (!this.storage.verifyPrivateRead?.(key, expires, signature)) throw this.notFound();
    const evidence = await this.prisma.matchResultEvidence.findUnique({ where: { objectKey: key } });
    if (!evidence || evidence.uploadedByUserId !== userId || evidence.status !== 'ACTIVE') throw this.notFound();
    await this.requireParticipant(this.prisma, userId, evidence.matchId);
    if (!this.storage.readPrivate) throw this.notFound();
    const object = await this.storage.readPrivate(key);
    if (!object) throw this.notFound();
    return new StreamableFile(object.buffer, { type: object.mimeType, length: object.size, disposition: 'inline' });
  }

  private async requireParticipant(client: PrismaService | Prisma.TransactionClient, userId: string, matchId: string, expectedVersion?: number): Promise<Match> {
    const match = await client.competitionMatch.findUnique({
      where: { id: matchId },
      include: {
        stage: { include: { competition: { include: { season: { include: { league: true } } } } } },
        homeParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } },
        awayParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } }
      }
    });
    if (!match || match.stage.competition.season?.league.isDeleted) throw this.notFound();
    const participants = [match.homeParticipant, match.awayParticipant];
    if (!participants.some((participant) => participant.individualUserId === userId || participant.seasonEntry?.ownerUserId === userId)) {
      throw this.notFound();
    }
    if (match.stage.status !== 'PUBLISHED' || ['DRAFT', 'CANCELLED'].includes(match.stage.competition.status)) {
      throw new CompetitionError('MATCH_RESULT_NOT_ALLOWED', 'Evidence is unavailable for this match', 409);
    }
    if (participants.some((participant) => participant.seasonEntry && participant.seasonEntry.leagueTeam.status !== 'ACTIVE')) {
      throw new CompetitionError('TEAM_ARCHIVED', 'League team has withdrawn', 409);
    }
    if (expectedVersion !== undefined) assertExpectedVersion(match.version, expectedVersion, 'Match');
    return match;
  }

  private validMetadata(mimeType: string, size: number): boolean {
    return ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
      && Number.isInteger(size) && size > 0 && size <= MAX_RESULT_EVIDENCE_BYTES;
  }

  private async assertUserUploadAction(client: PrismaService | Prisma.TransactionClient, match: Match, userId: string, requestedRole: 'SUBMITTER' | 'OPPONENT') {
    const now = new Date();
    if (match.status === 'AWAITING_RESULT') {
      if (requestedRole !== 'SUBMITTER') throw new CompetitionError('EVIDENCE_ROLE_INVALID', 'Evidence role does not match the available result action', 409);
      return;
    }
    if (match.status === 'PENDING_CONFIRMATION') {
      const proposal = await client.matchResultVersion.findFirst({
        where: { matchId: match.id, status: 'PROPOSED' }, orderBy: { version: 'desc' }, select: { submittedById: true }
      });
      if (!match.resultConfirmationDeadlineAt || match.resultConfirmationDeadlineAt > now) {
        throw new CompetitionError('MATCH_RESULT_NOT_ALLOWED', 'Evidence upload is not available before confirmation expires', 409);
      }
      if (!proposal || proposal.submittedById !== userId || requestedRole !== 'SUBMITTER') {
        throw new CompetitionError('EVIDENCE_ROLE_INVALID', 'Evidence role does not match the available result action', 409);
      }
      return;
    }
    if (match.status === 'DISPUTED') {
      const dispute = await client.matchResultDispute.findUnique({
        where: { activeKey: match.id }, include: { triggerResultVersion: { select: { submittedById: true } } }
      });
      if (!dispute || !['EVIDENCE_COLLECTION', 'READY_FOR_REVIEW'].includes(dispute.status)) {
        throw new CompetitionError('MATCH_RESULT_NOT_ALLOWED', 'Evidence collection is not active', 409);
      }
      if (dispute.evidenceDeadlineAt <= now) {
        throw new CompetitionError('EVIDENCE_DEADLINE_EXPIRED', 'Evidence collection has ended', 409);
      }
      const expectedRole = dispute.triggerResultVersion.submittedById === userId ? 'SUBMITTER' : 'OPPONENT';
      if (requestedRole !== expectedRole) {
        throw new CompetitionError('EVIDENCE_ROLE_INVALID', 'Evidence role does not match the participant side', 409);
      }
      return;
    }
    throw new CompetitionError('MATCH_RESULT_NOT_ALLOWED', 'Evidence upload is not available for this match', 409);
  }

  private invalid(message: string): CompetitionError {
    return new CompetitionError('INVALID_RESULT_EVIDENCE', message, 400);
  }

  private notFound(): CompetitionError {
    return new CompetitionError('MATCH_NOT_FOUND', 'Match or evidence was not found', 404);
  }
}

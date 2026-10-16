import { randomUUID } from 'node:crypto';
import { Inject, Injectable, StreamableFile } from '@nestjs/common';
import type { CompleteEvidenceUploadRequest, CreateEvidenceUploadRequest } from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { MAX_RESULT_EVIDENCE_BYTES, validateResultEvidenceImage } from '../storage/image-validation.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/object-storage.js';
import { CompetitionError, assertExpectedVersion } from './competition.errors.js';

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
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage
  ) {}

  async createUserUpload(userId: string, matchId: string, input: CreateEvidenceUploadRequest) {
    await this.requireParticipant(userId, matchId, input.expectedVersion);
    if (input.role === 'ADMIN') throw this.invalid('Players cannot upload administrator evidence');
    if (!this.validMetadata(input.mimeType, input.byteSize)) throw this.invalid('Evidence must be a JPEG, PNG, or WebP image of at most 1 MiB');
    if (!this.storage.createDirectUpload) throw new Error('Direct storage uploads are unavailable');

    const grant = await this.storage.createDirectUpload('match-result-evidence', randomUUID(), input.mimeType);
    const expiresAt = new Date(Date.now() + UPLOAD_LIFETIME_MS);
    const upload = await this.prisma.matchResultEvidenceUpload.create({
      data: {
        matchId,
        role: input.role,
        uploadedByUserId: userId,
        objectKey: grant.key,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256.toLowerCase(),
        status: 'PENDING',
        expiresAt
      }
    });
    return { id: upload.id, objectKey: grant.key, uploadUrl: grant.uploadUrl, headers: grant.headers, expiresAt: expiresAt.toISOString() };
  }

  async completeUserUpload(userId: string, matchId: string, uploadId: string, input: CompleteEvidenceUploadRequest) {
    await this.requireParticipant(userId, matchId, input.expectedVersion);
    const upload = await this.prisma.matchResultEvidenceUpload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.matchId !== matchId || upload.uploadedByUserId !== userId) throw this.notFound();
    if (upload.status !== 'PENDING' || upload.expiresAt <= new Date()) {
      throw new CompetitionError('EVIDENCE_UPLOAD_EXPIRED', 'Evidence upload is no longer pending', 409);
    }
    if (!this.storage.inspect) throw new Error('Storage inspection is unavailable');
    const object = await this.storage.inspect(upload.objectKey);
    if (!object) throw this.invalid('Uploaded evidence was not found');
    if (!this.validMetadata(object.mimeType, object.size) || object.mimeType !== upload.mimeType || object.size !== upload.byteSize) {
      throw this.invalid('Uploaded evidence type or size does not match the session');
    }
    const updated = await this.prisma.matchResultEvidenceUpload.updateMany({
      where: { id: uploadId, matchId, uploadedByUserId: userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      data: { status: 'UPLOADED', completedAt: new Date() }
    });
    if (updated.count !== 1) throw new CompetitionError('EVIDENCE_UPLOAD_EXPIRED', 'Evidence upload is no longer pending', 409);
    return { id: upload.id, status: 'UPLOADED' as const };
  }

  async userReadUrl(userId: string, matchId: string, evidenceId: string): Promise<{ url: string; expiresAt: string }> {
    await this.requireParticipant(userId, matchId);
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
    await this.requireParticipant(userId, upload.matchId);
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
    await this.requireParticipant(userId, evidence.matchId);
    if (!this.storage.readPrivate) throw this.notFound();
    const object = await this.storage.readPrivate(key);
    if (!object) throw this.notFound();
    return new StreamableFile(object.buffer, { type: object.mimeType, length: object.size, disposition: 'inline' });
  }

  private async requireParticipant(userId: string, matchId: string, expectedVersion?: number): Promise<Match> {
    const match = await this.prisma.competitionMatch.findUnique({
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

  private invalid(message: string): CompetitionError {
    return new CompetitionError('INVALID_RESULT_EVIDENCE', message, 400);
  }

  private notFound(): CompetitionError {
    return new CompetitionError('MATCH_NOT_FOUND', 'Match or evidence was not found', 404);
  }
}

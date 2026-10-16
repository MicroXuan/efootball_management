import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import {
  CompleteEvidenceUploadRequestSchema,
  CreateEvidenceUploadRequestSchema,
  ResourceIdSchema,
  type CompleteEvidenceUploadRequest,
  type CreateEvidenceUploadRequest
} from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { MAX_RESULT_EVIDENCE_BYTES } from '../storage/image-validation.js';
import { CompetitionError } from './competition.errors.js';
import { ResultEvidenceStorageService } from './result-evidence-storage.service.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class ResultEvidenceController {
  constructor(@Inject(ResultEvidenceStorageService) private readonly evidence: ResultEvidenceStorageService) {}

  @Post('matches/:matchId/result-evidence/uploads')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId', new ZodValidationPipe(ResourceIdSchema)) matchId: string,
    @Body(new ZodValidationPipe(CreateEvidenceUploadRequestSchema)) input: CreateEvidenceUploadRequest
  ) {
    return this.evidence.createUserUpload(user.id, matchId, input);
  }

  @Post('matches/:matchId/result-evidence/uploads/:uploadId/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId', new ZodValidationPipe(ResourceIdSchema)) matchId: string,
    @Param('uploadId', new ZodValidationPipe(ResourceIdSchema)) uploadId: string,
    @Body(new ZodValidationPipe(CompleteEvidenceUploadRequestSchema)) input: CompleteEvidenceUploadRequest
  ) {
    return this.evidence.completeUserUpload(user.id, matchId, uploadId, input);
  }

  @Get('matches/:matchId/result-evidence/:evidenceId/read-url')
  readUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId', new ZodValidationPipe(ResourceIdSchema)) matchId: string,
    @Param('evidenceId', new ZodValidationPipe(ResourceIdSchema)) evidenceId: string
  ) {
    return this.evidence.userReadUrl(user.id, matchId, evidenceId);
  }

  @Put('result-evidence/objects/:key')
  @HttpCode(200)
  async writeLocal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Req() request: IncomingMessage
  ) {
    const contentType = request.headers['content-type']?.split(';')[0]?.trim() ?? '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      throw new CompetitionError('INVALID_RESULT_EVIDENCE', 'Unsupported evidence content type', 400);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += bytes.length;
      if (size > MAX_RESULT_EVIDENCE_BYTES) {
        throw new CompetitionError('INVALID_RESULT_EVIDENCE', 'Evidence exceeds 1 MiB', 400);
      }
      chunks.push(bytes);
    }
    await this.evidence.writeLocalObject(user.id, key, Buffer.concat(chunks), contentType);
    return { uploaded: true };
  }

  @Get('result-evidence/objects/:key')
  readLocal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string
  ) {
    return this.evidence.readLocalObject(user.id, key, expires, signature);
  }
}

import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AdminResolveMatchResultDisputeRequestSchema, AdminMatchResultDisputeResponseSchema, AdminMatchResultDisputeListResponseSchema, CreateEvidenceUploadRequestSchema, CompleteEvidenceUploadRequestSchema, ResourceIdSchema,
  type AdminResolveMatchResultDisputeRequest, type CreateEvidenceUploadRequest, type CompleteEvidenceUploadRequest } from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AdminMatchResultDisputesService } from './admin-match-result-disputes.service.js';
import { ResultEvidenceStorageService } from './result-evidence-storage.service.js';
import { MAX_RESULT_EVIDENCE_BYTES } from '../storage/image-validation.js';
import { CompetitionError } from './competition.errors.js';

@Controller('admin/leagues/:leagueId')
@UseGuards(AdminAuthGuard)
export class AdminMatchResultDisputesController {
  constructor(@Inject(AdminMatchResultDisputesService) private readonly disputes: AdminMatchResultDisputesService,
    @Inject(ResultEvidenceStorageService) private readonly evidence: ResultEvidenceStorageService) {}

  @Get('result-disputes')
  async list(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string) {
    return AdminMatchResultDisputeListResponseSchema.parse(await this.disputes.list(admin.id, leagueId));
  }
  @Get('result-disputes/:disputeId')
  async detail(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('disputeId', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return AdminMatchResultDisputeResponseSchema.parse(await this.disputes.detail(admin.id, leagueId, id));
  }
  @Post('result-disputes/:disputeId/resolve')
  @HttpCode(200)
  resolve(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('disputeId', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(AdminResolveMatchResultDisputeRequestSchema)) input: AdminResolveMatchResultDisputeRequest) {
    return this.disputes.resolve(admin.id, leagueId, id, input);
  }
  @Get('result-disputes/:disputeId/evidence/:evidenceId/read-url')
  readUrl(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('disputeId', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Param('evidenceId', new ZodValidationPipe(ResourceIdSchema)) evidenceId: string) {
    return this.disputes.readUrl(admin.id, leagueId, id, evidenceId);
  }
  @Post('matches/:matchId/result-evidence/uploads')
  createUpload(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('matchId', new ZodValidationPipe(ResourceIdSchema)) matchId: string,
    @Body(new ZodValidationPipe(CreateEvidenceUploadRequestSchema)) input: CreateEvidenceUploadRequest) {
    return this.evidence.createAdminUpload(admin.id, leagueId, matchId, input);
  }
  @Post('matches/:matchId/result-evidence/uploads/:uploadId/complete')
  @HttpCode(200)
  completeUpload(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('matchId', new ZodValidationPipe(ResourceIdSchema)) matchId: string,
    @Param('uploadId', new ZodValidationPipe(ResourceIdSchema)) uploadId: string,
    @Body(new ZodValidationPipe(CompleteEvidenceUploadRequestSchema)) input: CompleteEvidenceUploadRequest) {
    return this.evidence.completeAdminUpload(admin.id, leagueId, matchId, uploadId, input);
  }
  @Get('matches/:matchId/result-evidence/:evidenceId/read-url')
  matchReadUrl(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('matchId', new ZodValidationPipe(ResourceIdSchema)) matchId: string,
    @Param('evidenceId', new ZodValidationPipe(ResourceIdSchema)) evidenceId: string) {
    return this.evidence.adminReadUrl(admin.id, leagueId, matchId, evidenceId);
  }
  @Put('result-evidence/objects/:key')
  @HttpCode(200)
  async writeLocal(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('key') key: string, @Req() request: IncomingMessage) {
    const mimeType = request.headers['content-type']?.split(';')[0]?.trim() ?? '';
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += bytes.length;
      if (size > MAX_RESULT_EVIDENCE_BYTES) throw new CompetitionError('INVALID_RESULT_EVIDENCE', 'Evidence exceeds 1 MiB', 400);
      chunks.push(bytes);
    }
    await this.evidence.writeAdminLocalObject(admin.id, leagueId, key, Buffer.concat(chunks), mimeType);
    return { uploaded: true };
  }
  @Get('result-evidence/objects/:key')
  readLocal(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('key') key: string, @Query('expires') expires: string, @Query('signature') signature: string) {
    return this.evidence.readAdminLocalObject(admin.id, leagueId, key, expires, signature);
  }
}

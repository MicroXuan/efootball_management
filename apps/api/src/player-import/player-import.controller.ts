import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards
} from '@nestjs/common';
import {
  CreateImportBatchRequestSchema,
  ImportDiffTypeSchema,
  ResourceIdSchema,
  type ParsedCreateImportBatchRequest
} from '@efm/contracts';
import { z } from 'zod';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { RequirePermission } from '../common/auth/roles.decorator.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PlayerImportPublisher } from './player-import.publisher.js';
import { PlayerImportService } from './player-import.service.js';

const ImportRecordQuerySchema = z.object({ diffType: ImportDiffTypeSchema.optional() });
type ImportRecordQuery = z.output<typeof ImportRecordQuerySchema>;
type PassthroughResponse = { status(code: number): unknown };

@Controller('admin/player-imports')
@UseGuards(JwtAuthGuard, ScopeGuard)
export class PlayerImportController {
  constructor(
    @Inject(PlayerImportService) private readonly imports: PlayerImportService,
    @Inject(PlayerImportPublisher) private readonly publisher: PlayerImportPublisher
  ) {}

  @Post()
  @RequirePermission('catalog.import.create')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateImportBatchRequestSchema)) body: ParsedCreateImportBatchRequest,
    @Res({ passthrough: true }) response: PassthroughResponse
  ) {
    const outcome = await this.imports.createBatchWithOutcome(user.id, body);
    response.status(outcome.created ? 201 : 200);
    return outcome.batch;
  }

  @Get(':id')
  @RequirePermission('catalog.import.read')
  getBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string
  ) {
    return this.imports.getBatch(user.id, id);
  }

  @Get(':id/records')
  @RequirePermission('catalog.import.read')
  listRecords(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Query(new ZodValidationPipe(ImportRecordQuerySchema)) query: ImportRecordQuery
  ) {
    return this.imports.listRecords(user.id, id, query);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission('catalog.import.publish')
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string
  ) {
    return this.publisher.publish(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('catalog.import.publish')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string
  ) {
    return this.imports.cancelBatch(user.id, id);
  }
}

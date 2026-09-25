import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { CompetitionListQuerySchema, ResourceIdSchema, type CompetitionListQuery } from '@efm/contracts';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CompetitionsService } from './competitions.service.js';

@Controller('competitions')
export class PublicCompetitionsController {
  constructor(@Inject(CompetitionsService) private readonly competitions: CompetitionsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(CompetitionListQuerySchema)) query: CompetitionListQuery) {
    return this.competitions.listPublic(query);
  }

  @Get(':id')
  get(@Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.competitions.getPublic(id);
  }
}

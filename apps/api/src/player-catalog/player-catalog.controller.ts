import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { PlayerSearchQuerySchema, ResourceIdSchema } from '@efm/contracts';
import type { PlayerSearchQuery } from '@efm/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PlayerCatalogService } from './player-catalog.service.js';

const PackListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
type PackListQuery = z.output<typeof PackListQuerySchema>;

@Controller()
export class PlayerCatalogController {
  constructor(@Inject(PlayerCatalogService) private readonly catalog: PlayerCatalogService) {}

  @Get('players')
  search(@Query(new ZodValidationPipe(PlayerSearchQuerySchema)) query: PlayerSearchQuery) {
    return this.catalog.search(query);
  }

  @Get('players/:id')
  getPlayer(@Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.catalog.getPlayer(id);
  }

  @Get('player-cards/:id')
  getCard(@Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.catalog.getCard(id);
  }

  @Get('card-packs')
  listPacks(@Query(new ZodValidationPipe(PackListQuerySchema)) query: PackListQuery) {
    return this.catalog.listPacks(query);
  }

  @Get('card-packs/:id')
  getPack(@Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.catalog.getPack(id);
  }
}

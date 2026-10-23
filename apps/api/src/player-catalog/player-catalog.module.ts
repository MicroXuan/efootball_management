import { Module } from '@nestjs/common';
import { PlayerCatalogController } from './player-catalog.controller.js';
import { PlayerCatalogService } from './player-catalog.service.js';
import { PlayerCatalogReadRepository } from './player-catalog-read.repository.js';

@Module({
  controllers: [PlayerCatalogController],
  providers: [PlayerCatalogReadRepository, PlayerCatalogService],
  exports: [PlayerCatalogService]
})
export class PlayerCatalogModule {}

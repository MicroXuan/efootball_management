import { Module } from '@nestjs/common';
import { PlayerCatalogController } from './player-catalog.controller.js';
import { PlayerCatalogService } from './player-catalog.service.js';

@Module({
  controllers: [PlayerCatalogController],
  providers: [PlayerCatalogService],
  exports: [PlayerCatalogService]
})
export class PlayerCatalogModule {}

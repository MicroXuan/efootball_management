import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { CatalogReadAuthGuard } from './catalog-read-auth.guard.js';
import { PlayerCatalogController } from './player-catalog.controller.js';
import { PlayerCatalogService } from './player-catalog.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [PlayerCatalogController],
  providers: [CatalogReadAuthGuard, PlayerCatalogService],
  exports: [PlayerCatalogService]
})
export class PlayerCatalogModule {}

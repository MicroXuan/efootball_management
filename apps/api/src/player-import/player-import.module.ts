import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PlayerImportService } from './player-import.service.js';
import { PlayerImportPublisher } from './player-import.publisher.js';

@Module({
  imports: [AuthorizationModule],
  providers: [PlayerImportService, PlayerImportPublisher],
  exports: [PlayerImportService, PlayerImportPublisher]
})
export class PlayerImportModule {}

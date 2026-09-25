import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PlayerImportService } from './player-import.service.js';

@Module({
  imports: [AuthorizationModule],
  providers: [PlayerImportService],
  exports: [PlayerImportService]
})
export class PlayerImportModule {}

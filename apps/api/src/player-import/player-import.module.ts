import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PlayerImportService } from './player-import.service.js';
import { PlayerImportPublisher } from './player-import.publisher.js';
import { PlayerImportController } from './player-import.controller.js';
import { PlayerBuildsModule } from '../player-builds/player-builds.module.js';

@Module({
  imports: [AuthorizationModule, JwtModule.register({}), PlayerBuildsModule],
  controllers: [PlayerImportController],
  providers: [PlayerImportService, PlayerImportPublisher],
  exports: [PlayerImportService, PlayerImportPublisher]
})
export class PlayerImportModule {}

import { Module } from '@nestjs/common';
import { PlayerBuildsService } from './player-builds.service.js';

@Module({
  providers: [PlayerBuildsService],
  exports: [PlayerBuildsService]
})
export class PlayerBuildsModule {}

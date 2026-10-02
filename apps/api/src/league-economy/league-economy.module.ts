import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MyTeamAssetsController } from './my-team-assets.controller.js';
import { TeamAssetsService } from './team-assets.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [MyTeamAssetsController],
  providers: [TeamAssetsService],
  exports: [TeamAssetsService]
})
export class LeagueEconomyModule {}

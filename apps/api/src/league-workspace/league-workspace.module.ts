import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MyLeagueWorkspaceController } from './my-league-workspace.controller.js';
import { LeagueWorkspaceService } from './league-workspace.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [MyLeagueWorkspaceController],
  providers: [LeagueWorkspaceService],
  exports: [LeagueWorkspaceService]
})
export class LeagueWorkspaceModule {}

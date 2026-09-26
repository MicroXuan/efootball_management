import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { TeamProfilesController } from './team-profiles.controller.js';
import { TeamProfilesService } from './team-profiles.service.js';

@Module({
  imports: [AuthorizationModule, JwtModule.register({})],
  controllers: [TeamProfilesController],
  providers: [TeamProfilesService],
  exports: [TeamProfilesService]
})
export class LeaguesModule {}

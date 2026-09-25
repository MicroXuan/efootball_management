import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AdminCompetitionsController } from './admin-competitions.controller.js';
import { CompetitionsService } from './competitions.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { PublicCompetitionsController } from './public-competitions.controller.js';
import { RegistrationsController } from './registrations.controller.js';
import { COMPETITION_CLOCK, RegistrationsService, SystemCompetitionClock } from './registrations.service.js';

@Module({
  imports: [AuthorizationModule, JwtModule.register({})],
  controllers: [PublicCompetitionsController, AdminCompetitionsController, RegistrationsController],
  providers: [
    CompetitionsService,
    MutationReceiptService,
    RegistrationsService,
    { provide: COMPETITION_CLOCK, useClass: SystemCompetitionClock }
  ],
  exports: [CompetitionsService, MutationReceiptService, RegistrationsService]
})
export class CompetitionsModule {}

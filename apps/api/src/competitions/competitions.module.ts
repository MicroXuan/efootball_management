import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AdminCompetitionsController } from './admin-competitions.controller.js';
import { CompetitionsService } from './competitions.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { PublicCompetitionsController } from './public-competitions.controller.js';
import { RegistrationsController } from './registrations.controller.js';
import { COMPETITION_CLOCK, RegistrationsService, SystemCompetitionClock } from './registrations.service.js';
import { SchedulesController } from './schedules.controller.js';
import { SCHEDULE_GENERATOR, SchedulesService } from './schedules.service.js';
import { generateRoundRobin } from './domain/round-robin.js';

@Module({
  imports: [AuthorizationModule, JwtModule.register({})],
  controllers: [PublicCompetitionsController, AdminCompetitionsController, RegistrationsController, SchedulesController],
  providers: [
    CompetitionsService,
    MutationReceiptService,
    RegistrationsService,
    SchedulesService,
    { provide: SCHEDULE_GENERATOR, useValue: generateRoundRobin },
    { provide: COMPETITION_CLOCK, useClass: SystemCompetitionClock }
  ],
  exports: [CompetitionsService, MutationReceiptService, RegistrationsService, SchedulesService]
})
export class CompetitionsModule {}

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AdminCompetitionsController } from './admin-competitions.controller.js';
import { CompetitionsService } from './competitions.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { MyDivisionStandingsController, PublicCompetitionsController } from './public-competitions.controller.js';
import { RegistrationsController } from './registrations.controller.js';
import { COMPETITION_CLOCK, RegistrationsService, SystemCompetitionClock } from './registrations.service.js';
import { SchedulesController } from './schedules.controller.js';
import { SCHEDULE_GENERATOR, SchedulesService } from './schedules.service.js';
import { generateRoundRobin } from './domain/round-robin.js';
import { ResultsController } from './results.controller.js';
import { ResultsService } from './results.service.js';
import { StandingsService } from './standings.service.js';
import { MyCompetitionsController } from './my-competitions.controller.js';
import { MyCompetitionsService } from './my-competitions.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule, AuthorizationModule, JwtModule.register({})],
  controllers: [
    PublicCompetitionsController,
    MyDivisionStandingsController,
    AdminCompetitionsController,
    RegistrationsController,
    SchedulesController,
    ResultsController,
    MyCompetitionsController
  ],
  providers: [
    CompetitionsService,
    MutationReceiptService,
    RegistrationsService,
    SchedulesService,
    StandingsService,
    ResultsService,
    MyCompetitionsService,
    { provide: SCHEDULE_GENERATOR, useValue: generateRoundRobin },
    { provide: COMPETITION_CLOCK, useClass: SystemCompetitionClock }
  ],
  exports: [
    CompetitionsService,
    MutationReceiptService,
    RegistrationsService,
    SchedulesService,
    StandingsService,
    ResultsService,
    MyCompetitionsService
  ]
})
export class CompetitionsModule {}

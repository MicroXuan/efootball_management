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
import { AdminCupCompetitionsController } from './admin-cup-competitions.controller.js';
import { CupCompetitionsController } from './cup-competitions.controller.js';
import { CupCompetitionsService } from './cup-competitions.service.js';
import { CupGroupsService } from './cup-groups.service.js';
import { CupBracketsService } from './cup-brackets.service.js';
import { CupProgressionService } from './cup-progression.service.js';
import { CupBracketQueriesService } from './cup-bracket-queries.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { ResultEvidenceStorageService } from './result-evidence-storage.service.js';
import { MatchResultEventsService } from './match-result-events.service.js';
import { MatchResultDisputesService } from './match-result-disputes.service.js';
import { AdminMatchResultDisputesService } from './admin-match-result-disputes.service.js';
import { ResultEvidenceRetentionWorker } from './result-evidence-retention.worker.js';
import { SeasonFixturesController } from './season-fixtures.controller.js';
import { SeasonFixturesService } from './season-fixtures.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule, AuthorizationModule, JwtModule.register({}), StorageModule],
  controllers: [
    PublicCompetitionsController,
    MyDivisionStandingsController,
    AdminCompetitionsController,
    RegistrationsController,
    SchedulesController,
    ResultsController,
    MyCompetitionsController,
    AdminCupCompetitionsController,
    CupCompetitionsController,
    SeasonFixturesController
  ],
  providers: [
    CompetitionsService,
    MutationReceiptService,
    RegistrationsService,
    SchedulesService,
    StandingsService,
    ResultsService,
    MyCompetitionsService,
    CupCompetitionsService,
    CupGroupsService,
    CupBracketsService,
    CupProgressionService,
    CupBracketQueriesService,
    ResultEvidenceStorageService,
    MatchResultEventsService,
    MatchResultDisputesService,
    AdminMatchResultDisputesService,
    ResultEvidenceRetentionWorker,
    SeasonFixturesService,
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
    MyCompetitionsService,
    CupCompetitionsService,
    CupGroupsService,
    CupBracketsService,
    CupProgressionService,
    CupBracketQueriesService,
    ResultEvidenceStorageService,
    MatchResultEventsService,
    MatchResultDisputesService
  ]
})
export class CompetitionsModule {}

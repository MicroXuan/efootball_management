import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AdminCompetitionsController } from './admin-competitions.controller.js';
import { CompetitionsService } from './competitions.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { PublicCompetitionsController } from './public-competitions.controller.js';

@Module({
  imports: [AuthorizationModule, JwtModule.register({})],
  controllers: [PublicCompetitionsController, AdminCompetitionsController],
  providers: [CompetitionsService, MutationReceiptService],
  exports: [CompetitionsService, MutationReceiptService]
})
export class CompetitionsModule {}

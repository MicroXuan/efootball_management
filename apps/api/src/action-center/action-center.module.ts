import { Module } from '@nestjs/common';
import { ActionCenterController } from './action-center.controller.js';
import { ActionCenterService } from './action-center.service.js';

@Module({
  controllers: [ActionCenterController],
  providers: [ActionCenterService]
})
export class ActionCenterModule {}

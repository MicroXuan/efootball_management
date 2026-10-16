import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ActionCenterController } from './action-center.controller.js';
import { ActionCenterService } from './action-center.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [ActionCenterController],
  providers: [ActionCenterService]
})
export class ActionCenterModule {}

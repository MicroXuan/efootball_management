import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SeasonCalendarController } from './season-calendar.controller.js';
import { SeasonCalendarService } from './season-calendar.service.js';
import { AdminSeasonCalendarController } from './admin-season-calendar.controller.js';
import { AdminModule } from '../admin/admin.module.js';

@Module({ imports: [JwtModule.register({}), AdminModule], controllers: [SeasonCalendarController, AdminSeasonCalendarController], providers: [SeasonCalendarService], exports: [SeasonCalendarService] })
export class SeasonCalendarModule {}

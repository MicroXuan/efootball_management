import { Module } from '@nestjs/common';
import { SeasonCalendarController } from './season-calendar.controller.js';
import { SeasonCalendarService } from './season-calendar.service.js';

@Module({ controllers: [SeasonCalendarController], providers: [SeasonCalendarService], exports: [SeasonCalendarService] })
export class SeasonCalendarModule {}

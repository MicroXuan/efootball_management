import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SeasonCalendarController } from './season-calendar.controller.js';
import { SeasonCalendarService } from './season-calendar.service.js';

@Module({ imports: [JwtModule.register({})], controllers: [SeasonCalendarController], providers: [SeasonCalendarService], exports: [SeasonCalendarService] })
export class SeasonCalendarModule {}

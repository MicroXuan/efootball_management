import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SeasonCalendarController } from './season-calendar.controller.js';
import { SeasonCalendarService } from './season-calendar.service.js';
import { AdminSeasonCalendarController } from './admin-season-calendar.controller.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminSeasonCalendarNotesController } from './admin-season-calendar-notes.controller.js';
import { SeasonCalendarNoteService } from './season-calendar-note.service.js';
import { CompetitionsModule } from '../competitions/competitions.module.js';

@Module({ imports: [JwtModule.register({}), AdminModule, CompetitionsModule], controllers: [SeasonCalendarController, AdminSeasonCalendarController, AdminSeasonCalendarNotesController], providers: [SeasonCalendarService, SeasonCalendarNoteService], exports: [SeasonCalendarService] })
export class SeasonCalendarModule {}

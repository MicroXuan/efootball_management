import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ResourceIdSchema, SeasonPlayingRosterResponseSchema } from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { SeasonPlayingRosterService } from './season-playing-roster.service.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class SeasonPlayingRosterController {
  constructor(@Inject(SeasonPlayingRosterService) private readonly playingRoster: SeasonPlayingRosterService) {}

  @Get('me/seasons/:seasonId/playing-roster')
  async list(@CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string) {
    return SeasonPlayingRosterResponseSchema.parse(await this.playingRoster.list(user.id, seasonId));
  }
}

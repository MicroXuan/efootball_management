import { Body, Controller, Get, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateTeamProfileRequestSchema,
  UpdateTeamProfileRequestSchema,
  type ParsedCreateTeamProfileRequest,
  type UpdateTeamProfileRequest
} from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TeamProfilesService } from './team-profiles.service.js';

@Controller('me/team-profile')
@UseGuards(JwtAuthGuard)
export class TeamProfilesController {
  constructor(@Inject(TeamProfilesService) private readonly profiles: TeamProfilesService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.get(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateTeamProfileRequestSchema)) body: ParsedCreateTeamProfileRequest
  ) {
    return this.profiles.create(user.id, body);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateTeamProfileRequestSchema)) body: UpdateTeamProfileRequest
  ) {
    return this.profiles.update(user.id, body);
  }
}

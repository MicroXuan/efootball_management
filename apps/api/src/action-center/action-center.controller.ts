import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ActionCenterService } from './action-center.service.js';

@Controller('me/action-center')
@UseGuards(JwtAuthGuard)
export class ActionCenterController {
  constructor(@Inject(ActionCenterService) private readonly center: ActionCenterService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.center.get(user.id);
  }
}

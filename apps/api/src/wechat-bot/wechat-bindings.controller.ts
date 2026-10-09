import { Controller, Delete, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { WechatBindingService } from './wechat-binding.service.js';

@Controller('me/wechat-bot')
@UseGuards(JwtAuthGuard)
export class WechatBindingsController {
  constructor(@Inject(WechatBindingService) private readonly bindings: WechatBindingService) {}

  @Get('binding')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.bindings.status(user.id);
  }

  @Post('binding-code')
  issue(@CurrentUser() user: AuthenticatedUser) {
    return this.bindings.issue(user.id);
  }

  @Delete('binding')
  unbind(@CurrentUser() user: AuthenticatedUser) {
    return this.bindings.unbind(user.id);
  }
}

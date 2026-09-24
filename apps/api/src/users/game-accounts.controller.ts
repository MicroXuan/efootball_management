import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { ParsedGameAccountInput } from '@efm/contracts';
import { GameAccountInputSchema } from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { GameAccountsService } from './game-accounts.service.js';

@Controller('me/game-accounts')
@UseGuards(JwtAuthGuard)
export class GameAccountsController {
  constructor(@Inject(GameAccountsService) private readonly accounts: GameAccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.accounts.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(GameAccountInputSchema)) body: ParsedGameAccountInput
  ) {
    return this.accounts.create(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') accountId: string,
    @Body(new ZodValidationPipe(GameAccountInputSchema)) body: ParsedGameAccountInput
  ) {
    return this.accounts.update(user.id, accountId, body);
  }

  @Delete(':id')
  @HttpCode(200)
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') accountId: string) {
    return this.accounts.delete(user.id, accountId);
  }
}

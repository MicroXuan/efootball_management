import { Body, Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';
import type { UpdateProfileRequest } from '@efm/contracts';
import { UpdateProfileRequestSchema } from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  getCurrent(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getCurrent(user.id);
  }

  @Patch()
  updateCurrent(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateProfileRequestSchema)) body: UpdateProfileRequest
  ) {
    return this.users.updateCurrent(user.id, body);
  }
}

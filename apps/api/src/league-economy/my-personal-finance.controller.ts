import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PersonalFinanceEntryInputSchema, PersonalFinanceUpdateSchema, ResourceIdSchema } from '@efm/contracts';
import { z } from 'zod';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PersonalFinanceService } from './personal-finance.service.js';

const querySchema = z.object({ seasonId: ResourceIdSchema });

@Controller('me/league-teams/:teamId/personal-finance')
@UseGuards(JwtAuthGuard)
export class MyPersonalFinanceController {
  constructor(@Inject(PersonalFinanceService) private readonly finance: PersonalFinanceService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string,
    @Query(new ZodValidationPipe(querySchema)) query: z.output<typeof querySchema>) {
    return this.finance.list(user.id, teamId, query.seasonId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string,
    @Body(new ZodValidationPipe(PersonalFinanceEntryInputSchema)) input: z.output<typeof PersonalFinanceEntryInputSchema>) {
    return this.finance.create(user.id, teamId, input);
  }

  @Patch(':entryId')
  update(@CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string,
    @Param('entryId', new ZodValidationPipe(ResourceIdSchema)) entryId: string,
    @Body(new ZodValidationPipe(PersonalFinanceUpdateSchema)) input: z.output<typeof PersonalFinanceUpdateSchema>) {
    return this.finance.update(user.id, teamId, entryId, input);
  }

  @Delete(':entryId')
  remove(@CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string,
    @Param('entryId', new ZodValidationPipe(ResourceIdSchema)) entryId: string,
    @Query(new ZodValidationPipe(querySchema)) query: z.output<typeof querySchema>) {
    return this.finance.remove(user.id, teamId, query.seasonId, entryId);
  }
}

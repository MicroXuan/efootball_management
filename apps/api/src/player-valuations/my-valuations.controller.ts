import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ResourceIdSchema } from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ValuationSnapshotsService } from './valuation-snapshots.service.js';

@Controller('me/league-teams/:teamId/valuations')
@UseGuards(JwtAuthGuard)
export class MyValuationsController {
  constructor(@Inject(ValuationSnapshotsService) private readonly snapshots: ValuationSnapshotsService) {}

  @Get('workspace')
  workspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string
  ) {
    return this.snapshots.getWorkspace(user.id, teamId);
  }
}

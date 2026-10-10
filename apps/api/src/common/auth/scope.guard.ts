import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from '../../authorization/authorization.service.js';
import { ResourceScopeService } from '../../authorization/resource-scope.service.js';
import { LeagueVisibilityService } from '../../league-visibility/league-visibility.service.js';
import type { CurrentUser } from './current-user.decorator.js';
import { REQUIRED_PERMISSION } from './roles.decorator.js';
import type { PermissionRequirement } from './roles.decorator.js';

type ScopedRequest = {
  user?: CurrentUser;
  params: Record<string, string | undefined>;
};

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(ResourceScopeService) private readonly resourceScopes: ResourceScopeService,
    @Inject(LeagueVisibilityService) private readonly visibility: LeagueVisibilityService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()]
    );
    if (!requirement) return true;

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    if (!request.user) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Forbidden' });
    const scopeId = requirement.scope ? request.params[requirement.scope.param] : undefined;
    const target = requirement.scope && scopeId
      ? await this.resourceScopes.resolve(requirement.scope.type, scopeId)
      : undefined;
    if (requirement.scope && !target) throw this.visibility.notFound();
    const allowed = await this.authorization.can(request.user.id, requirement.permission, target);
    if (!allowed) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Forbidden' });
    return true;
  }
}

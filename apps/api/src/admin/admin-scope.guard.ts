import { Inject, Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminAuthorizationService } from './admin-authorization.service.js';

const PLATFORM_ADMIN_ONLY = 'admin:platform-only';
export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN_ONLY, true);

type ScopedRequest = {
  admin?: CurrentAdminIdentity;
  params?: { leagueId?: string };
};

@Injectable()
export class AdminScopeGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const adminId = request.admin?.id;
    if (!adminId) return false;
    const platformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_ONLY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (platformOnly) {
      await this.authorization.requirePlatformAdmin(adminId);
    } else if (request.params?.leagueId) {
      await this.authorization.requireLeagueManager(adminId, request.params.leagueId);
    }
    return true;
  }
}

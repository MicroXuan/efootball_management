import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { AuthorizationService } from './authorization.service.js';
import { ResourceScopeService } from './resource-scope.service.js';

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthorizationService, ResourceScopeService, JwtAuthGuard, ScopeGuard],
  exports: [AuthorizationService, ResourceScopeService, JwtAuthGuard, ScopeGuard]
})
export class AuthorizationModule {}

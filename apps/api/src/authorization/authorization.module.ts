import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { AuthorizationService } from './authorization.service.js';

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthorizationService, JwtAuthGuard, ScopeGuard],
  exports: [AuthorizationService, JwtAuthGuard, ScopeGuard]
})
export class AuthorizationModule {}

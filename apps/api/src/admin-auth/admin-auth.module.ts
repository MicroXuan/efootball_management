import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { ADMIN_TOKEN_CONFIG, AdminTokenService } from './admin-token.service.js';
import { PasswordService } from './password.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminAuthController],
  providers: [
    {
      provide: ADMIN_TOKEN_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        accessSecret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        refreshPepper: config.get<string>('ADMIN_REFRESH_TOKEN_PEPPER')
          ?? config.getOrThrow<string>('REFRESH_TOKEN_PEPPER')
      })
    },
    AdminAuthGuard,
    AdminAuthService,
    AdminTokenService,
    PasswordService
  ],
  exports: [JwtModule, AdminAuthGuard, AdminAuthService, AdminTokenService, PasswordService]
})
export class AdminAuthModule {}

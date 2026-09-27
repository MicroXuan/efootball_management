import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service.js';
import type { CurrentAdminIdentity } from './current-admin.decorator.js';

type AdminJwtPayload = {
  sub?: string;
  actor?: string;
};

type AdminAuthenticatedRequest = {
  headers: { authorization?: string };
  admin?: CurrentAdminIdentity;
};

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    const token = this.bearerToken(request.headers.authorization);
    if (!token) throw this.error();

    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET')
      });
    } catch {
      throw this.error();
    }

    if (!payload.sub || payload.actor !== 'ADMIN') throw this.error();
    const admin = await this.prisma.adminAccount.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, platformRole: true }
    });
    if (!admin || admin.status !== 'ACTIVE') throw this.error();

    request.admin = {
      id: admin.id,
      status: 'ACTIVE',
      platformRole: admin.platformRole
    };
    return true;
  }

  private bearerToken(value: string | undefined): string | undefined {
    return /^Bearer\s+(.+)$/i.exec(value ?? '')?.[1];
  }

  private error(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'ADMIN_AUTH_REQUIRED',
      message: 'Administrator authentication is required'
    });
  }
}

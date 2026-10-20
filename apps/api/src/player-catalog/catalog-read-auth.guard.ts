import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';

type CatalogJwtPayload = { sub?: string; actor?: string };
type CatalogRequest = {
  headers: { authorization?: string };
  user?: { id: string; status: 'ACTIVE' };
  admin?: CurrentAdminIdentity;
};

@Injectable()
export class CatalogReadAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CatalogRequest>();
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw this.unauthorized();

    let payload: CatalogJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<CatalogJwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET')
      });
    } catch {
      throw this.unauthorized();
    }
    if (!payload.sub) throw this.unauthorized();

    if (payload.actor === 'ADMIN') {
      const admin = await this.prisma.adminAccount.findUnique({
        where: { id: payload.sub }, select: { id: true, status: true, platformRole: true }
      });
      if (!admin || admin.status !== 'ACTIVE') throw this.unauthorized();
      request.admin = { id: admin.id, status: 'ACTIVE', platformRole: admin.platformRole };
      return true;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub }, select: { id: true, status: true }
    });
    if (!user || user.status !== 'ACTIVE') throw this.unauthorized();
    request.user = { id: user.id, status: 'ACTIVE' };
    return true;
  }

  private unauthorized() {
    return new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Authentication is required' });
  }
}

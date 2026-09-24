import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service.js';
import type { CurrentUser } from './current-user.decorator.js';

type JwtPayload = {
  sub?: string;
};

type AuthenticatedRequest = {
  headers: { authorization?: string };
  user?: CurrentUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.bearerToken(request.headers.authorization);
    if (!token) throw this.error('AUTH_REQUIRED', 'Authentication is required');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET')
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw this.error('AUTH_TOKEN_EXPIRED', 'Access token has expired');
      }
      throw this.error('AUTH_REQUIRED', 'Access token is invalid');
    }

    if (!payload.sub) throw this.error('AUTH_REQUIRED', 'Access token is invalid');
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true }
    });
    if (!user) throw this.error('AUTH_REQUIRED', 'Authentication is required');
    if (user.status !== 'ACTIVE') throw this.error('ACCOUNT_DISABLED', 'User account is disabled');

    request.user = { id: user.id, status: 'ACTIVE' };
    return true;
  }

  private bearerToken(value: string | undefined): string | undefined {
    const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
    return match?.[1];
  }

  private error(code: string, message: string): UnauthorizedException {
    return new UnauthorizedException({ code, message });
  }
}

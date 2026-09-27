import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

type OptionalAuthRequest = {
  headers: { authorization?: string };
};

@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  constructor(
    @Inject(JwtService) jwt: JwtService,
    @Inject(ConfigService) config: ConfigService,
    @Inject(PrismaService) prisma: PrismaService
  ) {
    super(jwt, config, prisma);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OptionalAuthRequest>();
    if (!request.headers.authorization) return true;
    return super.canActivate(context);
  }
}

import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AdminRole } from '../generated/prisma/enums.js';

export type CurrentAdminIdentity = {
  id: string;
  status: 'ACTIVE';
  platformRole: AdminRole | null;
};

type AuthenticatedAdminRequest = {
  admin?: CurrentAdminIdentity;
};

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentAdminIdentity | undefined =>
    context.switchToHttp().getRequest<AuthenticatedAdminRequest>().admin
);

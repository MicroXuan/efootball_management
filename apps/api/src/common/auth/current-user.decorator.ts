import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

export type CurrentUser = {
  id: string;
  status: 'ACTIVE';
};

type AuthenticatedRequest = {
  user?: CurrentUser;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user
);

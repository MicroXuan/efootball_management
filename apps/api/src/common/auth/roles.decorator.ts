import { SetMetadata } from '@nestjs/common';
import type { ScopeType } from '../../generated/prisma/enums.js';

export const REQUIRED_PERMISSION = Symbol('REQUIRED_PERMISSION');

export type PermissionRequirement = {
  permission: string;
  scope?: {
    type: ScopeType;
    param: string;
  };
};

export function RequirePermission(
  permission: string,
  scope?: PermissionRequirement['scope']
): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRED_PERMISSION, {
    permission,
    ...(scope ? { scope } : {})
  } satisfies PermissionRequirement);
}

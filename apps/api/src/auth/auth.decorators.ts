import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types.js';

export const IS_PUBLIC = 'isPublic';
export const PERMISSION_REQUIREMENT = 'permissionRequirement';

export type ScopeType = 'PLATFORM' | 'RESTAURANT' | 'ORGANIZATION' | 'PROVIDER';

export interface PermissionRequirement {
  permission: string;
  scopeType: ScopeType;
  scopeParam?: string;
}

export const Public = () => SetMetadata(IS_PUBLIC, true);

export const RequirePermission = (
  permission: string,
  scopeType: ScopeType = 'PLATFORM',
  scopeParam?: string,
) => SetMetadata(PERMISSION_REQUIREMENT, { permission, scopeType, scopeParam });

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authUser!,
);

export const CurrentSession = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return {
    id: request.authSessionId!,
    token: request.authToken!,
  };
});

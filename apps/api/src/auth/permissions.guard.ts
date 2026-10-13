import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service.js';
import { PERMISSION_REQUIREMENT } from './auth.decorators.js';
import type { PermissionRequirement } from './auth.decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSION_REQUIREMENT,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.authUser?.id;
    const routeScope = requirement.scopeParam ? request.params[requirement.scopeParam] : undefined;
    const scopeId = typeof routeScope === 'string' ? routeScope : undefined;
    if (requirement.scopeType !== 'PLATFORM' && !scopeId) {
      throw new ForbiddenException();
    }

    const assignments = await this.prisma.userRole.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        scopeType: requirement.scopeType,
        scopeId: requirement.scopeType === 'PLATFORM' ? null : scopeId,
      },
      select: { role: true },
    });
    const roles = assignments.map((assignment) => assignment.role);
    const permission = roles.length
      ? await this.prisma.rolePermission.findFirst({
          where: { role: { in: roles }, permission: requirement.permission },
        })
      : null;
    if (!permission) throw new ForbiddenException();
    return true;
  }
}

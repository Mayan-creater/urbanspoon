import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { GrantRoleDto } from './role.dto.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async grant(
    actor: AuthenticatedUser,
    targetUserId: string,
    input: GrantRoleDto,
    correlationId?: string,
  ) {
    const scopeType = input.scopeType ?? 'PLATFORM';
    if ((scopeType === 'PLATFORM') !== !input.scopeId) {
      throw new BadRequestException('A scope ID is required only for scoped roles');
    }
    const requiredScope =
      input.role === 'restaurant_owner' || input.role === 'restaurant_staff'
        ? 'RESTAURANT'
        : input.role === 'delivery_partner'
          ? 'PROVIDER'
          : 'PLATFORM';
    if (scopeType !== requiredScope) {
      throw new BadRequestException('Role is not valid for the requested scope');
    }

    return this.prisma.$transaction(async (transaction) => {
      const target = await transaction.user.findUnique({
        where: { id: targetUserId },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('User not found');

      const existing = await transaction.userRole.findFirst({
        where: {
          userId: targetUserId,
          role: input.role,
          scopeType,
          scopeId: input.scopeId ?? null,
          status: 'ACTIVE',
        },
      });
      if (existing) return existing;

      const assignment = await transaction.userRole.create({
        data: {
          userId: targetUserId,
          role: input.role,
          scopeType,
          scopeId: input.scopeId ?? null,
          grantedByUserId: actor.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'admin.roles.manage',
          action: 'ROLE_GRANTED',
          entityType: 'user_role',
          entityId: assignment.id,
          after: {
            userId: targetUserId,
            role: assignment.role,
            scopeType: assignment.scopeType,
            scopeId: assignment.scopeId,
          },
          correlationId,
        },
      });
      return assignment;
    });
  }

  async revoke(
    actor: AuthenticatedUser,
    targetUserId: string,
    assignmentId: string,
    correlationId?: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const assignment = await transaction.userRole.findFirst({
        where: { id: assignmentId, userId: targetUserId },
      });
      if (!assignment) throw new NotFoundException('Role assignment not found');
      if (assignment.status === 'REVOKED') return assignment;

      if (assignment.role === 'super_admin' && assignment.scopeType === 'PLATFORM') {
        const activeSuperAdmins = await transaction.userRole.count({
          where: { role: 'super_admin', scopeType: 'PLATFORM', status: 'ACTIVE' },
        });
        if (activeSuperAdmins <= 1) {
          throw new ConflictException('The last active super-admin cannot be revoked');
        }
      }

      const changed = await transaction.userRole.updateMany({
        where: { id: assignmentId, userId: targetUserId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      if (changed.count !== 1)
        throw new ConflictException('Role assignment changed; retry the request');

      const revoked = { ...assignment, status: 'REVOKED' as const };
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          permission: 'admin.roles.manage',
          action: 'ROLE_REVOKED',
          entityType: 'user_role',
          entityId: assignment.id,
          before: {
            role: assignment.role,
            scopeType: assignment.scopeType,
            scopeId: assignment.scopeId,
            status: assignment.status,
          },
          after: {
            role: revoked.role,
            scopeType: revoked.scopeType,
            scopeId: revoked.scopeId,
            status: revoked.status,
          },
          correlationId,
        },
      });
      return revoked;
    });
  }
}

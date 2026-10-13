import { Body, Controller, Delete, Param, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import { GrantRoleDto } from './role.dto.js';
import { RolesService } from './roles.service.js';

@Controller('admin/users')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Post(':id/roles')
  @RequirePermission('admin.roles.manage')
  grantRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') targetUserId: string,
    @Body() body: GrantRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const requestId = request.headers['x-request-id'];
    const correlationId = Array.isArray(requestId) ? requestId[0] : requestId;
    return this.roles.grant(actor, targetUserId, body, correlationId ?? randomUUID());
  }

  @Delete(':id/roles/:assignmentId')
  @RequirePermission('admin.roles.manage')
  revokeRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') targetUserId: string,
    @Param('assignmentId') assignmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const requestId = request.headers['x-request-id'];
    const correlationId = Array.isArray(requestId) ? requestId[0] : requestId;
    return this.roles.revoke(actor, targetUserId, assignmentId, correlationId ?? randomUUID());
  }
}

import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, Public, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateMembershipPlanDto } from './loyalty.dto.js';
import { MembershipService } from './membership.service.js';

@Controller('memberships')
export class CustomerMembershipController {
  constructor(private readonly memberships: MembershipService) {}

  @Public()
  @Get('plans')
  plans() {
    return this.memberships.listAvailablePlans();
  }

  @Get('me')
  current(@CurrentUser() user: AuthenticatedUser) {
    return this.memberships.currentMembership(user.id);
  }
}

@Controller('admin/memberships/plans')
@RequirePermission('admin.loyalty.manage')
export class AdminMembershipPlansController {
  constructor(private readonly memberships: MembershipService) {}

  @Get()
  list() {
    return this.memberships.listAdminPlans();
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateMembershipPlanDto) {
    return this.memberships.createPlan(user.id, body);
  }

  @Post(':planId/disable')
  disable(@CurrentUser() user: AuthenticatedUser, @Param('planId') planId: string) {
    return this.memberships.disablePlan(user.id, planId);
  }
}
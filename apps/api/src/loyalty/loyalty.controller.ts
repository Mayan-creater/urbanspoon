import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateLoyaltyRuleDto } from './loyalty.dto.js';
import { LoyaltyService } from './loyalty.service.js';

@Controller('loyalty')
export class CustomerLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  wallet(@CurrentUser() user: AuthenticatedUser) {
    return this.loyalty.wallet(user.id);
  }
}

@Controller('admin/loyalty/rules')
@RequirePermission('admin.loyalty.manage')
export class AdminLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  listRules() {
    return this.loyalty.listRules();
  }

  @Post()
  createRule(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateLoyaltyRuleDto) {
    return this.loyalty.createRule(user.id, body);
  }

  @Post(':ruleId/disable')
  disableRule(@CurrentUser() user: AuthenticatedUser, @Param('ruleId') ruleId: string) {
    return this.loyalty.disableRule(user.id, ruleId);
  }
}
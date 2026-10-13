import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import {
  CreateCommissionRuleDto,
  GenerateSettlementDto,
  MarkSettlementPaidDto,
  SettlementAdjustmentDto,
} from './settlements.dto.js';
import { SettlementsService } from './settlements.service.js';

function correlationId(request: AuthenticatedRequest) {
  const header = request.headers['x-request-id'];
  return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
}

@Controller('admin')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('commission-rules')
  @RequirePermission('admin.pricing.manage')
  commissionRules(@Query('restaurantId') restaurantId?: string) {
    return this.settlements.commissionRules(restaurantId);
  }

  @Post('commission-rules')
  @RequirePermission('admin.pricing.manage')
  createCommissionRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateCommissionRuleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settlements.createCommissionRule(actor, body, correlationId(request));
  }

  @Get('settlements')
  @RequirePermission('admin.settlements.approve')
  list(
    @Query('status') status?: string,
    @Query('restaurantId') restaurantId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.settlements.list(status, restaurantId, page, limit);
  }

  @Post('settlements/generate')
  @RequirePermission('admin.settlements.approve')
  generate(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: GenerateSettlementDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settlements.generate(actor, body, correlationId(request));
  }

  @Post('settlements/:settlementId/adjustments')
  @RequirePermission('admin.settlements.approve')
  adjust(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('settlementId') settlementId: string,
    @Body() body: SettlementAdjustmentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settlements.adjust(actor, settlementId, body, correlationId(request));
  }

  @Post('settlements/:settlementId/approve')
  @RequirePermission('admin.settlements.approve')
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('settlementId') settlementId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settlements.approve(actor, settlementId, correlationId(request));
  }

  @Post('settlements/:settlementId/mark-paid')
  @RequirePermission('admin.settlements.approve')
  markPaid(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('settlementId') settlementId: string,
    @Body() body: MarkSettlementPaidDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settlements.markPaid(
      actor,
      settlementId,
      body.externalTransferReference,
      correlationId(request),
    );
  }
}

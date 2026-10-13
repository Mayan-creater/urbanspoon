import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  AgentSupportMessageDto,
  CreateSupportCaseDto,
  CustomerSupportMessageDto,
  ResolveSupportCaseDto,
} from './support.dto.js';
import { SupportService } from './support.service.js';

@Controller('support/cases')
export class CustomerSupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateSupportCaseDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.support.createCase(user.id, body, idempotencyKey);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.support.listCustomerCases(user.id);
  }

  @Get(':caseId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string) {
    return this.support.getCustomerCase(user.id, caseId);
  }

  @Post(':caseId/messages')
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() body: CustomerSupportMessageDto,
  ) {
    return this.support.addCustomerMessage(user.id, caseId, body);
  }
}

@Controller('support/agent/cases')
@RequirePermission('support.cases.manage')
export class SupportAgentController {
  constructor(private readonly support: SupportService) {}

  @Get()
  queue(@CurrentUser() user: AuthenticatedUser) {
    return this.support.listAgentQueue(user.id);
  }

  @Post(':caseId/claim')
  claim(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string) {
    return this.support.claimCase(user.id, caseId);
  }

  @Get(':caseId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('caseId') caseId: string) {
    return this.support.getAssignedCase(user.id, caseId);
  }

  @Post(':caseId/messages')
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() body: AgentSupportMessageDto,
  ) {
    return this.support.addAgentMessage(user.id, caseId, body);
  }

  @Post(':caseId/resolve')
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() body: ResolveSupportCaseDto,
  ) {
    return this.support.resolveCase(user.id, caseId, body);
  }
}

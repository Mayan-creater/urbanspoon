import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import { CreateOrderIntentDto } from './order-intents.dto.js';
import { OrderIntentsService } from './order-intents.service.js';

function correlationId(request: AuthenticatedRequest) {
  const header = request.headers['x-request-id'];
  return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
}

@Controller('orders/intents')
export class OrderIntentsController {
  constructor(private readonly intents: OrderIntentsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateOrderIntentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.intents.create(user.id, body, idempotencyKey, correlationId(request));
  }

  @Get(':intentId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('intentId') intentId: string) {
    return this.intents.get(user.id, intentId);
  }

  @Post(':intentId/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('intentId') intentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.intents.cancel(user.id, intentId, correlationId(request));
  }
}

import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CurrentUser, Public, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import {
  OrderReasonDto,
  SandboxPaymentCompletionDto,
  SandboxPaymentWebhookDto,
} from './order-intents.dto.js';
import { OrdersService } from './orders.service.js';

function correlationId(request: AuthenticatedRequest) {
  const header = request.headers['x-request-id'];
  return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
}

@Controller('payment-attempts')
export class PaymentAttemptsController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':attemptId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('attemptId') attemptId: string) {
    return this.orders.getAttempt(user.id, attemptId);
  }

  @Post(':attemptId/verify')
  verify(@CurrentUser() user: AuthenticatedUser, @Param('attemptId') attemptId: string) {
    return this.orders.verifyAttempt(user.id, attemptId);
  }
}

@Controller('orders/intents')
export class PaymentInitiationController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':intentId/payment-attempts')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('intentId') intentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.orders.createAttempt(user.id, intentId, idempotencyKey);
  }
}

@Controller('orders')
export class CustomerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('intents/:intentId/sandbox-payment')
  completeSandboxPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('intentId') intentId: string,
    @Body() body: SandboxPaymentCompletionDto,
  ) {
    return this.orders.completeSandboxIntent(user.id, intentId, body);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listCustomerOrders(user.id);
  }

  @Get(':orderId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string) {
    return this.orders.getCustomerOrder(user.id, orderId);
  }

  @Post(':orderId/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.cancelCustomerOrder(user.id, orderId, correlationId(request));
  }
}

@Controller('partner/restaurants/:restaurantId/orders')
@RequirePermission('restaurant.orders.manage', 'RESTAURANT', 'restaurantId')
export class RestaurantOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Param('restaurantId') restaurantId: string) {
    return this.orders.listRestaurantOrders(restaurantId);
  }

  @Get(':orderId')
  get(@Param('restaurantId') restaurantId: string, @Param('orderId') orderId: string) {
    return this.orders.getRestaurantOrder(restaurantId, orderId);
  }

  @Post(':orderId/accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Req() request: AuthenticatedRequest,
    @Query('prepTimeMinutes') prepTimeMinutes?: string,
  ) {
    return this.orders.transitionRestaurantOrder(
      user.id,
      restaurantId,
      orderId,
      'accept',
      undefined,
      correlationId(request),
      prepTimeMinutes === undefined ? undefined : Number(prepTimeMinutes),
    );
  }

  @Post(':orderId/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Body() body: OrderReasonDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.transitionRestaurantOrder(
      user.id,
      restaurantId,
      orderId,
      'reject',
      body.reason,
      correlationId(request),
    );
  }

  @Post(':orderId/preparing')
  preparing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.transitionRestaurantOrder(
      user.id,
      restaurantId,
      orderId,
      'preparing',
      undefined,
      correlationId(request),
    );
  }

  @Post(':orderId/ready')
  ready(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.transitionRestaurantOrder(
      user.id,
      restaurantId,
      orderId,
      'ready',
      undefined,
      correlationId(request),
    );
  }

  @Post(':orderId/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Body() body: OrderReasonDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.transitionRestaurantOrder(
      user.id,
      restaurantId,
      orderId,
      'cancel',
      body.reason,
      correlationId(request),
    );
  }
}

@Controller('test/payments')
export class SandboxPaymentController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':attemptId/complete')
  @Public()
  complete(@Param('attemptId') attemptId: string, @Body() body: SandboxPaymentCompletionDto) {
    return this.orders.completeSandboxAttempt(attemptId, body);
  }
}

@Controller('webhooks/payments/sandbox')
export class SandboxWebhookController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Public()
  receive(
    @Body() body: SandboxPaymentWebhookDto,
    @Headers('x-payment-signature') signature: string | undefined,
  ) {
    return this.orders.receiveSandboxWebhook(body, signature);
  }
}
